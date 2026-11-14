// npm test -- chat-engine/transports
// WS transport against a fake WebSocket: reconnect/backoff, resubscription,
// keepalive, chat_abort by run id (also before run_started), ask answers,
// session demultiplexing, and the auto transport's SSE fallback.
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AskUnavailableError,
  canRegenerate,
  createAutoTransport,
  createSseTransport,
  createWsTransport,
  defaultWsUrl,
  isDisconnectError,
  SSE_DROPPED,
  wsAuthQuery,
  type AiuiTransport,
  type WsTransportOptions,
} from './transports'
import type { WireEvent } from './protocol'

// ── fake socket ─────────────────────────────────────────────────────────

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static autoOpen = true
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    if (FakeWebSocket.autoOpen) queueMicrotask(() => this.open())
  }
  open() {
    if (this.closed) return
    this.readyState = 1
    this.onopen?.({})
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('not open')
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  /** Server -> client frame. */
  emit(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  /** The server (or the network) drops the socket. */
  drop() {
    this.readyState = 3
    this.closed = true
    this.onclose?.({})
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.onclose?.({})
  }
  ofType(type: string) {
    return this.sent.filter((f) => f.type === type)
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function makeWs(opts: WsTransportOptions = {}) {
  return createWsTransport({
    url: 'ws://test/api/chat/ws',
    WebSocketImpl: FakeWebSocket as unknown as WsTransportOptions['WebSocketImpl'],
    random: () => 1, // full step: deterministic backoff
    idleCloseMs: 50,
    ...opts,
  })
}

beforeEach(() => {
  FakeWebSocket.instances = []
  FakeWebSocket.autoOpen = true
})

afterEach(() => {
  mock.timers.reset()
})

/** Start a turn and return its controls. */
function startTurn(t: AiuiTransport, sessionId: string) {
  const events: WireEvent[] = []
  const ac = new AbortController()
  let error: unknown
  let done = false
  const p = t
    .send({ sessionId, text: 'hi', signal: ac.signal, onEvent: (ev) => events.push(ev) })
    .then(() => {
      done = true
    })
    .catch((e) => {
      error = e
      done = true
    })
  return { events, ac, p, get error() { return error }, get done() { return done } }
}

// ── tests ───────────────────────────────────────────────────────────────

test('send: subscribes, sends chat, routes events by session, settles on a terminal event', async () => {
  const t = makeWs()
  const turn = startTurn(t, 'S1')
  await flush()
  const ws = last()
  assert.equal(t.status, 'open')
  assert.deepEqual(ws.ofType('subscribe')[0], { type: 'subscribe', session_ids: ['S1'] })
  const chat = ws.ofType('chat')[0]
  assert.equal(chat.session_id, 'S1')
  assert.equal(chat.content, 'hi')
  // The subscribe goes out before the chat message.
  assert.ok(ws.sent.findIndex((f) => f.type === 'subscribe') < ws.sent.findIndex((f) => f.type === 'chat'))

  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'R1' })
  ws.emit({ type: 'run_content', session_id: 'OTHER', run_id: 'R9', token: 'not mine' }) // older servers broadcast all
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'R1', token: 'hello' })
  ws.emit({ type: 'run_completed', session_id: 'S1', run_id: 'R1', content: 'hello' })
  await turn.p
  assert.deepEqual(turn.events.map((e) => e.type), ['run_started', 'run_content', 'run_completed'])
  assert.equal(turn.error, undefined)
  t.close()
})

test('a dropped socket rejects the in-flight send with a disconnect error and reconnects with backoff', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ minBackoffMs: 500, maxBackoffMs: 2_000 })
  const release = t.retain!()
  const statuses: string[] = []
  t.onStatus!((s) => statuses.push(s))
  const reopened: number[] = []
  t.onReconnect!(() => reopened.push(FakeWebSocket.instances.length))
  await flush()
  const turn = startTurn(t, 'S1')
  await flush()
  assert.equal(FakeWebSocket.instances.length, 1)

  FakeWebSocket.autoOpen = false
  last().drop()
  await flush()
  assert.ok(turn.done && isDisconnectError(turn.error), 'send() rejects with TransportDisconnectedError')
  assert.equal(t.status, 'closed')

  // attempt 1 after 500 ms (random()=1 -> full step), then 1000, then 2000 (cap), then 2000 again
  const delays = [500, 1000, 2000, 2000]
  for (const [i, d] of delays.entries()) {
    mock.timers.tick(d - 1)
    assert.equal(FakeWebSocket.instances.length, 1 + i, `no reconnect before ${d} ms`)
    mock.timers.tick(1)
    assert.equal(FakeWebSocket.instances.length, 2 + i, `reconnect attempt ${i + 1} at ${d} ms`)
    assert.equal(t.status, 'connecting')
    last().drop() // the server is still down
  }
  // The server is back.
  mock.timers.tick(2000)
  last().open()
  assert.equal(t.status, 'open')
  assert.deepEqual(reopened, [FakeWebSocket.instances.length])
  // a successful open resets the backoff
  FakeWebSocket.autoOpen = false
  last().drop()
  const n = FakeWebSocket.instances.length
  mock.timers.tick(500)
  assert.equal(FakeWebSocket.instances.length, n + 1)
  assert.ok(statuses.includes('closed') && statuses.includes('connecting') && statuses.includes('open'))
  release()
  t.close()
})

test('jitter keeps each delay between half and the full step', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ minBackoffMs: 1000, maxBackoffMs: 10_000, random: () => 0 })
  const release = t.retain!()
  await flush()
  FakeWebSocket.autoOpen = false
  last().drop()
  mock.timers.tick(499)
  assert.equal(FakeWebSocket.instances.length, 1)
  mock.timers.tick(1) // random()=0 -> half of the 1000 ms step
  assert.equal(FakeWebSocket.instances.length, 2)
  release()
  t.close()
})

test('watched sessions are resubscribed after a reconnect', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ minBackoffMs: 100 })
  const got: WireEvent[] = []
  const unwatch = t.watch!('S1', (ev) => got.push(ev))
  t.retain!()
  await flush()
  assert.deepEqual(last().ofType('subscribe').at(-1), { type: 'subscribe', session_ids: ['S1'] })
  last().drop()
  mock.timers.tick(100)
  await flush()
  const ws2 = last()
  assert.equal(FakeWebSocket.instances.length, 2)
  assert.deepEqual(ws2.ofType('subscribe').at(-1), { type: 'subscribe', session_ids: ['S1'] })
  ws2.emit({ type: 'run_content', session_id: 'S1', run_id: 'R1', token: 'x' })
  ws2.emit({ type: 'run_content', session_id: 'S2', run_id: 'R2', token: 'y' })
  assert.deepEqual(got.map((e) => e.token), ['x'])
  unwatch()
  t.close()
})

test('cancel(sid, runId) sends chat_abort with the run id and resolves on chat_abort_result', async () => {
  const t = makeWs()
  const turn = startTurn(t, 'S1')
  await flush()
  const ws = last()
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'R1' })
  turn.ac.abort() // the store aborts locally first
  await turn.p
  let resolved = false
  const c = t.cancel('S1', 'R1').then(() => {
    resolved = true
  })
  await flush()
  assert.deepEqual(ws.ofType('chat_abort'), [{ type: 'chat_abort', run_id: 'R1' }])
  assert.equal(resolved, false)
  ws.emit({ type: 'chat_abort_result', status: 'aborted', run_id: 'R1' })
  await flush()
  assert.equal(resolved, true, 'the reply settles the wait (not the ack timeout)')
  await c
  // Late frames of the aborted run are ignored.
  const got: WireEvent[] = []
  t.watch!('S1', (ev) => got.push(ev))
  ws.emit({ type: 'run_cancelled', session_id: 'S1', run_id: 'R1' })
  assert.equal(got.length, 0)
  t.close()
})

test('older servers answer chat_abort without a type; that also resolves', async () => {
  const t = makeWs()
  const turn = startTurn(t, 'S1')
  await flush()
  const ws = last()
  turn.ac.abort()
  let resolved = false
  const c = t.cancel('S1', 'R7').then(() => {
    resolved = true
  })
  await flush()
  ws.emit({ status: 'no_active_run', run_id: 'R7' })
  await flush()
  assert.equal(resolved, true)
  await c
  t.close()
})

test('Stop before run_started: chat_abort goes out as soon as the run id is known', async () => {
  const t = makeWs()
  const turn = startTurn(t, 'S1')
  await flush()
  const ws = last()
  turn.ac.abort()
  await turn.p
  await t.cancel('S1') // no run id yet
  assert.equal(ws.ofType('chat_abort').length, 0)
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'R2' })
  await flush()
  assert.deepEqual(ws.ofType('chat_abort'), [{ type: 'chat_abort', run_id: 'R2' }])
  ws.emit({ type: 'chat_abort_result', status: 'aborted', run_id: 'R2' })
  t.close()
})

test('a chat_abort that could not be sent is delivered after the reconnect', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ minBackoffMs: 100 })
  t.retain!()
  await flush()
  FakeWebSocket.autoOpen = false
  last().drop()
  void t.cancel('S1', 'R3')
  mock.timers.tick(100)
  last().open()
  assert.deepEqual(last().ofType('chat_abort'), [{ type: 'chat_abort', run_id: 'R3' }])
  t.close()
})

test('ask_response is sent with session and run id and resolves on ask_response_ack', async () => {
  const t = makeWs()
  t.retain!()
  await flush()
  const ws = last()
  const p = t.respondAsk('S1', 'R1', 'A')
  await flush()
  assert.deepEqual(ws.ofType('ask_response'), [{ type: 'ask_response', response: 'A', session_id: 'S1', run_id: 'R1' }])
  let acked = false
  void p.then(() => {
    acked = true
  })
  await flush()
  assert.equal(acked, false)
  ws.emit({ type: 'ask_response_ack', session_id: 'S1', status: 'received' })
  await flush()
  assert.equal(acked, true)
  await p
  t.close()
})

test('a half-open socket (no reply to ping) is closed and reconnected', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ pingIntervalMs: 1000, pongTimeoutMs: 500, minBackoffMs: 100 })
  t.retain!()
  await flush()
  const ws = last()
  mock.timers.tick(1000)
  assert.equal(ws.ofType('ping').length, 1)
  ws.emit({ type: 'pong' }) // alive
  mock.timers.tick(1000)
  assert.equal(ws.ofType('ping').length, 2)
  mock.timers.tick(500) // no pong this time
  assert.equal(t.status, 'closed')
  assert.ok(ws.closed)
  mock.timers.tick(100)
  await flush()
  assert.equal(FakeWebSocket.instances.length, 2)
  assert.equal(t.status, 'open')
  t.close()
})

test('the socket closes when nothing needs it (after the idle grace period)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ idleCloseMs: 250 })
  const release = t.retain!()
  await flush()
  const ws = last()
  release()
  mock.timers.tick(249)
  assert.equal(ws.closed, false)
  mock.timers.tick(1)
  assert.equal(ws.closed, true)
  assert.equal(t.status, 'closed')
  t.close()
})

async function withBrowserGlobals(fetchImpl: typeof fetch, fn: () => Promise<void>) {
  const g = globalThis as { sessionStorage?: unknown; location?: unknown; fetch?: unknown }
  const prev = { s: g.sessionStorage, l: g.location, f: g.fetch }
  g.sessionStorage = { getItem: (k: string) => (k === 'aiui_gateway_token' ? 'tok en' : null) }
  g.location = { protocol: 'https:', host: 'example.test' }
  g.fetch = fetchImpl
  try {
    await fn()
  } finally {
    g.sessionStorage = prev.s
    g.location = prev.l
    g.fetch = prev.f
  }
}

test('the stored gateway token is traded for a single-use ticket; the key never goes in the URL', async () => {
  const calls: { url: string; auth: string | null }[] = []
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
    return new Response(JSON.stringify({ ticket: 'tk-1', expires_in: 60 }), { status: 200 })
  }) as unknown as typeof fetch
  await withBrowserGlobals(fakeFetch, async () => {
    const t = createWsTransport({ WebSocketImpl: FakeWebSocket as unknown as WsTransportOptions['WebSocketImpl'] })
    const r = t.retain!()
    await flush()
    await flush()
    assert.equal(last().url, 'wss://example.test/api/chat/ws?ticket=tk-1')
    assert.ok(!last().url.includes('tok'))
    assert.deepEqual(calls, [{ url: '/api/auth/ws-ticket', auth: 'Bearer tok en' }])
    r()
    t.close()
  })
})

test('servers without the ticket endpoint still get ?token=; a refused token sends nothing', async () => {
  await withBrowserGlobals((async () => new Response('', { status: 404 })) as unknown as typeof fetch, async () => {
    assert.equal(await wsAuthQuery(), '?token=tok%20en')
    assert.equal(await defaultWsUrl(), 'wss://example.test/api/chat/ws?token=tok%20en')
  })
  await withBrowserGlobals((async () => new Response('', { status: 401 })) as unknown as typeof fetch, async () => {
    assert.equal(await wsAuthQuery(), '')
  })
})

test('auto transport: falls back to SSE when the socket cannot open in time; ask answers then need a live channel', async () => {
  FakeWebSocket.autoOpen = false
  const ws = makeWs()
  const sseCalls: string[] = []
  const sse: AiuiTransport = {
    kind: 'sse',
    async send({ sessionId, onEvent }) {
      sseCalls.push(`send:${sessionId}`)
      onEvent({ type: 'run_completed', content: 'via sse' })
    },
    async cancel(sid) {
      sseCalls.push(`cancel:${sid}`)
    },
    async respondAsk() {
      throw new AskUnavailableError()
    },
    canAnswerAsk: () => false,
  }
  const auto = createAutoTransport({ ws, sse, openTimeoutMs: 30 })
  const events: WireEvent[] = []
  await auto.send({ sessionId: 'S1', text: 'x', signal: new AbortController().signal, onEvent: (e) => events.push(e) })
  assert.equal(auto.kind, 'sse')
  assert.deepEqual(sseCalls, ['send:S1'])
  assert.equal(events[0].content, 'via sse')
  assert.equal(auto.canAnswerAsk!('S1'), false)
  // Regenerate is a plain resend over SSE (a duplicate turn): not offered.
  assert.equal(canRegenerate(auto, 'S1'), false)
  assert.equal(canRegenerate(sse, 'S1'), false, 'a transport without canRegenerate cannot regenerate')
  await assert.rejects(auto.respondAsk('S1', undefined, 'A'), AskUnavailableError)
  await auto.cancel('S1', undefined)
  assert.deepEqual(sseCalls, ['send:S1', 'cancel:S1'])

  // The socket comes up: the next turn goes over WS.
  FakeWebSocket.autoOpen = true
  last().open()
  const turn = startTurn(auto, 'S2')
  await flush()
  assert.equal(auto.kind, 'ws')
  last().emit({ type: 'run_completed', session_id: 'S2', run_id: 'R1', content: 'via ws' })
  await turn.p
  assert.equal(turn.events[0].content, 'via ws')
  assert.equal(auto.canAnswerAsk!('S2'), true)
  assert.equal(canRegenerate(auto, 'S2'), true)
  assert.equal(canRegenerate(auto, 'S1'), false, 'S1 was carried by SSE')
  ws.close()
})

// ── two tabs on one session (review r1) ───────────────────────────────

function startNamedTurn(t: AiuiTransport, sessionId: string, clientTurnId: string) {
  const events: WireEvent[] = []
  const ac = new AbortController()
  const p = t.send({ sessionId, text: 'hi', signal: ac.signal, clientTurnId, onEvent: (ev) => events.push(ev) }).catch(() => undefined)
  return { events, ac, p }
}

test('chat frames carry client_turn_id; another tab\'s run never binds the turn (server echoes the id)', async () => {
  const t = makeWs()
  const watched: WireEvent[] = []
  t.watch!('S1', (ev) => watched.push(ev))
  const turn = startNamedTurn(t, 'S1', 'mine')
  await flush()
  const ws = last()
  assert.equal(ws.ofType('chat')[0].client_turn_id, 'mine')
  // Tab A's run (already streaming) arrives first, then ours.
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RA', token: 'd0 ', client_turn_id: 'theirs' })
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'RB', client_turn_id: 'mine' })
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RA', token: 'd1 ', client_turn_id: 'theirs' })
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RB', token: 'You said', client_turn_id: 'mine' })
  assert.deepEqual(turn.events.map((e) => e.run_id), ['RB', 'RB'])
  assert.deepEqual(watched.map((e) => e.run_id), ['RA', 'RA'])
  // Stop names our run, not tab A's.
  turn.ac.abort()
  await turn.p
  void t.cancel('S1', 'RB')
  assert.deepEqual(ws.ofType('chat_abort'), [{ type: 'chat_abort', run_id: 'RB' }])
  t.close()
})

test('a server that echoes the id once: a later run without the echo is not ours', async () => {
  const t = makeWs()
  const turn = startNamedTurn(t, 'S1', 'mine')
  await flush()
  const ws = last()
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RX', token: 'x', client_turn_id: 'theirs' })
  // A legacy client's run on a correlating server: no echo, still not ours.
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RL', token: 'legacy' })
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'RM', client_turn_id: 'mine' })
  assert.deepEqual(turn.events.map((e) => e.run_id), ['RM'])
  t.close()
})

test('older servers (no echo): runs that started before the turn are not bound', async () => {
  const t = makeWs()
  const watched: WireEvent[] = []
  t.watch!('S1', (ev) => watched.push(ev))
  await t.connect()
  const ws = last()
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'RA' }) // tab A starts first
  const turn = startNamedTurn(t, 'S1', 'mine')
  await flush()
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RA', token: 'd0' })
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'RB' })
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RB', token: 'mine' })
  assert.deepEqual(turn.events.map((e) => e.run_id), ['RB', 'RB'])
  assert.deepEqual(watched.map((e) => e.run_id), ['RA', 'RA'])
  t.close()
})

test('Stop before run_started aborts our run, not another tab\'s run that streams meanwhile', async () => {
  const t = makeWs()
  const turn = startNamedTurn(t, 'S1', 'mine')
  await flush()
  const ws = last()
  turn.ac.abort()
  await turn.p
  await t.cancel('S1')
  ws.emit({ type: 'run_content', session_id: 'S1', run_id: 'RA', token: 'd5', client_turn_id: 'theirs' })
  await flush()
  assert.equal(ws.ofType('chat_abort').length, 0)
  ws.emit({ type: 'run_started', session_id: 'S1', run_id: 'RB', client_turn_id: 'mine' })
  await flush()
  assert.deepEqual(ws.ofType('chat_abort'), [{ type: 'chat_abort', run_id: 'RB' }])
  t.close()
})

test('runStatus asks the server; no answer (older server) reads as unknown', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const t = makeWs({ ackTimeoutMs: 1000 })
  t.retain!()
  await flush()
  assert.equal(t.status, 'open')
  const p = t.runStatus!('R1')
  assert.deepEqual(last().ofType('run_status'), [{ type: 'run_status', run_id: 'R1' }])
  last().emit({ type: 'run_status', run_id: 'R1', session_id: null, active: false })
  assert.equal(await p, false)
  const q = t.runStatus!('R2')
  mock.timers.tick(1000)
  assert.equal(await q, undefined)
  t.close()
})

test('SSE: a stream that drops mid-reply says so instead of the reader\'s bare "network error"', async () => {
  const g = globalThis as { fetch?: unknown }
  const prev = g.fetch
  let pulls = 0
  g.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(ctrl) {
          pulls += 1
          if (pulls === 1) ctrl.enqueue(new TextEncoder().encode('data: {"type":"run_content","token":"tok0 "}\n\n'))
          else ctrl.error(new TypeError('network error'))
        },
      }),
      { status: 200 },
    )) as unknown as typeof fetch
  try {
    const events: WireEvent[] = []
    const sse = createSseTransport()
    await assert.rejects(
      sse.send({ sessionId: 'S', text: 'x', signal: new AbortController().signal, onEvent: (e) => events.push(e) }),
      (err: Error) => err.message === SSE_DROPPED,
    )
    assert.equal(events.length, 1)
  } finally {
    g.fetch = prev
  }
})
