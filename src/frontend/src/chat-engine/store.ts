/**
 * chat-engine/store.ts — module-level, session-keyed thread store.
 *
 * A stream belongs to its session, not to a component: switching sessions (or
 * leaving the page) never kills another session's run. The store keeps the
 * FULL message list (history + live turn), which is what ExternalStoreRuntime
 * wants as `messages`.
 *
 * Streaming updates are applied immediately but listeners are notified at most
 * once per animation frame; user actions (send, cancel, approve) notify at once.
 *
 * WS drops: a turn whose socket closes mid-run is kept running in a
 * "reconnecting" state and keeps listening for its session. When the socket is
 * back, the persisted history decides: a reply that finished offline is merged
 * in and the turn ends. Otherwise the server is asked whether the run is still
 * alive (`run_status`): a run that died with an old server process ends the
 * turn at once; one still going keeps the turn running behind a 60 s watchdog
 * that is re-armed by every event (also the fallback for older servers).
 *
 * Other tabs: `observe()` follows the selected session's runs that this tab
 * did not start, as a read-only live message, and reloads the history when
 * one ends.
 */
import {
  APPROVAL_ERROR, APPROVAL_PENDING, applyEvent, fromHistory, genId, hasPendingApprovalNotice, newAssistant, reconcileFromHistory, TERMINAL,
  type AiuiMessage, type AiuiSessionSignals, type AiuiToolPart, type ConnectionStatus, type JSONObject, type WireEvent,
} from './protocol'
import { AskUnavailableError, canRegenerate, isAbortError, isDisconnectError, type AiuiTransport } from './transports'

export interface SessionThread {
  sessionId: string
  messages: AiuiMessage[]
  isRunning: boolean
  isLoading: boolean
  loaded: boolean
  activeRunId?: string
  /** The live turn lost its connection and waits for the socket to come back. */
  reconnecting?: boolean
  /** Older messages exist on the server (see loadEarlier). */
  hasMore?: boolean
  /** Server position of the first loaded history message (paging cursor). */
  historyStart?: number
  isLoadingEarlier?: boolean
  signals: AiuiSessionSignals
}

interface Turn {
  id: string
  messageId: string
  userText: string
  transport: AiuiTransport
  runId?: string
  /** No longer owned by transport.send(): events arrive through transport.watch(). */
  detached: boolean
  unwatch?: () => void
  watchdog?: ReturnType<typeof setTimeout>
}

/** Another tab's run in this session, shown read-only. */
interface RemoteRun {
  runId: string
  messageId: string
}

interface Entry {
  state: SessionThread
  listeners: Set<() => void>
  abort: AbortController | null
  turn: Turn | null
  remote: RemoteRun | null
}

export const RECONNECT_WATCHDOG_MS = 60_000

function lastIndex<T>(a: readonly T[], f: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return i
  return -1
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const errorText = (err: unknown) => {
  // A fetch that never reached the server rejects with a bare TypeError
  // ("Failed to fetch", "network error", "Load failed").
  if (err instanceof TypeError) return 'Could not reach the server. Check the connection and try again.'
  return err instanceof Error && err.message ? err.message : 'Something went wrong'
}
export const INTERRUPTED = 'The connection dropped and the reply did not finish.'

function withQuery(url: string, params: Record<string, string | number>): string {
  const q = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  return url + (url.includes('?') ? '&' : '?') + q
}

interface HistoryPage {
  messages: AiuiMessage[]
  start?: number
  hasMore: boolean
}

async function fetchHistory(url: string): Promise<HistoryPage> {
  const res = await fetch(url, { credentials: 'same-origin' })
  const data = res.ok ? ((await res.json()) as JSONObject) : {}
  const raw = ((data.messages ?? data.runs ?? []) as JSONObject[]).filter((m) => m && typeof m === 'object')
  const start = typeof data.start === 'number' ? data.start : undefined
  return {
    // Persisted messages carry no id: number them by their position on the
    // server, so every page gets distinct, stable ids (h_<position>). With the
    // index inside the page, each page reused h_0..h_49 and assistant-ui
    // dropped the older page as duplicates.
    messages: raw.map((m, i) => fromHistory(m, (start ?? 0) + i)),
    start,
    hasMore: data.has_more === true,
  }
}

/**
 * The earlier pages the reader already loaded (Load earlier messages) that
 * come before a freshly fetched latest page: a reload of the latest page
 * keeps them instead of throwing them away. They are the first
 * `page.start - historyStart` messages of the thread, which start at the
 * server position `historyStart`.
 */
function earlierPages(s: SessionThread, page: HistoryPage): { messages: AiuiMessage[]; paging: Partial<SessionThread> } | null {
  if (s.historyStart === undefined || page.start === undefined || s.historyStart >= page.start) return null
  const count = page.start - s.historyStart
  const ids = new Set(page.messages.map((m) => m.id))
  const messages = s.messages.slice(0, count).filter((m) => !ids.has(m.id))
  if (!messages.length) return null
  return { messages, paging: { hasMore: s.hasMore, historyStart: s.historyStart } }
}

const entries = new Map<string, Entry>()
let connection: ConnectionStatus | undefined
let historyUrlFor = (sid: string) => `/api/chat/history/${encodeURIComponent(sid)}`
let watchdogMs = RECONNECT_WATCHDOG_MS
const settledFns = new Set<(sid: string) => void>()
const reconnectBindings = new WeakMap<AiuiTransport, () => void>()

const EMPTY: SessionThread = { sessionId: '', messages: [], isRunning: false, isLoading: false, loaded: true, signals: {} }

function entry(sid: string): Entry {
  let e = entries.get(sid)
  if (!e) {
    e = {
      state: { ...EMPTY, sessionId: sid, loaded: false, signals: connection ? { connection } : {} },
      listeners: new Set(),
      abort: null,
      turn: null,
      remote: null,
    }
    entries.set(sid, e)
  }
  return e
}

// ── notification batching ──────────────────────────────────────────────
const dirty = new Set<Entry>()
let frameQueued = false
const nextFrame = (cb: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb)
  else setTimeout(cb, 16)
}

function flush() {
  frameQueued = false
  const list = [...dirty]
  dirty.clear()
  for (const e of list) for (const l of [...e.listeners]) l()
}

function notify(e: Entry, sync: boolean) {
  dirty.add(e)
  if (sync) flush()
  else if (!frameQueued) {
    frameQueued = true
    nextFrame(flush)
  }
}

// Which sessions have a live turn (session rail spinners); snapshot is cached for useSyncExternalStore.
const activityFns = new Set<() => void>()
let runningSnapshot: ReadonlySet<string> = new Set()

function refreshRunning() {
  const next = new Set<string>()
  for (const [sid, e] of entries) if (e.state.isRunning) next.add(sid)
  if (next.size === runningSnapshot.size && [...next].every((x) => runningSnapshot.has(x))) return
  runningSnapshot = next
  for (const fn of [...activityFns]) fn()
}

function set(
  sid: string,
  patch: Partial<SessionThread> | ((s: SessionThread) => Partial<SessionThread>),
  sync = false,
) {
  const e = entry(sid)
  const p = typeof patch === 'function' ? patch(e.state) : patch
  const wasRunning = e.state.isRunning
  e.state = { ...e.state, ...p }
  notify(e, sync)
  if (e.state.isRunning !== wasRunning) refreshRunning()
}

/** Patch the turn's own assistant message (falls back to the last assistant message). */
function patchMessage(sid: string, messageId: string | undefined, fn: (m: AiuiMessage) => AiuiMessage, sync = false) {
  set(sid, (s) => {
    let i = messageId ? lastIndex(s.messages, (m) => m.id === messageId) : -1
    if (i < 0) i = lastIndex(s.messages, (m) => m.role === 'assistant')
    if (i < 0) return {}
    const next = fn(s.messages[i])
    if (next === s.messages[i]) return {}
    const messages = s.messages.slice()
    messages[i] = next
    return { messages }
  }, sync)
}

function clearWatchdog(turn: Turn) {
  if (turn.watchdog !== undefined) clearTimeout(turn.watchdog)
  turn.watchdog = undefined
}

function armWatchdog(sid: string, turn: Turn) {
  clearWatchdog(turn)
  turn.watchdog = setTimeout(() => {
    const e = entries.get(sid)
    if (!e || e.turn !== turn) return
    patchMessage(sid, turn.messageId, (m) =>
      m.status?.type === 'running' || m.status?.type === 'requires-action'
        ? { ...m, status: { type: 'incomplete', reason: 'error', error: INTERRUPTED } }
        : m,
    )
    endTurn(sid, turn)
  }, watchdogMs)
}

function interrupt(sid: string, turn: Turn) {
  patchMessage(sid, turn.messageId, (m) =>
    m.status?.type === 'running' || m.status?.type === 'requires-action'
      ? { ...m, custom: { ...m.custom, reconnecting: undefined }, status: { type: 'incomplete', reason: 'error', error: INTERRUPTED } }
      : m,
  )
  endTurn(sid, turn)
}

function endTurn(sid: string, turn: Turn) {
  const e = entries.get(sid)
  if (!e || e.turn !== turn) return
  clearWatchdog(turn)
  turn.unwatch?.()
  e.turn = null
  e.abort = null
  patchMessage(sid, turn.messageId, (m) => {
    let n = m
    if (n.custom?.reconnecting) n = { ...n, custom: { ...n.custom, reconnecting: undefined } }
    if (n.status?.type === 'running') n = { ...n, status: { type: 'complete' } }
    return n
  })
  set(sid, { isRunning: false, reconnecting: false }, true)
  for (const fn of [...settledFns]) fn(sid)
}

function handleEvent(sid: string, turn: Turn, ev: WireEvent) {
  const e = entries.get(sid)
  if (!e || e.turn !== turn) return // stale turn (cancelled / replaced) or a dropped session
  if (ev.type === 'session') return // the client already owns the id
  const runId = str(ev.run_id)
  const ctid = str(ev.client_turn_id)
  if (ctid && ctid !== turn.id) return // another tab's run of this session
  if (runId) {
    if (turn.runId && turn.runId !== runId) return // another run of this session
    turn.runId = runId
  }
  if (turn.detached) armWatchdog(sid, turn)
  let signals: Partial<AiuiSessionSignals> | undefined
  patchMessage(sid, turn.messageId, (m) => {
    const r = applyEvent(m, ev)
    signals = r.signals
    return r.message
  })
  if (runId || signals) set(sid, (s) => ({ activeRunId: runId ?? s.activeRunId, signals: signals ? { ...s.signals, ...signals } : s.signals }))
  if (turn.detached && TERMINAL.has(ev.type)) endTurn(sid, turn)
}

function bindReconnect(transport: AiuiTransport) {
  if (reconnectBindings.has(transport) || !transport.onReconnect) return
  reconnectBindings.set(
    transport,
    transport.onReconnect(() => {
      for (const [sid, e] of entries) {
        if (e.turn?.detached && e.turn.transport === transport) void reconcile(sid, e.turn)
      }
    }),
  )
}

function enterReconnecting(sid: string, turn: Turn) {
  const e = entries.get(sid)
  if (!e || e.turn !== turn || !turn.transport.watch) return
  turn.detached = true
  e.abort = null
  turn.unwatch = turn.transport.watch(sid, (ev) => handleEvent(sid, turn, ev))
  bindReconnect(turn.transport)
  patchMessage(sid, turn.messageId, (m) => ({ ...m, custom: { ...m.custom, reconnecting: true } }))
  set(sid, { reconnecting: true }, true)
  if (turn.transport.status === 'open') void reconcile(sid, turn)
}

/** After a reconnect: did the run finish while we were away? */
async function reconcile(sid: string, turn: Turn) {
  const e = entries.get(sid)
  if (!e || e.turn !== turn) return
  let raw: JSONObject[] | null = null
  try {
    const res = await fetch(historyUrlFor(sid), { credentials: 'same-origin' })
    if (res.ok) {
      const data = (await res.json()) as JSONObject
      raw = ((data.messages ?? data.runs ?? []) as JSONObject[]).filter((m) => m && typeof m === 'object')
    }
  } catch {
    raw = null
  }
  if (e.turn !== turn) return
  const want = turn.userText.trim()
  const ui = raw ? lastIndex(raw, (m) => m.role === 'user' && String(m.content ?? '').trim() === want) : -1
  const reply = ui >= 0 ? raw!.slice(ui + 1).filter((m) => m.role === 'assistant').pop() : undefined
  if (reply) {
    patchMessage(sid, turn.messageId, (m) => reconcileFromHistory(m, reply))
    endTurn(sid, turn)
    return
  }
  // Not in history: is the run still alive? A server restarted mid-run no
  // longer knows it, so the reply will never finish: end the turn now.
  if (turn.runId && turn.transport.runStatus) {
    const active = await turn.transport.runStatus(turn.runId).catch(() => undefined)
    if (e.turn !== turn) return
    if (active === false) return interrupt(sid, turn)
  }
  // Still running server-side (or the server cannot say): keep listening, bounded by the watchdog.
  patchMessage(sid, turn.messageId, (m) => ({ ...m, custom: { ...m.custom, reconnecting: undefined } }))
  set(sid, { reconnecting: false }, true)
  armWatchdog(sid, turn)
}

/** The decision UI-only keys on a gated part, removed. */
function withoutDecisionState(artifact: JSONObject): JSONObject {
  if (!(APPROVAL_PENDING in artifact) && !(APPROVAL_ERROR in artifact)) return artifact
  const next = { ...artifact }
  delete next[APPROVAL_PENDING]
  delete next[APPROVAL_ERROR]
  return next
}

/** Patch the tool part that carries this approval, wherever it is in the session. */
function patchApprovalPart(sid: string, approvalId: string, fn: (p: AiuiToolPart) => AiuiToolPart) {
  set(sid, (s) => {
    let changed = false
    const messages = s.messages.map((m) => {
      if (m.role !== 'assistant') return m
      let touched = false
      const parts = m.parts.map((p) => {
        if (p.type !== 'tool-call' || p.approval?.id !== approvalId) return p
        const next = fn(p)
        if (next !== p) touched = true
        return next
      })
      if (!touched) return m
      changed = true
      return { ...m, parts }
    })
    return changed ? { messages } : {}
  }, true)
}

function approvalUrl(approvalId: string, approved: boolean): string {
  return `/api/approvals/${encodeURIComponent(approvalId)}/${approved ? 'approve' : 'deny'}`
}

/** Send an approve/deny decision. Resolves when the server accepted it; rejects with the message to show. */
async function postDecision(approvalId: string, approved: boolean, reason: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(approvalUrl(approvalId, approved), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ reason }),
    })
  } catch {
    throw new Error('Could not reach the server; try again')
  }
  if (!res.ok) throw new Error(res.status === 404 ? 'This approval is no longer pending' : `The server answered HTTP ${res.status}`)
}

export interface ApprovalDecision {
  approved: boolean
  text?: string
  optionId?: string
}

export interface SendOptions {
  agentName?: string
  attachmentIds?: string[]
  attachments?: AiuiMessage['attachments']
  /** Answer the last question again (the server replaces the old answer in history). */
  regenerate?: boolean
}

// ── other tabs' runs (read-only) ───────────────────────────────────────

function isLocalRun(e: Entry, runId: string | undefined, ctid: string | undefined): boolean {
  const t = e.turn
  if (!t) return false
  if (ctid) return ctid === t.id
  if (runId && t.runId) return runId === t.runId
  return true // cannot tell (older server, turn without a run id yet): leave it to the turn
}

async function refreshWithRemote(sid: string) {
  const e = entries.get(sid)
  if (!e || e.turn) return // a local turn owns the tail of the thread; just keep the remote message
  let page: HistoryPage
  try {
    page = await fetchHistory(withQuery(historyUrlFor(sid), { limit: 50 }))
  } catch {
    return
  }
  const cur = entries.get(sid)
  if (!cur || cur.turn) return
  set(sid, (s) => {
    const remote = cur.remote ? s.messages.find((m) => m.id === cur.remote!.messageId) : undefined
    const earlier = earlierPages(s, page)
    const history = earlier ? [...earlier.messages, ...page.messages] : page.messages
    return {
      messages: remote ? [...history, remote] : history,
      loaded: true,
      hasMore: page.hasMore,
      historyStart: page.start,
      ...earlier?.paging,
    }
  }, true)
}

function handleRemoteEvent(sid: string, ev: WireEvent) {
  const e = entries.get(sid)
  if (!e || ev.type === 'session') return
  const runId = str(ev.run_id)
  const ctid = str(ev.client_turn_id)
  if (!runId || isLocalRun(e, runId, ctid)) return
  if (!e.remote || e.remote.runId !== runId) {
    if (TERMINAL.has(ev.type)) {
      threadStore.invalidate(sid)
      void threadStore.load(sid)
      return
    }
    const msg = { ...newAssistant(runId, str(ev.agent_name)), custom: { remote: true } }
    e.remote = { runId, messageId: msg.id }
    set(sid, (s) => ({ messages: [...s.messages, msg] }), true)
    void refreshWithRemote(sid) // brings in the other tab's question
  }
  patchMessage(sid, e.remote.messageId, (m) => applyEvent(m, ev).message)
  if (TERMINAL.has(ev.type)) {
    e.remote = null
    if (!e.turn) {
      set(sid, { loaded: false }, true)
      void threadStore.load(sid) // the persisted version replaces the live copy
    }
  }
}

export const threadStore = {
  get(sid: string | null): SessionThread {
    return sid ? entry(sid).state : EMPTY
  },
  subscribe(sid: string | null, fn: () => void): () => void {
    if (!sid) return () => undefined
    const e = entry(sid)
    e.listeners.add(fn)
    return () => {
      e.listeners.delete(fn)
    }
  },
  /** Deliver any batched notifications now (tests, and before reading the DOM). */
  flush,

  configure(opts: { historyUrl?: (sid: string) => string; watchdogMs?: number }) {
    if (opts.historyUrl) historyUrlFor = opts.historyUrl
    if (opts.watchdogMs !== undefined) watchdogMs = opts.watchdogMs
  },

  /** Publish the live transport's state into every thread's signals.connection. */
  setConnection(status: ConnectionStatus | undefined) {
    if (connection === status) return
    connection = status
    for (const e of entries.values()) {
      e.state = { ...e.state, signals: { ...e.state.signals, connection: status } }
      notify(e, false)
    }
    flush()
  },

  /** Session ids with a live turn. Stable identity until the set changes. */
  runningSessions(): ReadonlySet<string> {
    return runningSnapshot
  },
  subscribeRunning(fn: () => void): () => void {
    activityFns.add(fn)
    return () => {
      activityFns.delete(fn)
    }
  },

  /** Called after any turn ends (complete, error, cancel). */
  onSettled(fn: (sid: string) => void): () => void {
    settledFns.add(fn)
    return () => {
      settledFns.delete(fn)
    }
  },

  /** Load persisted history once per session (skipped while a live run exists). */
  async load(sid: string, url?: string): Promise<void> {
    const s = entry(sid).state
    if (s.loaded || s.isLoading || s.isRunning) return
    // Messages already shown are replaced by the history (a reload after
    // invalidate); only those added while it loads (a new turn) are kept.
    const stale = new Set(s.messages.map((m) => m.id))
    set(sid, { isLoading: true }, true)
    let page: HistoryPage = { messages: [], hasMore: false }
    try {
      page = await fetchHistory(url ?? historyUrlFor(sid))
    } catch {
      page = { messages: [], hasMore: false }
    }
    // A reload (after invalidate) keeps the earlier pages the reader loaded.
    const earlier = earlierPages(s, page)
    const history = earlier ? [...earlier.messages, ...page.messages] : page.messages
    const paging = { hasMore: page.hasMore, historyStart: page.start, ...earlier?.paging }
    const remote = entries.get(sid)?.remote
    set(sid, (cur) => {
      // A remote (other tab) live message survives the reload at the end.
      const remoteMsg = remote ? cur.messages.find((m) => m.id === remote.messageId) : undefined
      const live0 = cur.messages.filter((m) => m !== remoteMsg && !stale.has(m.id))
      if (!live0.length) return { messages: remoteMsg ? [...history, remoteMsg] : history, loaded: true, isLoading: false, ...paging }
      cur = { ...cur, messages: live0 }
      // A turn started while history was loading: keep it after the older history.
      const live = cur.messages
      const firstLiveUser = live.find((m) => m.role === 'user')
      const liveText = firstLiveUser?.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()
      let older = history
      const lastHist = older[older.length - 1]
      if (liveText && lastHist?.role === 'user' && lastHist.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim() === liveText) {
        older = older.slice(0, -1)
      }
      return { messages: [...older, ...live, ...(remoteMsg ? [remoteMsg] : [])], loaded: true, isLoading: false, ...paging }
    }, true)
  },

  /** Prepend the page of history before the oldest loaded message (servers that report has_more). */
  async loadEarlier(sid: string, url?: string): Promise<void> {
    const s = entry(sid).state
    if (!s.hasMore || s.isLoadingEarlier || s.historyStart === undefined) return
    set(sid, { isLoadingEarlier: true }, true)
    let page: HistoryPage | null = null
    try {
      page = await fetchHistory(withQuery(url ?? historyUrlFor(sid), { limit: 50, before: s.historyStart }))
    } catch {
      page = null
    }
    set(sid, (cur) => {
      if (!page) return { isLoadingEarlier: false }
      const shown = new Set(cur.messages.map((m) => m.id))
      const older = page.messages.filter((m) => !shown.has(m.id))
      return { messages: [...older, ...cur.messages], hasMore: page.hasMore, historyStart: page.start, isLoadingEarlier: false }
    }, true)
  },

  /**
   * Follow a session's runs that this tab did not start (another tab, a
   * channel): shown as a read-only live message; the history is reloaded when
   * the run ends. Returns stop().
   */
  observe(transport: AiuiTransport, sid: string): () => void {
    if (!transport.watch) return () => undefined
    return transport.watch(sid, (ev) => handleRemoteEvent(sid, ev))
  },

  async send(transport: AiuiTransport, sid: string, text: string, opts: SendOptions = {}): Promise<void> {
    const e = entry(sid)
    if (e.state.isRunning) return // queueing is a follow-up; the composer is disabled while running
    const user: AiuiMessage = {
      id: genId('u'), role: 'user', createdAt: Date.now(),
      parts: [{ type: 'text', id: genId('t'), text }], attachments: opts.attachments,
    }
    const asst = newAssistant(undefined, opts.agentName)
    const turn: Turn = { id: genId('turn'), messageId: asst.id, userText: text, transport, detached: false }
    const regenerate = !!opts.regenerate && canRegenerate(transport, sid)
    const ac = new AbortController()
    e.turn = turn
    e.abort = ac
    set(sid, (s) => ({ messages: [...s.messages, user, asst], isRunning: true, loaded: true, activeRunId: undefined, reconnecting: false }), true)
    try {
      await transport.send({
        sessionId: sid,
        text,
        agentName: opts.agentName,
        attachmentIds: opts.attachmentIds,
        signal: ac.signal,
        clientTurnId: turn.id,
        regenerate: regenerate || undefined,
        onEvent: (ev) => handleEvent(sid, turn, ev),
        onStart: ({ kind }) => {
          if (e.turn === turn) patchMessage(sid, turn.messageId, (m) => ({ ...m, custom: { ...m.custom, via: kind } }), true)
        },
      })
      if (e.turn === turn && !ac.signal.aborted && !turn.detached) endTurn(sid, turn)
    } catch (err) {
      if (e.turn !== turn || ac.signal.aborted || isAbortError(err)) return
      if (isDisconnectError(err) && transport.watch) {
        enterReconnecting(sid, turn)
        return
      }
      patchMessage(sid, turn.messageId, (m) => ({ ...m, status: { type: 'incomplete', reason: 'error', error: errorText(err) } }))
      endTurn(sid, turn)
    }
  },

  /** Stop the live turn: abort locally at once, then tell the server (chat_abort / POST /cancel). */
  async cancel(transport: AiuiTransport, sid: string): Promise<void> {
    const e = entry(sid)
    const turn = e.turn
    if (!turn && !e.state.isRunning) return
    const runId = turn?.runId ?? e.state.activeRunId
    e.abort?.abort()
    if (turn) {
      clearWatchdog(turn)
      turn.unwatch?.()
    }
    e.turn = null
    e.abort = null
    patchMessage(sid, turn?.messageId, (m) =>
      m.status?.type === 'running' || m.status?.type === 'requires-action'
        ? { ...m, custom: { ...m.custom, reconnecting: undefined }, status: { type: 'incomplete', reason: 'cancelled' } }
        : m,
    )
    set(sid, { isRunning: false, reconnecting: false }, true)
    for (const fn of [...settledFns]) fn(sid)
    await (turn?.transport ?? transport).cancel(sid, runId)
  },

  /**
   * Decide an approval gate (POST /api/approvals/{id}/approve|deny) or answer an
   * ask (WS ask_response). The gate stays open, marked APPROVAL_PENDING, until
   * the server accepts; then the decision is recorded. When the server rejects
   * it (404 once the approval is gone, another HTTP error, no network, no ask
   * channel) the gate stays open with APPROVAL_ERROR set on the part, and the
   * promise rejects with the same message.
   */
  async respondApproval(transport: AiuiTransport, sid: string, approvalId: string, d: ApprovalDecision): Promise<void> {
    const part = threadStore.findApproval(sid, approvalId)
    if (!part?.approval || part.approval.approved !== undefined || part.artifact[APPROVAL_PENDING]) return
    const ask = part.toolName === 'aiui_ask'
    const answer = ask ? d.text ?? part.approval.options?.find((o) => o.id === d.optionId)?.label ?? '' : d.text
    const fail = (message: string) => {
      patchApprovalPart(sid, approvalId, (p) => {
        const artifact = withoutDecisionState(p.artifact)
        // The stream may have decided the gate meanwhile (the tool ran): nothing to report then.
        return { ...p, artifact: p.approval?.approved === undefined ? { ...artifact, [APPROVAL_ERROR]: message } : artifact }
      })
      return new Error(message)
    }
    if (ask && transport.canAnswerAsk && !transport.canAnswerAsk(sid)) {
      const err = new AskUnavailableError()
      fail(err.message)
      throw err
    }
    const pending = ask ? 'answer' : d.approved ? 'approve' : 'deny'
    patchApprovalPart(sid, approvalId, (p) => ({ ...p, artifact: { ...withoutDecisionState(p.artifact), [APPROVAL_PENDING]: pending } }))
    try {
      if (ask) await transport.respondAsk(sid, str(part.artifact.run_id), answer ?? '')
      else await postDecision(approvalId, d.approved, d.text ?? '')
    } catch (err) {
      throw fail(errorText(err))
    }
    threadStore.resolveApproval(sid, approvalId, ask ? true : d.approved, answer, d.optionId)
  },

  /** Record an approval/ask decision on its tool part. */
  resolveApproval(sid: string, approvalId: string, approved: boolean, text?: string, optionId?: string) {
    set(sid, (s) => ({
      messages: s.messages.map((m) => {
        if (m.role !== 'assistant') return m
        let touched = false
        const parts = m.parts.map((p) => {
          if (p.type !== 'tool-call' || p.approval?.id !== approvalId) return p
          touched = true
          const tp: AiuiToolPart = { ...p, artifact: withoutDecisionState(p.artifact), approval: { ...p.approval, approved, text, optionId } }
          if (p.toolName === 'aiui_ask') tp.result = text ?? null
          return tp
        })
        if (!touched) return m
        const open = parts.some((p) => p.type === 'tool-call' && p.approval && p.approval.approved === undefined)
        const status = !open && m.status?.type === 'requires-action'
          ? (s.isRunning ? { type: 'running' as const } : { type: 'complete' as const })
          : m.status
        return { ...m, parts, status }
      }),
    }), true)
  },

  /** Reopen a recorded decision (the server rejected it), optionally with the message to show on the gate. */
  revertApproval(sid: string, approvalId: string, error?: string) {
    set(sid, (s) => ({
      messages: s.messages.map((m) => {
        if (m.role !== 'assistant') return m
        let reason: 'interrupt' | 'tool-calls' | undefined
        const parts = m.parts.map((p) => {
          if (p.type !== 'tool-call' || p.approval?.id !== approvalId) return p
          reason = p.toolName === 'aiui_ask' ? 'interrupt' : 'tool-calls'
          const artifact = withoutDecisionState(p.artifact)
          const tp: AiuiToolPart = {
            ...p,
            artifact: error ? { ...artifact, [APPROVAL_ERROR]: error } : artifact,
            approval: { ...p.approval, approved: undefined, text: undefined, optionId: undefined },
          }
          if (p.toolName === 'aiui_ask') delete tp.result
          return tp
        })
        if (!reason) return m
        return { ...m, parts, status: { type: 'requires-action', reason } }
      }),
    }), true)
  },

  /**
   * An approval described outside the chat stream (the `aiui:approval-required`
   * window event, which carries the approval record). Older WS servers drop a
   * gate's details, so the live message only shows an "approval pending"
   * placeholder; this turns it into a real Approve/Deny gate. Only a live turn
   * with that placeholder is touched (matched by session_id when the record has
   * one, else when exactly one session is waiting). Returns the session used.
   */
  injectApproval(detail: JSONObject): string | null {
    const want = str(detail.session_id)
    const waiting: [string, Turn][] = []
    for (const [sid, e] of entries) {
      if (!e.turn || (want && sid !== want)) continue
      const m = e.state.messages.find((x) => x.id === e.turn!.messageId)
      if (m && hasPendingApprovalNotice(m)) waiting.push([sid, e.turn])
    }
    if (waiting.length !== 1 || !(str(detail.id) ?? str(detail.approval_id))) return null
    const [sid, turn] = waiting[0]
    patchMessage(sid, turn.messageId, (m) => applyEvent(m, { ...detail, type: 'approval_required' }).message, true)
    return sid
  },

  findApproval(sid: string, approvalId: string): AiuiToolPart | undefined {
    for (const m of entry(sid).state.messages) {
      for (const p of m.parts) if (p.type === 'tool-call' && p.approval?.id === approvalId) return p
    }
    return undefined
  },

  /** Which message carries this approval (for transport/via lookups). */
  findApprovalMessage(sid: string, approvalId: string): AiuiMessage | undefined {
    return entry(sid).state.messages.find((m) => m.parts.some((p) => p.type === 'tool-call' && p.approval?.id === approvalId))
  },

  setFeedback(sid: string, messageId: string, type: 'positive' | 'negative' | undefined) {
    set(sid, (s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, custom: { ...m.custom, feedback: type } } : m)) }), true)
  },

  /** Drop the last assistant turn (regenerate) and return the user text that produced it. */
  popLastTurn(sid: string): { text: string; attachments?: AiuiMessage['attachments'] } | null {
    const msgs = entry(sid).state.messages
    const ui = lastIndex(msgs, (m) => m.role === 'user')
    if (ui < 0) return null
    const u = msgs[ui]
    const text = u.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    set(sid, { messages: msgs.slice(0, ui) }, true)
    return { text, attachments: u.attachments }
  },

  invalidate(sid: string) {
    if (entries.get(sid)?.state.isRunning) return
    set(sid, { loaded: false }, true)
  },

  /** Forget a session (deleted). A live turn is aborted locally; call cancel() first to stop it server-side. */
  drop(sid: string) {
    const e = entries.get(sid)
    if (!e) return
    e.abort?.abort()
    if (e.turn) {
      clearWatchdog(e.turn)
      e.turn.unwatch?.()
    }
    e.turn = null
    e.abort = null
    e.remote = null
    e.state = { ...EMPTY, sessionId: sid, loaded: true, signals: e.state.signals }
    notify(e, true)
    if (!e.listeners.size) entries.delete(sid)
    refreshRunning()
  },

  /** Test helper: forget every session. */
  reset() {
    for (const sid of [...entries.keys()]) threadStore.drop(sid)
    entries.clear()
    connection = undefined
  },
}
