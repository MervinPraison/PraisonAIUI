/**
 * Selectable layouts (ADR 0003): a layout owns the frame around the routed
 * page (navigation, session list, top bar, side panels, status bar, phone
 * chrome); a page owns its content and renders inside every layout through
 * the `Outlet` the shell hands the frame.
 *
 *   registerLayout(id, meta, C | () => import('./Frame'))   a layout
 *   getLayouts() / useLayout() / setLayout(id)              which one is on
 *   provideLayoutData(kind, feed | () => import(...))       data frames read
 *   useLayoutData(kind)                                     … with this hook
 *
 * First-party layouts and plugin layouts use the same calls. A loader is
 * called only when its layout (or feed) is first needed, so an inactive
 * layout's code is never downloaded.
 *
 * Dependency direction: the SDK never imports the shell and never names a
 * layout (shell/core-purity.test.ts). The shell picks the active layout and
 * reports it with activateLayout(); it may take over setLayout() with
 * provideLayoutHost().
 *
 * FROZEN CONTRACT: change only additively.
 */
import { useSyncExternalStore, type ComponentType } from 'react'
import { CLASSIC_LAYOUT_ID, isLayoutId, type ShellLayoutSpec, type ShellPage } from './manifest'
import { toComponent } from './registry'
import type { LayoutDataKind, LayoutDataMap } from './layoutTypes'

// ── what a layout declares ───────────────────────────────────────────

/** The shell's viewport class: width < 768 px, < 1024 px, else desktop. */
export type LayoutViewport = 'phone' | 'tablet' | 'desktop'

/** Widths (px) below which the viewport is `phone`, then `tablet`. */
export const LAYOUT_BREAKPOINTS = Object.freeze({ phone: 768, tablet: 1024 })

export function layoutViewport(width: number): LayoutViewport {
  if (width < LAYOUT_BREAKPOINTS.phone) return 'phone'
  return width < LAYOUT_BREAKPOINTS.tablet ? 'tablet' : 'desktop'
}

/** Props of a chat region (aside, empty state). */
export interface ChatRegionProps {
  sessionId: string | null
  viewport: LayoutViewport
  /** Show a count on the region's phone tab (0 hides it). */
  reportBadge(n: number): void
}

/** Props of a per-turn region (above or below one assistant message). */
export interface TurnRegionProps extends ChatRegionProps {
  messageId: string
}

/** Lazy region component: `() => import('@/layout-features/x/Panel')`. */
export type RegionLoader<P = ChatRegionProps> = () => Promise<{ default: ComponentType<P> }>

/** How the chat page presents itself inside a layout (read with useLayout()). */
export interface ChatPresentation {
  /** Who draws the session list. Default `page` (the chat page's own rail). */
  sessions?: 'page' | 'frame' | 'tabs' | 'none'
  thread?: 'bubbles' | 'quiet' | 'steps' | 'dense'
  approvals?: 'inline' | 'card' | 'keyboard'
  /** Desktop right panel; on a phone, a second tab. */
  aside?: RegionLoader
  /** Label of the phone tab for `aside`, e.g. Canvas. */
  asideLabel?: string
  /** Above each assistant turn: step tracker, run timeline. */
  turnHeader?: RegionLoader<TurnRegionProps>
  /** Below each assistant turn: artifact cards, follow-up chips. */
  turnFooter?: RegionLoader<TurnRegionProps>
  /** In an empty thread: templates. */
  empty?: RegionLoader
}

export interface LayoutMeta {
  title: string
  description?: string
  /** Picker thumbnail URL. */
  preview?: string
  chat?: ChatPresentation
  /** `frame`: the approvals toasts stop; the layout shows pending approvals itself. Default `toast`. */
  approvals?: 'toast' | 'frame'
}

// ── what a layout receives ───────────────────────────────────────────

export interface LayoutNavItem {
  id: string
  title: string
  /** Lucide icon name. */
  navIcon?: string
  icon?: string
  group: string
  href: string
  active: boolean
  badge?: number
}

export interface LayoutNav {
  /** At most 7 items: the layout's `primary` pages this server lists (YAML `layout.primary` wins). */
  primary: readonly LayoutNavItem[]
  /** Every other page, by sidebar group (the "More" list). */
  groups: readonly { name: string; folded: boolean; items: readonly LayoutNavItem[] }[]
  footer: readonly LayoutNavItem[]
  activeId: string
  go(pageId: string): void
}

export interface LayoutChrome {
  siteTitle: string
  siteLogo: { kind: 'img' | 'text'; value: string } | null
  /** Open the one command palette, optionally with a query typed in. */
  openPalette(opts?: { query?: string }): void
  toggleColorMode(): void
  /** The shell's slot host (`header:actions`, `sidebar:footer`, …). */
  Slot: ComponentType<{ name: string; className?: string }>
  /** Id of the main landmark, the skip link's target. */
  mainId: string
}

export interface LayoutProps {
  /** The routed page: error boundary, page toolbar slot and Suspense included. */
  Outlet: ComponentType<{ className?: string }>
  pageId: string
  page?: ShellPage
  /** The page asked for no padding (`page.layout === 'full-bleed'`). */
  fullBleed: boolean
  nav: LayoutNav
  chrome: LayoutChrome
  viewport: LayoutViewport
  layout: {
    id: string
    available: readonly ShellLayoutSpec[]
    /** Same as setLayout(id). */
    switchTo(id: string): void
  }
}

export type LayoutComponent = ComponentType<LayoutProps>
export type LayoutLoader = () => Promise<{ default: LayoutComponent }>

/** A registered layout as getLayouts() and useLayout() report it. */
export interface LayoutInfo {
  readonly id: string
  readonly meta: LayoutMeta
}

export interface SetLayoutOptions {
  /**
   * Default true: remember the choice in this browser. false: switch for
   * this browser tab only, like a `?layout=` preview.
   */
  persist?: boolean
}

// ── storage (one place for the keys the shell and settings use) ──────

/** localStorage: the viewer's own choice (honoured only when `layouts.userChoice`). */
export const LAYOUT_STORAGE_KEY = 'aiui-layout'
/** sessionStorage: a preview for this tab, seeded from `?layout=`; wins over the choice. */
export const LAYOUT_PREVIEW_KEY = 'aiui-layout-preview'

/** '' and `classic` mean the classic frame (''); a layout id is kept; anything else is null. */
export function parseLayoutChoice(v: unknown): string | null {
  if (v === '' || v === CLASSIC_LAYOUT_ID) return ''
  return isLayoutId(v) ? v : null
}

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window[kind] ?? null)
  } catch {
    return null // blocked storage throws on access
  }
}

function readKey(kind: 'localStorage' | 'sessionStorage', key: string): string | null {
  try {
    return parseLayoutChoice(storage(kind)?.getItem(key))
  } catch {
    return null
  }
}

/** The stored preview and choice ('' = classic, null = none), for the shell's selection. */
export function readStoredLayout(): { preview: string | null; choice: string | null } {
  return { preview: readKey('sessionStorage', LAYOUT_PREVIEW_KEY), choice: readKey('localStorage', LAYOUT_STORAGE_KEY) }
}

/** Store a switch the way setLayout() does. Storage that throws is ignored. */
export function writeStoredLayout(id: string, persist: boolean): void {
  const value = id || CLASSIC_LAYOUT_ID
  try {
    if (persist) {
      storage('localStorage')?.setItem(LAYOUT_STORAGE_KEY, value)
      storage('sessionStorage')?.removeItem(LAYOUT_PREVIEW_KEY)
    } else {
      storage('sessionStorage')?.setItem(LAYOUT_PREVIEW_KEY, value)
    }
  } catch {
    // private mode or full storage: the switch still happens
  }
}

// ── registry ─────────────────────────────────────────────────────────

interface LayoutEntry {
  info: LayoutInfo
  component: LayoutComponent
}

const layouts = new Map<string, LayoutEntry>()
const layoutListeners = new Set<() => void>()
let layoutsSnapshot: readonly LayoutInfo[] = Object.freeze([])
/** The layout the shell renders ('' = classic frame). */
let activeId = ''

function fire(listeners: Set<() => void>) {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.error('[aiui sdk] layout listener failed', err)
    }
  }
}

function emitLayouts() {
  layoutsSnapshot = Object.freeze([...layouts.values()].map((e) => e.info))
  fire(layoutListeners)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(kind: string, msg: string): never {
  throw new TypeError(`[aiui sdk] ${kind}: ${msg}`)
}

const CHAT_ENUMS = {
  sessions: ['page', 'frame', 'tabs', 'none'],
  thread: ['bubbles', 'quiet', 'steps', 'dense'],
  approvals: ['inline', 'card', 'keyboard'],
} as const
const CHAT_REGIONS = ['aside', 'turnHeader', 'turnFooter', 'empty'] as const

/**
 * Validate and freeze `meta`. A missing title or a region that is not a
 * loader throws; an unknown enum value (say, from a newer SDK) is dropped
 * with a warning so the default applies.
 */
function normalizeMeta(kind: string, raw: unknown): LayoutMeta {
  if (!isRecord(raw)) fail(kind, 'meta must be an object')
  if (typeof raw.title !== 'string' || !raw.title) fail(kind, 'meta.title must be a non-empty string')
  const out: Record<string, unknown> = { ...raw }
  for (const key of ['description', 'preview'] as const) {
    if (out[key] !== undefined && typeof out[key] !== 'string') fail(kind, `meta.${key} must be a string`)
  }
  if (out.approvals !== undefined && out.approvals !== 'toast' && out.approvals !== 'frame') {
    console.warn(`[aiui sdk] ${kind}: ignoring unknown meta.approvals ${String(out.approvals)}`)
    delete out.approvals
  }
  if (out.chat !== undefined) {
    if (!isRecord(out.chat)) fail(kind, 'meta.chat must be an object')
    const chat: Record<string, unknown> = { ...out.chat }
    for (const [key, allowed] of Object.entries(CHAT_ENUMS)) {
      if (chat[key] !== undefined && !(allowed as readonly unknown[]).includes(chat[key])) {
        console.warn(`[aiui sdk] ${kind}: ignoring unknown meta.chat.${key} ${String(chat[key])}`)
        delete chat[key]
      }
    }
    for (const key of CHAT_REGIONS) {
      if (chat[key] !== undefined && typeof chat[key] !== 'function') {
        fail(kind, `meta.chat.${key} must be a loader, () => import(...)`)
      }
    }
    if (chat.asideLabel !== undefined && typeof chat.asideLabel !== 'string') {
      fail(kind, 'meta.chat.asideLabel must be a string')
    }
    out.chat = Object.freeze(chat)
  }
  return Object.freeze(out) as unknown as LayoutMeta
}

/**
 * Register a layout. `c` is the frame component, or a loader returning
 * `import()` of a module whose default export is it; a loader runs only when
 * the shell first renders this layout. Ids are lower-case words with dashes
 * (`classic` is reserved for the core's frame). Registering an id again
 * replaces it, with a warning. Returns a remover that removes this
 * registration only.
 *
 * Which layouts a server offers comes from the manifest (`layouts`); a
 * registered layout the manifest does not list is never selected.
 */
export function registerLayout(id: string, meta: LayoutMeta, c: LayoutComponent | LayoutLoader): () => void {
  const kind = 'registerLayout'
  if (id === CLASSIC_LAYOUT_ID) fail(kind, `'${CLASSIC_LAYOUT_ID}' is reserved for the core frame`)
  if (!isLayoutId(id)) fail(kind, `invalid layout id ${String(id)} (use a-z, 0-9 and -, starting with a letter)`)
  const normalized = normalizeMeta(`${kind}('${id}')`, meta)
  const component = toComponent<LayoutComponent>(kind, id, c)
  if (layouts.has(id)) console.warn(`[aiui sdk] ${kind}('${id}') replaces an earlier registration`)
  const entry: LayoutEntry = { info: Object.freeze({ id, meta: normalized }), component }
  layouts.set(id, entry)
  emitLayouts()
  return () => {
    if (layouts.get(id) !== entry) return
    layouts.delete(id)
    emitLayouts()
  }
}

/** Registered layouts in registration order. The array keeps its identity until a change. */
export function getLayouts(): readonly LayoutInfo[] {
  return layoutsSnapshot
}

/** Shell host: the frame component of a registered layout (lazy for a loader). */
export function getLayoutComponent(id: string): LayoutComponent | undefined {
  return layouts.get(id)?.component
}

/** Called after a layout is registered or removed, or the active one changes. */
export function subscribeLayouts(fn: () => void): () => void {
  layoutListeners.add(fn)
  return () => {
    layoutListeners.delete(fn)
  }
}

// ── the active layout ────────────────────────────────────────────────

/** The active layout, or null while the classic frame is on screen (or it is not registered yet). */
export function getActiveLayout(): LayoutInfo | null {
  return (activeId && layouts.get(activeId)?.info) || null
}

/** The id the shell is rendering ('' = classic), registered or not. */
export function getActiveLayoutId(): string {
  return activeId
}

/** React hook: the active layout's id and meta, or null for the classic frame. */
export function useLayout(): LayoutInfo | null {
  return useSyncExternalStore(subscribeLayouts, getActiveLayout, getActiveLayout)
}

/** Shell host: report the layout now rendered ('' = classic). */
export function activateLayout(id: string): void {
  const next = parseLayoutChoice(id) ?? ''
  if (next === activeId) return
  activeId = next
  fire(layoutListeners)
}

export interface LayoutHost {
  /**
   * Switch to `id` ('' = classic) after setLayout() stored the choice. The
   * shell re-runs its selection (unknown ids fall back) and calls
   * activateLayout(). The default activates `id` directly.
   */
  select(id: string, opts: { persist: boolean }): void
}

const defaultLayoutHost: LayoutHost = { select: (id) => activateLayout(id) }
let layoutHost: LayoutHost = defaultLayoutHost

/** Called by the shell at mount, before plugins load. */
export function provideLayoutHost(impl: Partial<LayoutHost>): void {
  layoutHost = { ...layoutHost, ...impl }
}

/**
 * Switch the layout live ('' or `classic`: the core's classic frame). The
 * frame and page remount; chat state survives. By default the choice is
 * remembered in this browser (`{ persist: false }`: this tab only).
 */
export function setLayout(id: string, opts: SetLayoutOptions = {}): void {
  const next = parseLayoutChoice(id)
  if (next === null) fail('setLayout', `invalid layout id ${String(id)}`)
  if (!isRecord(opts)) fail('setLayout', 'options must be an object')
  const persist = opts.persist !== false
  writeStoredLayout(next, persist)
  layoutHost.select(next, { persist })
}

// ── layout data feeds ────────────────────────────────────────────────

interface DataEntry {
  value: object | null
  load?: () => Promise<unknown>
  state: 'idle' | 'loading' | 'ready' | 'error'
  promise?: Promise<object | null>
}

const providers = new Map<string, DataEntry>()
const dataListeners = new Set<() => void>()

function subscribeData(fn: () => void): () => void {
  dataListeners.add(fn)
  return () => {
    dataListeners.delete(fn)
  }
}

/**
 * Provide the feed of a data kind (`sessions`, `chat`, `approvals`, `runs`,
 * `artifacts`, or a kind a plugin declares). `provider` is the feed, or a
 * function returning a promise of it, called the first time a frame reads
 * the kind, so its code loads only when a layout needs it. (A function is
 * always taken as a loader.) Providing a kind again replaces it, with a
 * warning. Returns a remover that removes this provider only.
 */
export function provideLayoutData<K extends LayoutDataKind>(
  kind: K,
  provider: LayoutDataMap[K] | (() => Promise<LayoutDataMap[K]>),
): () => void {
  const fn = 'provideLayoutData'
  if (typeof kind !== 'string' || !kind) fail(fn, `expected a non-empty data kind, got ${String(kind)}`)
  const isLoader = typeof provider === 'function'
  if (!isLoader && (typeof provider !== 'object' || provider === null)) {
    fail(fn, `'${kind}': expected a feed object or a loader`)
  }
  if (providers.has(kind)) console.warn(`[aiui sdk] ${fn}('${kind}') replaces an earlier provider`)
  const entry: DataEntry = isLoader
    ? { value: null, load: provider as () => Promise<unknown>, state: 'idle' }
    : { value: provider as object, state: 'ready' }
  providers.set(kind, entry)
  fire(dataListeners)
  return () => {
    if (providers.get(kind) !== entry) return
    providers.delete(kind)
    fire(dataListeners)
  }
}

/** The feed of `kind` when it is provided and loaded, else null. Never starts a load. */
export function getLayoutData<K extends LayoutDataKind>(kind: K): LayoutDataMap[K] | null {
  return (providers.get(kind)?.value as LayoutDataMap[K] | undefined) ?? null
}

/**
 * The feed of `kind`, loading a lazy provider on first use. Resolves to null
 * when nothing provides the kind or its loader failed (logged once; a new
 * provideLayoutData() call tries again).
 */
export function loadLayoutData<K extends LayoutDataKind>(kind: K): Promise<LayoutDataMap[K] | null> {
  const entry = providers.get(kind)
  if (!entry) return Promise.resolve(null)
  if (entry.state === 'ready' || entry.state === 'error' || !entry.load) {
    return Promise.resolve(entry.value as LayoutDataMap[K] | null)
  }
  if (!entry.promise) {
    entry.state = 'loading'
    const load = entry.load
    entry.promise = Promise.resolve()
      .then(load)
      .then((value) => {
        if (typeof value !== 'object' || value === null) throw new TypeError('the loader did not resolve to a feed object')
        return value
      })
      .then(
        (value) => {
          if (providers.get(kind) !== entry) return null
          entry.value = value
          entry.state = 'ready'
          fire(dataListeners)
          return value
        },
        (err: unknown) => {
          entry.state = 'error'
          console.error(`[aiui sdk] layout data '${kind}' failed to load`, err)
          return null
        },
      )
  }
  return entry.promise as Promise<LayoutDataMap[K] | null>
}

/**
 * React hook: the feed of `kind`, or null while nothing provides it (the
 * plugin is off) or its lazy provider is still loading. Re-renders when it
 * arrives. A frame must render without it: hide the panel or show an empty
 * state.
 */
export function useLayoutData<K extends LayoutDataKind>(kind: K): LayoutDataMap[K] | null {
  const read = () => getLayoutData(kind)
  const value = useSyncExternalStore(subscribeData, read, read)
  // Starting a lazy load is idempotent (a cache read), so it is safe here.
  if (value === null && providers.get(kind)?.state === 'idle') void loadLayoutData(kind)
  return value
}

/** Test hook: no layouts, no feeds, classic frame, default host. */
export function resetLayoutsForTests(): void {
  layouts.clear()
  providers.clear()
  activeId = ''
  layoutHost = defaultLayoutHost
  emitLayouts()
  fire(dataListeners)
}
