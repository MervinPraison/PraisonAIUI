/**
 * chat-engine/sessionsStore.ts — the chat's session list and selection as
 * module state (ADR 0003 §3).
 *
 * The chat page used to keep these in component state. A layout frame draws
 * the session list itself (`meta.chat.sessions: 'frame' | 'tabs'`), often
 * while the chat page is not on screen, so the list, the selected session
 * and the one shared chat transport live here, and both the page and the
 * SessionsFeed (./feeds) read the same store.
 *
 * No React and no assistant-ui: it runs under node --test.
 */
import { deleteSession, fetchSessions, renameSession, type ChatSession } from './api'
import { addLocalSession, markListed, mergeSessions, removeLocalSession, renameLocalSession, type LocalSessions } from './sessionList'
import { threadStore } from './store'
import { createAutoTransport, type AiuiTransport } from './transports'

export interface SessionsSnapshot {
  /** Server list plus chats started here that the server has not listed yet. */
  readonly sessions: readonly ChatSession[]
  /** The open chat (null: a new, empty chat). */
  readonly activeId: string | null
  /** True until the first list request has finished. */
  readonly loading: boolean
  readonly error: string | null
  /** Counts changes of `activeId`: a view can tell whether the selection moved since it looked. */
  readonly selection: number
}

/** A finished turn may have created or retitled a session: refresh this long after it settles. */
export const SETTLE_REFRESH_MS = 300

let server: ChatSession[] = []
let local: LocalSessions = {}
let activeId: string | null = null
let selection = 0
let loading = true
let error: string | null = null
let snapshot: SessionsSnapshot = build()
const listeners = new Set<() => void>()
/** Chats deleted in this tab: a list request already in flight when the delete finished must not bring them back. */
const deletedIds = new Set<string>()
let refreshSeq = 0
let offSettled: (() => void) | null = null
let settleTimer: ReturnType<typeof setTimeout> | undefined
let sharedTransport: AiuiTransport | null = null

function build(): SessionsSnapshot {
  return { sessions: mergeSessions(server, local), activeId, loading, error, selection }
}

function setActive(id: string | null) {
  if (id === activeId) return
  activeId = id
  selection++
}

function emit() {
  snapshot = build()
  for (const fn of [...listeners]) fn()
}

/** A turn ended: refresh shortly after it settles (debounced). */
function settled() {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => void sessionsStore.refresh(), SETTLE_REFRESH_MS)
}

/** The last listener left: stop watching turns. */
function unwatchSettled() {
  offSettled?.()
  offSettled = null
  clearTimeout(settleTimer)
}

/** One WebSocket for every chat view and feed; streams outlive the page component. */
export function chatTransport(): AiuiTransport {
  return (sharedTransport ??= createAutoTransport())
}

export const sessionsStore = {
  /** The same object until something changes (useSyncExternalStore-ready). */
  get(): SessionsSnapshot {
    return snapshot
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    // While anyone listens, a finished turn (a new or retitled chat) refreshes the list.
    offSettled ??= threadStore.onSettled(settled)
    return () => {
      listeners.delete(fn)
      if (!listeners.size) unwatchSettled()
    }
  },

  /** Fetch the server's list. A newer refresh wins over an older one still in flight. */
  async refresh(): Promise<void> {
    const seq = ++refreshSeq
    try {
      const list = (await fetchSessions()).filter((s) => !deletedIds.has(s.id))
      if (seq !== refreshSeq) return
      server = list
      local = markListed(local, list)
      error = null
    } catch {
      if (seq === refreshSeq) error = 'Chats could not be loaded'
    } finally {
      if (seq === refreshSeq) {
        loading = false
        emit()
      }
    }
  },

  /** Open a session (null: a new chat). */
  select(id: string | null): void {
    if (id === activeId) return
    setActive(id)
    emit()
  },

  /**
   * A chat was just started here: list it under its first user message until
   * the server lists it, and select it.
   */
  noteCreated(id: string): void {
    const first = threadStore.get(id).messages.find((m) => m.role === 'user')
    const text = first?.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ').replace(/\s+/g, ' ').trim()
    if (text) local = addLocalSession(local, id, text.length > 60 ? `${text.slice(0, 57)}…` : text)
    setActive(id)
    emit()
  },

  async rename(id: string, title: string): Promise<void> {
    await renameSession(id, title)
    server = server.map((s) => (s.id === id ? { ...s, title, untitled: false } : s))
    // A chat started here may not be listed by the server yet; its row comes from the local entry.
    local = renameLocalSession(local, id, title)
    emit()
  },

  /** Stop a live run, delete the chat, and select a new chat if it was open. */
  async remove(id: string, transport: AiuiTransport): Promise<void> {
    if (threadStore.get(id).isRunning) await threadStore.cancel(transport, id)
    await deleteSession(id)
    deletedIds.add(id)
    threadStore.drop(id)
    server = server.filter((s) => s.id !== id)
    local = removeLocalSession(local, id)
    if (activeId === id) setActive(null)
    emit()
  },
}

/** Test hook: back to an empty, loading store with no listeners. */
export function resetSessionsForTests(): void {
  unwatchSettled()
  listeners.clear()
  deletedIds.clear()
  server = []
  local = {}
  activeId = null
  selection = 0
  loading = true
  error = null
  refreshSeq = 0
  sharedTransport = null
  snapshot = build()
}
