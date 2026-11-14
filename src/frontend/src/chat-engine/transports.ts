/**
 * chat-engine/transports.ts — how a turn reaches the server.
 *
 *  createWsTransport():   /api/chat/ws {chat | chat_abort | ask_response | ping | subscribe}
 *                         The canonical transport: run ids, attachments, ask answers, abort by run.
 *  createSseTransport():  POST /run (+ POST /cancel). Fallback; it cannot answer ask prompts.
 *  createAutoTransport(): WS when it opens within 3 s, else SSE for that turn.
 *
 * Transports deliver raw WireEvents to `onEvent`; the store owns all state.
 *
 * WS protocol notes (features/chat.py):
 *  - The server fans events out by session_id. Newer servers (WP3) honour a
 *    `{type:'subscribe', session_ids}` message and only send subscribed
 *    sessions; older servers ignore it and send everything, so events for a
 *    session with no local listener are dropped here.
 *    Subscriptions only ever grow during a connection (events of a session
 *    with no listener are simply dropped here). A subscription only grants
 *    delivery: stopping or answering a run needs the connection that started
 *    a turn in its session.
 *  - `chat_abort` is answered with `{type:'chat_abort_result', status, run_id}`
 *    (older servers: the same without `type`), `ask_response` with
 *    `{type:'ask_response_ack'}`, `subscribe` with `{type:'subscribed'}`, `ping`
 *    with `{type:'pong'}`.
 *  - Several tabs on one session: every `chat` frame carries a
 *    `client_turn_id`; newer servers echo it on every event of that run. A
 *    turn binds to the run that names it, and other runs' events go to the
 *    session's watchers (a read-only view), never into the turn. With older
 *    servers (no echo) a turn binds to the first run it sees that did not
 *    start before the turn did.
 *  - Auth: browsers cannot put an Authorization header on a WebSocket
 *    handshake. When a gateway token is stored (the sessionStorage key
 *    dashboard.js and the shell use), each handshake first trades it for a
 *    single-use ticket (`POST /api/auth/ws-ticket`) sent as `?ticket=`, so the
 *    long-lived key never appears in a URL or an access log. Servers without
 *    that endpoint get `?token=` as before.
 *  - `{type:'run_status', run_id}` asks whether a run is still alive (after a
 *    reconnect); older servers do not answer, which reads as "unknown".
 */
import { TERMINAL, type ConnectionStatus, type WireEvent } from './protocol'

export type { ConnectionStatus }

export interface SendArgs {
  sessionId: string
  text: string
  agentName?: string
  attachmentIds?: string[]
  signal: AbortSignal
  onEvent: (ev: WireEvent) => void
  /** Called once the turn is on the wire, with the transport that carries it. */
  onStart?: (info: { kind: 'sse' | 'ws' }) => void
  /** Names this turn on the wire (WS `client_turn_id`), so its run can be told from other tabs' runs. */
  clientTurnId?: string
  /** Answer the session's last question again instead of asking it twice (WS only). */
  regenerate?: boolean
}

export interface AiuiTransport {
  readonly kind: 'sse' | 'ws'
  /** Live-connection state (WS only). */
  readonly status?: ConnectionStatus
  /**
   * Resolves when the turn ends (terminal event, stream end, or abort).
   * Rejects with TransportDisconnectedError when a live socket drops mid-turn.
   */
  send(args: SendArgs): Promise<void>
  /** Stop a run. Without a run id (Stop before run_started) the WS transport aborts the next run it sees for the session. */
  cancel(sessionId: string, runId?: string): Promise<void>
  /** Answer a run_paused ask prompt. Throws AskUnavailableError when the turn has no live channel (SSE). */
  respondAsk(sessionId: string, runId: string | undefined, response: string): Promise<void>
  /** Whether an ask prompt in this session can be answered (false for turns carried by SSE). */
  canAnswerAsk?(sessionId: string): boolean
  onStatus?(fn: (status: ConnectionStatus) => void): () => void
  /** Called when the socket opens again after a drop. */
  onReconnect?(fn: () => void): () => void
  /** Receive a session's events without sending a turn (resuming a run after a reconnect). */
  watch?(sessionId: string, onEvent: (ev: WireEvent) => void): () => void
  /** Keep the live connection (and its reconnect loop) up while a view needs it. Returns release(). */
  retain?(): () => void
  /** Is this run still alive on the server? `undefined` when the server cannot say. */
  runStatus?(runId: string): Promise<boolean | undefined>
  /** Whether `regenerate` replaces the last answer server-side (WS); otherwise it is a plain resend. */
  canRegenerate?(sessionId: string): boolean
  /** Turns still work over HTTP (SSE) when the live socket is closed (the auto transport). */
  readonly httpFallback?: boolean
}

export class TransportDisconnectedError extends Error {
  constructor(message = 'Connection lost') {
    super(message)
    this.name = 'TransportDisconnectedError'
  }
}

export class AskUnavailableError extends Error {
  constructor(message = 'Answering needs a live connection to the server') {
    super(message)
    this.name = 'AskUnavailableError'
  }
}

/**
 * Can this transport regenerate the session's last answer server-side? When it
 * cannot (SSE, a socket that is not open, a transport without the method), a
 * "regenerate" would only resend the question and leave a duplicate turn in
 * history, so the UI does not offer it.
 */
export const canRegenerate = (t: Pick<AiuiTransport, 'canRegenerate'>, sessionId: string): boolean =>
  t.canRegenerate?.(sessionId) ?? false

export const isDisconnectError = (e: unknown): boolean => e instanceof Error && e.name === 'TransportDisconnectedError'
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

const jsonHeaders = { 'Content-Type': 'application/json' }

export const SSE_DROPPED = 'The connection to the server was lost before the reply finished.'

/** Parse a block of SSE lines into the JSON payload of its `data:` lines. */
function parseSseFrame(frame: string): WireEvent | null {
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  try {
    const ev = JSON.parse(data.join('\n')) as unknown
    return ev && typeof ev === 'object' && typeof (ev as WireEvent).type === 'string' ? (ev as WireEvent) : null
  } catch {
    return null
  }
}

export function createSseTransport(base = ''): AiuiTransport {
  return {
    kind: 'sse',
    async send({ sessionId, text, agentName, attachmentIds, signal, onEvent, onStart }) {
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: jsonHeaders,
        credentials: 'same-origin',
        // NOTE: /run ignores attachment_ids today (server.py run_agent); WS carries them.
        body: JSON.stringify({ message: text, session_id: sessionId, agent: agentName, attachment_ids: attachmentIds }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`The server answered HTTP ${res.status}`)
      onStart?.({ kind: 'sse' })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (err) {
          if (isAbortError(err) || signal.aborted) throw err
          // The fetch reader's own message is a bare "network error" / "Failed to fetch".
          throw new Error(SSE_DROPPED)
        }
        const { done, value } = chunk
        if (done) break
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let nl: number
        // SSE frames are blank-line separated; keep a partial frame in the buffer
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const ev = parseSseFrame(buf.slice(0, nl))
          buf = buf.slice(nl + 2)
          if (ev) onEvent(ev)
        }
      }
      const tail = parseSseFrame(buf + dec.decode())
      if (tail) onEvent(tail)
    },
    async cancel(sessionId) {
      await fetch(`${base}/cancel`, {
        method: 'POST',
        headers: jsonHeaders,
        credentials: 'same-origin',
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => undefined)
    },
    async respondAsk() {
      // /run has no ask channel; ask_response exists only on the WebSocket.
      throw new AskUnavailableError()
    },
    canAnswerAsk: () => false,
  }
}

type WebSocketCtor = new (url: string) => WebSocket

export interface WsTransportOptions {
  /** Defaults to ws(s)://<host>/api/chat/ws (+ ?ticket= or ?token=). Re-read on every (re)connect. */
  url?: string | (() => string | Promise<string>)
  WebSocketImpl?: WebSocketCtor
  /** Reconnect backoff: doubles from min to max, with jitter (50-100 % of the step). */
  minBackoffMs?: number
  maxBackoffMs?: number
  pingIntervalMs?: number
  /** No frame at all within this long after a ping means the socket is dead. */
  pongTimeoutMs?: number
  ackTimeoutMs?: number
  /** How long a Stop pressed before run_started waits for that run to show up. */
  pendingCancelTtlMs?: number
  /** Grace period before an unused socket is closed (absorbs StrictMode remounts). */
  idleCloseMs?: number
  random?: () => number
}

export interface WsTransport extends AiuiTransport {
  readonly kind: 'ws'
  readonly status: ConnectionStatus
  /** Open (or wait for) the socket; rejects on failure or after timeoutMs. */
  connect(timeoutMs?: number): Promise<void>
  /** Close the socket for good and stop reconnecting (tests, teardown). */
  close(): void
}

/** Same key as dashboard.js ONBOARD_TOKEN_KEY and the shell's auth fetch. */
export const TOKEN_STORAGE_KEY = 'aiui_gateway_token'

function storedToken(): string {
  try {
    return globalThis.sessionStorage?.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export const WS_TICKET_URL = '/api/auth/ws-ticket'

/**
 * The query string that authenticates one WebSocket handshake: a single-use
 * ticket bought with the stored token, `?token=` on servers without the ticket
 * endpoint, nothing when no token is stored (cookie or open servers).
 */
export async function wsAuthQuery(fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const token = storedToken()
  if (!token) return ''
  try {
    const res = await fetchImpl(WS_TICKET_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
    })
    if (res.ok) {
      const data = (await res.json()) as { ticket?: unknown }
      if (typeof data.ticket === 'string' && data.ticket) return `?ticket=${encodeURIComponent(data.ticket)}`
    } else if (res.status !== 404 && res.status !== 405) {
      return '' // the token was refused: the handshake fails the same way
    }
  } catch {
    /* network trouble: the handshake will fail and retry */
  }
  return `?token=${encodeURIComponent(token)}`
}

export async function defaultWsUrl(): Promise<string> {
  const loc = globalThis.location
  const base = loc ? `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api/chat/ws` : 'ws://127.0.0.1/api/chat/ws'
  return base + (await wsAuthQuery())
}

const OPEN = 1

/** One shared socket, demultiplexed by session_id (views/chat.js filters the same way). */
export function createWsTransport(options: WsTransportOptions = {}): WsTransport {
  const urlOption = options.url ?? defaultWsUrl
  const resolveUrl = () => (typeof urlOption === 'function' ? urlOption() : urlOption)
  const Impl: WebSocketCtor = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor)
  const minBackoff = options.minBackoffMs ?? 500
  const maxBackoff = options.maxBackoffMs ?? 10_000
  const pingEvery = options.pingIntervalMs ?? 20_000
  const pongTimeout = options.pongTimeoutMs ?? 10_000
  const ackTimeout = options.ackTimeoutMs ?? 10_000
  const cancelTtl = options.pendingCancelTtlMs ?? 30_000
  const idleCloseMs = options.idleCloseMs ?? 250
  const random = options.random ?? Math.random

  type Turn = {
    onEvent: (ev: WireEvent) => void
    runId?: string
    clientTurnId: string
    /** Runs of this session already under way when the turn started: never this turn's. */
    runsBefore: Set<string>
    settle: (err?: Error) => void
  }
  type PendingCancel = { timer: ReturnType<typeof setTimeout>; clientTurnId?: string; runsBefore: Set<string> }
  type StatusWaiter = { runId: string; done: (active: boolean | undefined) => void }
  type Ack = { kind: 'ask' | 'abort'; key: string; done: (ok: boolean, err?: Error) => void }
  type Waiter = { resolve: () => void; reject: (e: Error) => void }

  let sock: WebSocket | null = null
  let status: ConnectionStatus = 'closed'
  let everOpened = false
  let attempt = 0
  let retainCount = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let lastSubscription = ''
  let opening = false
  let openGen = 0
  /** The server echoes client_turn_id (seen once on this transport). */
  let serverCorrelates = false

  const turns = new Map<string, Turn>()
  const watchers = new Map<string, Set<(ev: WireEvent) => void>>()
  const pendingCancel = new Map<string, PendingCancel>()
  /** The last turn sent per session (a Stop before run_started aborts only its run). */
  const lastTurn = new Map<string, { clientTurnId: string; runsBefore: Set<string> }>()
  /** Run ids seen per session (bounded), to tell runs that started before a turn. */
  const sessionRuns = new Map<string, Set<string>>()
  const statusWaiters: StatusWaiter[] = []
  const pendingAborts = new Set<string>()
  const ignoredRuns = new Set<string>()
  const acks: Ack[] = []
  const openWaiters: Waiter[] = []
  const statusFns = new Set<(s: ConnectionStatus) => void>()
  const reconnectFns = new Set<() => void>()

  const setStatus = (next: ConnectionStatus) => {
    if (status === next) return
    status = next
    for (const fn of [...statusFns]) fn(next)
  }

  const wanted = () =>
    retainCount > 0 || turns.size > 0 || watchers.size > 0 || pendingCancel.size > 0 || pendingAborts.size > 0 || acks.length > 0 ||
    statusWaiters.length > 0

  const noteRun = (sid: string, runId: string) => {
    let set = sessionRuns.get(sid)
    if (!set) sessionRuns.set(sid, (set = new Set()))
    set.add(runId)
    if (set.size > 50) set.delete(set.values().next().value as string)
    if (sessionRuns.size > 200) sessionRuns.delete(sessionRuns.keys().next().value as string)
  }

  let turnSeq = 0
  const newClientTurnId = () => `ct_${Date.now().toString(36)}_${(turnSeq++).toString(36)}_${Math.floor(random() * 1e9).toString(36)}`

  /**
   * Is an event of run `runId` (naming turn `ctid`, if the server echoes it)
   * part of the turn `{clientTurnId, runsBefore, runId?}`?
   */
  const ownsRun = (t: { clientTurnId?: string; runsBefore: Set<string>; runId?: string }, runId: string, ctid: string | undefined) => {
    if (t.runId) return t.runId === runId
    if (ctid !== undefined) return ctid === t.clientTurnId
    if (t.runsBefore.has(runId)) return false
    // A server that echoes client_turn_id would have named our own run.
    return !serverCorrelates
  }

  const ignoreRun = (runId: string) => {
    ignoredRuns.add(runId)
    if (ignoredRuns.size > 200) ignoredRuns.delete(ignoredRuns.values().next().value as string)
  }

  const rawSend = (msg: Record<string, unknown>): boolean => {
    if (!sock || sock.readyState !== OPEN) return false
    try {
      sock.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  /** Tell newer servers which sessions this client wants; older servers ignore it. */
  const syncSubscriptions = () => {
    const ids = [...new Set([...turns.keys(), ...watchers.keys(), ...pendingCancel.keys()])].sort()
    if (!ids.length) return // never send an empty list: keep whatever the server already routes
    const key = ids.join('\n')
    if (key === lastSubscription) return
    if (rawSend({ type: 'subscribe', session_ids: ids })) lastSubscription = key
  }

  const waitAck = (kind: Ack['kind'], key: string, onTimeout: 'resolve' | 'reject'): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ack.done(onTimeout === 'resolve', new Error('The server did not acknowledge the request'))
      }, ackTimeout)
      const ack: Ack = {
        kind,
        key,
        done: (ok, err) => {
          clearTimeout(timer)
          const i = acks.indexOf(ack)
          if (i >= 0) acks.splice(i, 1)
          if (ok) resolve()
          else reject(err ?? new Error('Request failed'))
          scheduleIdleCheck()
        },
      }
      acks.push(ack)
    })

  const resolveAck = (kind: Ack['kind'], key: string | undefined) => {
    const ack = acks.find((a) => a.kind === kind && (!key || !a.key || a.key === key)) ?? acks.find((a) => a.kind === kind)
    ack?.done(true)
  }

  const sendAbort = (runId: string): Promise<void> => {
    ignoreRun(runId)
    if (!rawSend({ type: 'chat_abort', run_id: runId })) {
      pendingAborts.add(runId) // delivered when the socket is back
      ensureConnecting()
      return Promise.resolve()
    }
    return waitAck('abort', runId, 'resolve')
  }

  const stopPing = () => {
    if (pingTimer !== undefined) clearInterval(pingTimer)
    if (pongTimer !== undefined) clearTimeout(pongTimer)
    pingTimer = pongTimer = undefined
  }

  const startPing = () => {
    stopPing()
    pingTimer = setInterval(() => {
      if (!rawSend({ type: 'ping' })) return
      if (pongTimer === undefined) {
        const ws = sock
        pongTimer = setTimeout(() => {
          pongTimer = undefined
          if (ws && sock === ws) {
            // Half-open socket: nothing came back. Treat it as closed now.
            handleClose(ws)
            try { ws.close() } catch { /* already closing */ }
          }
        }, pongTimeout)
      }
    }, pingEvery)
  }

  const detach = (ws: WebSocket) => {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
  }

  function scheduleReconnect() {
    if (reconnectTimer !== undefined) return
    const step = Math.min(maxBackoff, minBackoff * 2 ** attempt)
    const delay = Math.round(step / 2 + random() * (step / 2))
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (wanted() || openWaiters.length) openSocket()
      else setStatus('closed')
    }, delay)
  }

  function handleClose(ws: WebSocket) {
    if (sock !== ws) return
    detach(ws)
    sock = null
    lastSubscription = ''
    stopPing()
    setStatus('closed')
    const err = new TransportDisconnectedError()
    for (const w of openWaiters.splice(0)) w.reject(err)
    for (const turn of [...turns.values()]) turn.settle(err)
    for (const w of [...statusWaiters]) w.done(undefined)
    for (const ack of [...acks]) {
      if (ack.kind === 'abort') {
        pendingAborts.add(ack.key) // unknown whether it arrived; chat_abort is idempotent
        ack.done(true)
      } else {
        ack.done(false, err)
      }
    }
    if (wanted()) scheduleReconnect() // status stays 'closed' until the next handshake starts
  }

  function failOpen() {
    setStatus('closed')
    const err = new TransportDisconnectedError('Could not open the chat connection')
    for (const w of openWaiters.splice(0)) w.reject(err)
    if (wanted()) scheduleReconnect()
  }

  function openSocket() {
    if (sock || opening) return
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    setStatus('connecting')
    let url: string | Promise<string>
    try {
      url = resolveUrl()
    } catch {
      return failOpen()
    }
    if (typeof url === 'string') return startSocket(url)
    // Resolving the URL may fetch a handshake ticket first.
    const gen = ++openGen
    opening = true
    url.then(
      (u) => {
        if (gen !== openGen) return // closed meanwhile
        opening = false
        startSocket(u)
      },
      () => {
        if (gen !== openGen) return
        opening = false
        failOpen()
      },
    )
  }

  function startSocket(url: string) {
    let ws: WebSocket
    try {
      ws = new Impl(url)
    } catch {
      return failOpen()
    }
    sock = ws
    ws.onopen = () => {
      if (sock !== ws) return
      attempt = 0
      const reopened = everOpened
      everOpened = true
      setStatus('open')
      syncSubscriptions()
      for (const runId of [...pendingAborts]) {
        pendingAborts.delete(runId)
        void sendAbort(runId)
      }
      startPing()
      for (const w of openWaiters.splice(0)) w.resolve()
      if (reopened) for (const fn of [...reconnectFns]) fn()
      scheduleIdleCheck()
    }
    ws.onmessage = (e: MessageEvent) => {
      if (sock !== ws) return
      if (pongTimer !== undefined) {
        clearTimeout(pongTimer)
        pongTimer = undefined
      }
      handleMessage(e.data)
    }
    ws.onclose = () => handleClose(ws)
    ws.onerror = () => {
      /* a close event always follows */
    }
  }

  function ensureConnecting() {
    if (!sock && !opening && reconnectTimer === undefined) openSocket()
  }

  function shutdown() {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    idleTimer = reconnectTimer = undefined
    stopPing()
    openGen += 1
    opening = false
    const ws = sock
    sock = null
    lastSubscription = ''
    attempt = 0
    if (ws) {
      detach(ws)
      try { ws.close() } catch { /* ignore */ }
    }
    const err = new TransportDisconnectedError('Connection closed')
    for (const w of openWaiters.splice(0)) w.reject(err)
    for (const turn of [...turns.values()]) turn.settle(err)
    setStatus('closed')
  }

  function scheduleIdleCheck() {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = undefined
    if (wanted()) return
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (!wanted() && !openWaiters.length) shutdown()
    }, idleCloseMs)
  }

  function clearPendingCancel(sid: string) {
    const p = pendingCancel.get(sid)
    if (p !== undefined) clearTimeout(p.timer)
    pendingCancel.delete(sid)
    scheduleIdleCheck()
  }

  function handleMessage(raw: unknown) {
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return
    }
    if (!ev || typeof ev !== 'object') return
    const type = ev.type
    const sid = typeof ev.session_id === 'string' ? ev.session_id : undefined
    const runId = typeof ev.run_id === 'string' && ev.run_id ? ev.run_id : undefined
    if (type === 'pong' || type === 'subscribed') return
    if (type === 'ask_response_ack') return resolveAck('ask', sid)
    if (type === 'run_status' && runId) {
      const active = typeof ev.active === 'boolean' ? ev.active : undefined
      for (const w of statusWaiters.filter((x) => x.runId === runId)) w.done(active)
      return
    }
    // chat_abort reply: `{type:'chat_abort_result', status, run_id}` on newer servers,
    // `{status, run_id}` with no type on older ones. 'forbidden' (another client's run)
    // and 'no_active_run' (already over) both end the wait: there is nothing to retry.
    if (type === 'chat_abort_result' || (type === undefined && typeof ev.status === 'string' && 'run_id' in ev)) {
      return resolveAck('abort', runId)
    }
    if (typeof type !== 'string' || !sid) return
    if (runId && ignoredRuns.has(runId)) return
    const ctid = typeof ev.client_turn_id === 'string' && ev.client_turn_id ? ev.client_turn_id : undefined
    if (ctid) serverCorrelates = true

    const turn = turns.get(sid)
    const pending = pendingCancel.get(sid)
    if (pending && !(turn && runId && turn.runId === runId)) {
      if (runId && ownsRun({ ...pending, runId: undefined }, runId, ctid)) {
        // Stop was pressed before run_started: abort our run as soon as it is known.
        clearPendingCancel(sid)
        void sendAbort(runId)
        return
      }
      if (!runId && TERMINAL.has(type) && !turn && (ctid === undefined || ctid === pending.clientTurnId)) {
        clearPendingCancel(sid) // the run ended before it ever had an id (e.g. guardrail)
        return
      }
    }

    const event = ev as WireEvent
    const deliverToWatchers = () => {
      const fns = watchers.get(sid)
      if (fns) for (const fn of [...fns]) fn(event)
      // else: a session this client has no listener for (older servers broadcast everything) -> drop
    }
    if (runId) {
      if (!turn || !ownsRun(turn, runId, ctid)) {
        noteRun(sid, runId)
        deliverToWatchers() // another tab's run of this session: read-only view
        return
      }
      turn.runId ??= runId
      noteRun(sid, runId)
    } else if (turn && ctid !== undefined && ctid !== turn.clientTurnId) {
      return deliverToWatchers() // e.g. another tab's guardrail refusal
    }
    if (turn) {
      turn.onEvent(event)
      if (TERMINAL.has(type)) turn.settle()
      return
    }
    deliverToWatchers()
  }

  function connect(timeoutMs?: number): Promise<void> {
    if (sock && sock.readyState === OPEN && status === 'open') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const waiter: Waiter = {
        resolve: () => {
          if (timer !== undefined) clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          if (timer !== undefined) clearTimeout(timer)
          reject(e)
        },
      }
      openWaiters.push(waiter)
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const i = openWaiters.indexOf(waiter)
          if (i >= 0) openWaiters.splice(i, 1)
          reject(new TransportDisconnectedError('Timed out connecting to the chat server'))
          scheduleIdleCheck()
        }, timeoutMs)
      }
      if (!sock && !opening) openSocket() // connect now, even if a backoff timer is pending
    })
  }

  const transport: WsTransport = {
    kind: 'ws',
    get status() {
      return status
    },
    connect,
    close: shutdown,
    async send({ sessionId, text, agentName, attachmentIds, signal, onEvent, onStart, clientTurnId, regenerate }) {
      if (signal.aborted) return
      try {
        await connect()
      } catch {
        // Nothing was sent, so this is a plain failure, not a dropped turn.
        throw new Error('Could not reach the chat server')
      }
      if (signal.aborted) return
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const onAbort = () => turn.settle()
        const turn: Turn = {
          onEvent,
          clientTurnId: clientTurnId ?? newClientTurnId(),
          runsBefore: new Set(sessionRuns.get(sessionId) ?? []),
          settle: (err) => {
            if (settled) return
            settled = true
            signal.removeEventListener('abort', onAbort)
            if (turns.get(sessionId) === turn) turns.delete(sessionId)
            if (err) reject(err)
            else resolve()
            scheduleIdleCheck()
          },
        }
        turns.get(sessionId)?.settle()
        signal.addEventListener('abort', onAbort, { once: true })
        turns.set(sessionId, turn)
        lastTurn.set(sessionId, { clientTurnId: turn.clientTurnId, runsBefore: turn.runsBefore })
        if (lastTurn.size > 200) lastTurn.delete(lastTurn.keys().next().value as string)
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        syncSubscriptions()
        const sent = rawSend({
          type: 'chat',
          content: text,
          session_id: sessionId,
          agent_name: agentName,
          attachment_ids: attachmentIds,
          client_turn_id: turn.clientTurnId,
          ...(regenerate ? { regenerate: true } : {}),
        })
        if (!sent) {
          turn.settle(new TransportDisconnectedError('The chat connection closed before the message was sent'))
          return
        }
        onStart?.({ kind: 'ws' })
      })
    },
    async cancel(sessionId, runId) {
      if (runId) return sendAbort(runId)
      // No run id yet: remember the Stop and abort the turn's run when it is named.
      clearPendingCancel(sessionId)
      const sent = lastTurn.get(sessionId)
      pendingCancel.set(sessionId, {
        timer: setTimeout(() => clearPendingCancel(sessionId), cancelTtl),
        clientTurnId: sent?.clientTurnId,
        runsBefore: sent?.runsBefore ?? new Set(sessionRuns.get(sessionId) ?? []),
      })
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      syncSubscriptions()
      ensureConnecting()
    },
    async respondAsk(sessionId, runId, response) {
      try {
        await connect(5_000)
      } catch {
        throw new AskUnavailableError()
      }
      const ack = waitAck('ask', sessionId, 'reject')
      if (!rawSend({ type: 'ask_response', response, session_id: sessionId, run_id: runId })) {
        resolveAck('ask', sessionId) // drop the waiter
        throw new AskUnavailableError()
      }
      await ack
    },
    canAnswerAsk: () => true,
    canRegenerate: () => true,
    async runStatus(runId) {
      if (!sock || sock.readyState !== OPEN || status !== 'open') return undefined
      return new Promise<boolean | undefined>((resolve) => {
        const timer = setTimeout(() => waiter.done(undefined), ackTimeout)
        const waiter: StatusWaiter = {
          runId,
          done: (active) => {
            clearTimeout(timer)
            const i = statusWaiters.indexOf(waiter)
            if (i >= 0) statusWaiters.splice(i, 1)
            resolve(active)
            scheduleIdleCheck()
          },
        }
        statusWaiters.push(waiter)
        if (!rawSend({ type: 'run_status', run_id: runId })) waiter.done(undefined)
      })
    },
    onStatus(fn) {
      statusFns.add(fn)
      return () => {
        statusFns.delete(fn)
      }
    },
    onReconnect(fn) {
      reconnectFns.add(fn)
      return () => {
        reconnectFns.delete(fn)
      }
    },
    watch(sessionId, fn) {
      let set = watchers.get(sessionId)
      if (!set) watchers.set(sessionId, (set = new Set()))
      set.add(fn)
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      syncSubscriptions()
      return () => {
        const cur = watchers.get(sessionId)
        if (!cur) return
        cur.delete(fn)
        if (!cur.size) watchers.delete(sessionId)
        scheduleIdleCheck()
      }
    },
    retain() {
      retainCount += 1
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = undefined
      ensureConnecting()
      let released = false
      return () => {
        if (released) return
        released = true
        retainCount -= 1
        scheduleIdleCheck()
      }
    },
  }
  return transport
}

export interface AutoTransportOptions {
  wsUrl?: string | (() => string | Promise<string>)
  base?: string
  /** How long a send waits for the socket before falling back to SSE. */
  openTimeoutMs?: number
  /**
   * After the socket failed to open, later sends go straight to SSE for this
   * long (30 s) instead of waiting `openTimeoutMs` on every message. The
   * socket keeps reconnecting meanwhile; once it is open, sends use it again.
   */
  fallbackBackoffMs?: number
  now?: () => number
  ws?: WsTransport
  sse?: AiuiTransport
}

/**
 * Prefers the WebSocket and falls back to SSE for a turn when the socket
 * cannot open within `openTimeoutMs` (3 s). Cancel and ask answers follow the
 * transport that carried the session's last turn.
 */
export function createAutoTransport(options: AutoTransportOptions = {}): AiuiTransport & { readonly ws: WsTransport } {
  const ws = options.ws ?? createWsTransport({ url: options.wsUrl })
  const sse = options.sse ?? createSseTransport(options.base)
  const openTimeout = options.openTimeoutMs ?? 3_000
  const backoff = options.fallbackBackoffMs ?? 30_000
  const now = options.now ?? Date.now
  const routes = new Map<string, 'ws' | 'sse'>()
  let mode: 'ws' | 'sse' = 'ws'
  let sseUntil = 0

  const pick = async (): Promise<'ws' | 'sse'> => {
    if (ws.status === 'open') return 'ws'
    // A proxy that drops the upgrade silently would add the open timeout to every message.
    if (now() < sseUntil) return 'sse'
    try {
      await ws.connect(openTimeout)
      return 'ws'
    } catch {
      sseUntil = now() + backoff
      return 'sse'
    }
  }

  return {
    ws,
    httpFallback: true,
    get kind() {
      return mode
    },
    get status() {
      return ws.status
    },
    async send(args) {
      const via = await pick()
      if (args.signal.aborted) return
      mode = via
      routes.set(args.sessionId, via)
      return (via === 'ws' ? ws : sse).send(args)
    },
    cancel(sessionId, runId) {
      return (routes.get(sessionId) === 'sse' ? sse : ws).cancel(sessionId, runId)
    },
    async respondAsk(sessionId, runId, response) {
      if (routes.get(sessionId) === 'sse') throw new AskUnavailableError()
      return ws.respondAsk(sessionId, runId, response)
    },
    canAnswerAsk: (sessionId) => routes.get(sessionId) !== 'sse',
    canRegenerate: (sessionId) => routes.get(sessionId) !== 'sse' && ws.status === 'open',
    runStatus: (runId) => ws.runStatus!(runId),
    onStatus: (fn) => ws.onStatus!(fn),
    onReconnect: (fn) => ws.onReconnect!(fn),
    watch: (sessionId, fn) => ws.watch!(sessionId, fn),
    retain: () => ws.retain!(),
  }
}
