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
 * in and the turn ends; otherwise the turn keeps running behind a 60 s
 * watchdog that is re-armed by every event.
 */
import {
  applyEvent, fromHistory, genId, hasPendingApprovalNotice, newAssistant, reconcileFromHistory, TERMINAL,
  type AiuiMessage, type AiuiSessionSignals, type AiuiToolPart, type ConnectionStatus, type JSONObject, type WireEvent,
} from './protocol'
import { isAbortError, isDisconnectError, type AiuiTransport } from './transports'

export interface SessionThread {
  sessionId: string
  messages: AiuiMessage[]
  isRunning: boolean
  isLoading: boolean
  loaded: boolean
  activeRunId?: string
  /** The live turn lost its connection and waits for the socket to come back. */
  reconnecting?: boolean
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

interface Entry {
  state: SessionThread
  listeners: Set<() => void>
  abort: AbortController | null
  turn: Turn | null
}

export const RECONNECT_WATCHDOG_MS = 60_000

function lastIndex<T>(a: readonly T[], f: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i])) return i
  return -1
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'Something went wrong')

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
        ? { ...m, status: { type: 'incomplete', reason: 'error', error: 'The connection dropped and the reply did not finish.' } }
        : m,
    )
    endTurn(sid, turn)
  }, watchdogMs)
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
  // Still running server-side (or history is unavailable): keep listening, bounded by the watchdog.
  patchMessage(sid, turn.messageId, (m) => ({ ...m, custom: { ...m.custom, reconnecting: undefined } }))
  set(sid, { reconnecting: false }, true)
  armWatchdog(sid, turn)
}

export interface SendOptions {
  agentName?: string
  attachmentIds?: string[]
  attachments?: AiuiMessage['attachments']
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
    set(sid, { isLoading: true }, true)
    let history: AiuiMessage[] = []
    try {
      const res = await fetch(url ?? historyUrlFor(sid), { credentials: 'same-origin' })
      const data = res.ok ? ((await res.json()) as JSONObject) : {}
      const raw = ((data.messages ?? data.runs ?? []) as JSONObject[]).filter((m) => m && typeof m === 'object')
      history = raw.map(fromHistory)
    } catch {
      history = []
    }
    set(sid, (cur) => {
      if (!cur.messages.length) return { messages: history, loaded: true, isLoading: false }
      // A turn started while history was loading: keep it after the older history.
      const live = cur.messages
      const firstLiveUser = live.find((m) => m.role === 'user')
      const liveText = firstLiveUser?.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim()
      let older = history
      const lastHist = older[older.length - 1]
      if (liveText && lastHist?.role === 'user' && lastHist.parts.map((p) => (p.type === 'text' ? p.text : '')).join('').trim() === liveText) {
        older = older.slice(0, -1)
      }
      return { messages: [...older, ...live], loaded: true, isLoading: false }
    }, true)
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

  /** Record an approval/ask decision on its tool part (optimistic). */
  resolveApproval(sid: string, approvalId: string, approved: boolean, text?: string, optionId?: string) {
    set(sid, (s) => ({
      messages: s.messages.map((m) => {
        if (m.role !== 'assistant') return m
        let touched = false
        const parts = m.parts.map((p) => {
          if (p.type !== 'tool-call' || p.approval?.id !== approvalId) return p
          touched = true
          const tp: AiuiToolPart = { ...p, approval: { ...p.approval, approved, text, optionId } }
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

  /** Undo an optimistic decision that the server rejected, so the controls are usable again. */
  revertApproval(sid: string, approvalId: string) {
    set(sid, (s) => ({
      messages: s.messages.map((m) => {
        if (m.role !== 'assistant') return m
        let reason: 'interrupt' | 'tool-calls' | undefined
        const parts = m.parts.map((p) => {
          if (p.type !== 'tool-call' || p.approval?.id !== approvalId) return p
          reason = p.toolName === 'aiui_ask' ? 'interrupt' : 'tool-calls'
          const tp: AiuiToolPart = { ...p, approval: { ...p.approval, approved: undefined, text: undefined, optionId: undefined } }
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
