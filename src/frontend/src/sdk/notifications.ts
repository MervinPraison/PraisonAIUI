/**
 * Headless Notification Center store (`notifications` & `useNotifications` in
 * `@aiui/sdk`).
 *
 * DRY design:
 * - Zero UI dependencies on the boot path (pure TypeScript + React's
 *   `useSyncExternalStore`).
 * - Single source of truth shared by transient toasts (`notify()`), first-party
 *   bell UI (`builtin.notifications`), server SSE/REST sync, and any
 *   third-party plugin via `notifications.registerSource(...)`.
 * - Deduplicates by `dedupeKey` / `id`, bounds memory with a configurable cap,
 *   updates optimistically and notifies registered sources for reconciliation.
 *
 * Lives in `sdk/` so the SDK never imports the shell or any built-in feature.
 */
import { useMemo, useSyncExternalStore } from 'react'

export type NotificationType = 'default' | 'info' | 'success' | 'warning' | 'error'

export interface NotificationAction {
  label: string
  /** SPA page id opened via `navigate(page, { params })`. */
  page?: string
  params?: Record<string, string | string[]>
  /** Safe same-origin path or http(s) URL. */
  href?: string
  /** Optional client-side callback. */
  onClick?: () => void
}

export interface NotificationItem {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly type: NotificationType
  readonly category?: string
  readonly source?: string
  readonly createdAt: number
  readonly read: boolean
  readonly pinned?: boolean
  readonly dedupeKey?: string
  readonly action?: NotificationAction
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface PushNotificationInput {
  id?: string
  title: string
  description?: string
  type?: NotificationType
  category?: string
  source?: string
  createdAt?: number
  read?: boolean
  pinned?: boolean
  dedupeKey?: string
  action?: NotificationAction
  meta?: Record<string, unknown>
  /** Also display a transient toast (default: false). */
  toast?: boolean
}

export interface NotificationSnapshot {
  readonly items: readonly NotificationItem[]
  readonly unreadCount: number
}

export interface ClearNotificationsOptions {
  /** Also clear pinned items (default: false). */
  includePinned?: boolean
  /** Only clear items that are already read (default: false). */
  readOnly?: boolean
}

export interface SyncNotificationsOptions {
  /** Tag synced items with this source name (e.g. 'server'). */
  source?: string
  /** Replace previous items from `source` that are absent in the new snapshot. */
  replaceSource?: boolean
}

export interface NotificationSourceContext {
  push: (input: PushNotificationInput) => NotificationItem
  markRead: (id: string, opts?: { localOnly?: boolean }) => boolean
  markAllRead: (opts?: { localOnly?: boolean }) => number
  remove: (id: string, opts?: { localOnly?: boolean }) => boolean
  clear: (opts?: ClearNotificationsOptions & { localOnly?: boolean }) => number
  sync: (items: readonly PushNotificationInput[], opts?: SyncNotificationsOptions) => void
}

export interface NotificationSource {
  /** Activate the source (open SSE, attach listeners, etc.) and return a cleanup. */
  connect?: (ctx: NotificationSourceContext) => (() => void) | void
  onMarkRead?: (id: string, item: NotificationItem) => void
  onMarkUnread?: (id: string, item: NotificationItem) => void
  onMarkAllRead?: () => void
  onRemove?: (id: string, item: NotificationItem) => void
  onClear?: (opts: ClearNotificationsOptions) => void
}

export interface NotificationFilter {
  category?: string
  unreadOnly?: boolean
}

export interface UseNotificationsResult {
  readonly items: readonly NotificationItem[]
  readonly unreadCount: number
  readonly totalUnreadCount: number
  readonly categories: readonly string[]
  readonly push: (input: PushNotificationInput) => NotificationItem
  readonly markRead: (id: string) => boolean
  readonly markUnread: (id: string) => boolean
  readonly markAllRead: () => number
  readonly remove: (id: string) => boolean
  readonly clear: (opts?: ClearNotificationsOptions) => number
}

const VALID_TYPES = new Set<NotificationType>(['default', 'info', 'success', 'warning', 'error'])
const DEFAULT_MAX_ITEMS = 100

let maxItems = DEFAULT_MAX_ITEMS
let seq = 0
let items: NotificationItem[] = []
let snapshot: NotificationSnapshot = Object.freeze({ items, unreadCount: 0 })

const listeners = new Set<() => void>()
const announceListeners = new Set<(item: NotificationItem) => void>()

interface RegisteredSource {
  source: NotificationSource
  dispose?: () => void
}
const sources = new Map<string, RegisteredSource>()

type ToastForwarder = (item: NotificationItem) => void
let toastForwarder: ToastForwarder | null = null

/** Internal hook used by `sdk/notify.ts` so `push({ toast: true })` never loops. */
export function _setNotificationToastForwarder(fn: ToastForwarder | null): void {
  toastForwarder = fn
}

/** Subscribe to newly added unread notifications (e.g. polite screen-reader announcer). */
export function subscribeNotificationAnnouncements(fn: (item: NotificationItem) => void): () => void {
  announceListeners.add(fn)
  return () => {
    announceListeners.delete(fn)
  }
}

/** Allow only relative paths (not protocol-relative `//`) or http(s) URLs. */
export function isSafeNotificationHref(href: string | undefined): href is string {
  if (!href || typeof href !== 'string') return false
  const trimmed = href.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//')
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function sanitizeAction(action: NotificationAction | undefined): NotificationAction | undefined {
  if (!action || typeof action !== 'object') return undefined
  const label = typeof action.label === 'string' ? action.label.trim() : ''
  if (!label) return undefined
  const page = typeof action.page === 'string' && action.page.trim() ? action.page.trim() : undefined
  const href = isSafeNotificationHref(action.href) ? action.href.trim() : undefined
  const onClick = typeof action.onClick === 'function' ? action.onClick : undefined
  if (!page && !href && !onClick) return undefined
  return {
    label,
    ...(page ? { page } : {}),
    ...(action.params && typeof action.params === 'object' ? { params: action.params } : {}),
    ...(href ? { href } : {}),
    ...(onClick ? { onClick } : {}),
  }
}

function normalizeType(type: unknown): NotificationType {
  return typeof type === 'string' && VALID_TYPES.has(type as NotificationType)
    ? (type as NotificationType)
    : 'default'
}

function normalizeText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed
}

function nextId(): string {
  seq += 1
  return `ntf-${Date.now().toString(36)}-${seq.toString(36)}`
}

function computeUnread(list: readonly NotificationItem[]): number {
  let count = 0
  for (const item of list) if (!item.read) count += 1
  return count
}

function commit(next: NotificationItem[]): void {
  // Sort newest first, keeping stable order for identical timestamps.
  next.sort((a, b) => b.createdAt - a.createdAt)
  // Enforce ring-buffer cap: drop oldest read unpinned items first, then oldest unpinned.
  while (next.length > maxItems) {
    let dropIdx = -1
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].read && !next[i].pinned) {
        dropIdx = i
        break
      }
    }
    if (dropIdx === -1) {
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (!next[i].pinned) {
          dropIdx = i
          break
        }
      }
    }
    if (dropIdx === -1) break
    next.splice(dropIdx, 1)
  }
  items = next
  snapshot = Object.freeze({ items: Object.freeze([...items]), unreadCount: computeUnread(items) })
  for (const fn of [...listeners]) fn()
}

function toItem(input: PushNotificationInput, existing?: NotificationItem): NotificationItem {
  const title = normalizeText(input.title, 240) ?? existing?.title ?? 'Notification'
  const description = normalizeText(input.description, 1000)
  const category = normalizeText(input.category, 60)
  const source = normalizeText(input.source, 60)
  const dedupeKey = normalizeText(input.dedupeKey, 200) ?? existing?.dedupeKey
  const id = normalizeText(input.id, 200) ?? existing?.id ?? nextId()
  const rawAt = input.createdAt
  const createdAt =
    typeof rawAt === 'number' && Number.isFinite(rawAt)
      ? rawAt < 1e12
        ? Math.round(rawAt * 1000)
        : Math.round(rawAt)
      : Date.now()
  const action = sanitizeAction(input.action)
  return Object.freeze({
    id,
    title,
    ...(description !== undefined ? { description } : {}),
    type: normalizeType(input.type ?? existing?.type),
    ...(category !== undefined ? { category } : {}),
    ...(source !== undefined ? { source } : {}),
    createdAt,
    read: input.read ?? false,
    ...(input.pinned ?? existing?.pinned ? { pinned: true } : {}),
    ...(dedupeKey !== undefined ? { dedupeKey } : {}),
    ...(action ? { action } : {}),
    ...(input.meta && typeof input.meta === 'object' ? { meta: Object.freeze({ ...input.meta }) } : {}),
  })
}

function findIndex(list: readonly NotificationItem[], id?: string, dedupeKey?: string): number {
  if (dedupeKey) {
    const byKey = list.findIndex((x) => x.dedupeKey === dedupeKey || x.id === dedupeKey)
    if (byKey !== -1) return byKey
  }
  if (id) return list.findIndex((x) => x.id === id)
  return -1
}

function notifySources(cb: (source: NotificationSource) => void): void {
  for (const entry of [...sources.values()]) {
    try {
      cb(entry.source)
    } catch (err) {
      console.warn('[aiui notifications] source callback failed', err)
    }
  }
}

function push(input: PushNotificationInput): NotificationItem {
  const idx = findIndex(items, input.id, input.dedupeKey)
  const existing = idx !== -1 ? items[idx] : undefined
  const item = toItem(input, existing)
  const next = [...items]
  if (idx !== -1) next[idx] = item
  else next.unshift(item)
  commit(next)
  if (!item.read && !existing) {
    for (const fn of [...announceListeners]) {
      try {
        fn(item)
      } catch {
        /* ignore announcer errors */
      }
    }
  }
  if (input.toast && toastForwarder) {
    toastForwarder(item)
  }
  return item
}

function markRead(id: string, opts?: { localOnly?: boolean }): boolean {
  const idx = items.findIndex((x) => x.id === id)
  if (idx === -1 || items[idx].read) return false
  const updated: NotificationItem = Object.freeze({ ...items[idx], read: true })
  const next = [...items]
  next[idx] = updated
  commit(next)
  if (!opts?.localOnly) notifySources((s) => s.onMarkRead?.(id, updated))
  return true
}

function markUnread(id: string, opts?: { localOnly?: boolean }): boolean {
  const idx = items.findIndex((x) => x.id === id)
  if (idx === -1 || !items[idx].read) return false
  const updated: NotificationItem = Object.freeze({ ...items[idx], read: false })
  const next = [...items]
  next[idx] = updated
  commit(next)
  if (!opts?.localOnly) notifySources((s) => s.onMarkUnread?.(id, updated))
  return true
}

function markAllRead(opts?: { localOnly?: boolean }): number {
  let changed = 0
  const next = items.map((item) => {
    if (item.read) return item
    changed += 1
    return Object.freeze({ ...item, read: true })
  })
  if (changed === 0) return 0
  commit(next)
  if (!opts?.localOnly) notifySources((s) => s.onMarkAllRead?.())
  return changed
}

function remove(id: string, opts?: { localOnly?: boolean }): boolean {
  const idx = items.findIndex((x) => x.id === id)
  if (idx === -1) return false
  const removed = items[idx]
  const next = [...items]
  next.splice(idx, 1)
  commit(next)
  if (!opts?.localOnly) notifySources((s) => s.onRemove?.(id, removed))
  return true
}

function clear(opts: ClearNotificationsOptions & { localOnly?: boolean } = {}): number {
  const includePinned = Boolean(opts.includePinned)
  const readOnly = Boolean(opts.readOnly)
  const kept: NotificationItem[] = []
  let removed = 0
  for (const item of items) {
    const keepPinned = item.pinned && !includePinned
    const keepUnread = readOnly && !item.read
    if (keepPinned || keepUnread) kept.push(item)
    else removed += 1
  }
  if (removed === 0) return 0
  commit(kept)
  if (!opts.localOnly) notifySources((s) => s.onClear?.({ includePinned, readOnly }))
  return removed
}

function sync(incoming: readonly PushNotificationInput[], opts: SyncNotificationsOptions = {}): void {
  const sourceTag = opts.source
  let next = [...items]
  if (opts.replaceSource && sourceTag) {
    next = next.filter((x) => x.source !== sourceTag)
  }
  for (const raw of incoming) {
    const entry = sourceTag && !raw.source ? { ...raw, source: sourceTag } : raw
    const idx = findIndex(next, entry.id, entry.dedupeKey)
    const item = toItem(entry, idx !== -1 ? next[idx] : undefined)
    if (idx !== -1) next[idx] = item
    else next.push(item)
  }
  commit(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function get(): NotificationSnapshot {
  return snapshot
}

function unreadCount(): number {
  return snapshot.unreadCount
}

const sourceCtx: NotificationSourceContext = Object.freeze({
  push,
  markRead,
  markAllRead,
  remove,
  clear,
  sync,
})

function registerSource(id: string, source: NotificationSource): () => void {
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError('[aiui sdk] notifications.registerSource: expected a non-empty string id')
  }
  const prev = sources.get(id)
  if (prev) {
    sources.delete(id)
    try {
      prev.dispose?.()
    } catch {
      /* ignore previous cleanup errors */
    }
  }
  const entry: RegisteredSource = { source }
  sources.set(id, entry)
  if (source.connect) {
    try {
      const cleanup = source.connect(sourceCtx)
      if (typeof cleanup === 'function') entry.dispose = cleanup
    } catch (err) {
      console.warn(`[aiui notifications] source '${id}' failed to connect`, err)
    }
  }
  return () => {
    const cur = sources.get(id)
    if (cur !== entry) return
    sources.delete(id)
    try {
      entry.dispose?.()
    } catch {
      /* ignore cleanup errors */
    }
  }
}

function configure(opts: { maxItems?: number }): void {
  if (typeof opts.maxItems === 'number' && Number.isInteger(opts.maxItems) && opts.maxItems > 0) {
    maxItems = opts.maxItems
    if (items.length > maxItems) commit([...items])
  }
}

function reset(): void {
  for (const entry of [...sources.values()]) {
    try {
      entry.dispose?.()
    } catch {
      /* ignore */
    }
  }
  sources.clear()
  maxItems = DEFAULT_MAX_ITEMS
  seq = 0
  items = []
  snapshot = Object.freeze({ items: Object.freeze([]), unreadCount: 0 })
  for (const fn of [...listeners]) fn()
}

export const notifications = Object.freeze({
  push,
  get,
  unreadCount,
  markRead,
  markUnread,
  markAllRead,
  remove,
  clear,
  sync,
  subscribe,
  registerSource,
  configure,
  reset,
})

const boundMarkRead = (id: string) => markRead(id)
const boundMarkUnread = (id: string) => markUnread(id)
const boundMarkAllRead = () => markAllRead()
const boundRemove = (id: string) => remove(id)
const boundClear = (opts?: ClearNotificationsOptions) => clear(opts)

/** React hook subscribing to the headless Notification Center store. */
export function useNotifications(filter?: NotificationFilter): UseNotificationsResult {
  const snap = useSyncExternalStore(subscribe, get, get)
  const category = filter?.category
  const unreadOnly = Boolean(filter?.unreadOnly)
  return useMemo(() => {
    const catSet = new Set<string>()
    for (const item of snap.items) if (item.category) catSet.add(item.category)
    const filtered =
      category || unreadOnly
        ? snap.items.filter((item) => (!category || item.category === category) && (!unreadOnly || !item.read))
        : snap.items
    const filteredUnread = category ? computeUnread(filtered) : snap.unreadCount
    return {
      items: filtered,
      unreadCount: filteredUnread,
      totalUnreadCount: snap.unreadCount,
      categories: [...catSet].sort(),
      push,
      markRead: boundMarkRead,
      markUnread: boundMarkUnread,
      markAllRead: boundMarkAllRead,
      remove: boundRemove,
      clear: boundClear,
    }
  }, [snap, category, unreadOnly])
}
