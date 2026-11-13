// npm test -- chat-engine/store
// The session-keyed thread store driven by a hand-controlled transport.
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { threadStore } from './store'
import { TransportDisconnectedError, type AiuiTransport, type SendArgs } from './transports'
import { APPROVAL_ERROR, APPROVAL_PENDING, type AiuiMessage, type ConnectionStatus, type WireEvent } from './protocol'

/** A transport whose turns the test drives by hand. */
function fakeTransport(kind: 'ws' | 'sse' = 'ws') {
  const turns = new Map<string, { args: SendArgs; resolve: () => void; reject: (e: Error) => void }>()
  const cancels: [string, string | undefined][] = []
  const asks: [string, string | undefined, string][] = []
  const watchers = new Map<string, (ev: WireEvent) => void>()
  const reconnectFns = new Set<() => void>()
  let status: ConnectionStatus = 'open'
  const t: AiuiTransport = {
    kind,
    get status() {
      return status
    },
    send(args) {
      return new Promise<void>((resolve, reject) => {
        turns.set(args.sessionId, { args, resolve, reject })
        args.signal.addEventListener('abort', () => resolve(), { once: true })
        args.onStart?.({ kind })
      })
    },
    async cancel(sid, runId) {
      cancels.push([sid, runId])
    },
    async respondAsk(sid, runId, text) {
      asks.push([sid, runId, text])
    },
    canAnswerAsk: () => kind === 'ws',
    onReconnect(fn) {
      reconnectFns.add(fn)
      return () => reconnectFns.delete(fn)
    },
    watch(sid, fn) {
      watchers.set(sid, fn)
      return () => watchers.delete(sid)
    },
  }
  return {
    t,
    cancels,
    asks,
    emit(sid: string, ev: WireEvent) {
      const turn = turns.get(sid)
      if (turn) turn.args.onEvent(ev)
      else watchers.get(sid)?.(ev)
    },
    end(sid: string) {
      turns.get(sid)?.resolve()
      turns.delete(sid)
    },
    drop(sid: string) {
      status = 'closed'
      turns.get(sid)?.reject(new TransportDisconnectedError())
      turns.delete(sid)
    },
    reopen() {
      status = 'open'
      for (const fn of [...reconnectFns]) fn()
    },
    watching: (sid: string) => watchers.has(sid),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const assistant = (sid: string): AiuiMessage => {
  const m = threadStore.get(sid).messages.filter((x) => x.role === 'assistant').at(-1)
  assert.ok(m, 'an assistant message exists')
  return m
}
const textOf = (m: AiuiMessage) => m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')

const realFetch = globalThis.fetch
beforeEach(() => {
  threadStore.reset()
  threadStore.configure({ historyUrl: (sid) => `http://test/api/chat/history/${sid}`, watchdogMs: 60_000 })
})
afterEach(() => {
  globalThis.fetch = realFetch
  threadStore.reset()
})

test('switching sessions keeps a background stream running', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'A', 'first')
  await tick()
  f.emit('A', { type: 'run_started', session_id: 'A', run_id: 'RA' })
  f.emit('A', { type: 'run_content', session_id: 'A', run_id: 'RA', token: 'Hel' })

  // The user opens session B and starts a turn there while A streams.
  void threadStore.send(f.t, 'B', 'second')
  await tick()
  f.emit('A', { type: 'run_content', session_id: 'A', run_id: 'RA', token: 'lo' })
  f.emit('B', { type: 'run_content', session_id: 'B', run_id: 'RB', token: 'B!' })
  assert.deepEqual([...threadStore.runningSessions()].sort(), ['A', 'B'])
  assert.equal(textOf(assistant('A')), 'Hello')
  assert.equal(textOf(assistant('B')), 'B!')

  f.emit('A', { type: 'run_completed', session_id: 'A', run_id: 'RA', content: 'Hello' })
  f.end('A')
  await tick()
  assert.equal(threadStore.get('A').isRunning, false)
  assert.equal(assistant('A').status?.type, 'complete')
  assert.equal(threadStore.get('B').isRunning, true)
  assert.deepEqual([...threadStore.runningSessions()], ['B'])
})

test('cancel marks the turn incomplete/cancelled at once and asks the transport to stop the run', async () => {
  const f = fakeTransport()
  const sent = threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_started', session_id: 'S', run_id: 'R1' })
  f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R1', token: 'partial' })
  await threadStore.cancel(f.t, 'S')
  await sent
  const m = assistant('S')
  assert.deepEqual(m.status, { type: 'incomplete', reason: 'cancelled' })
  assert.equal(threadStore.get('S').isRunning, false)
  assert.deepEqual(f.cancels, [['S', 'R1']])
  // Frames that were already in flight do not revive the turn.
  f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R1', token: ' more' })
  assert.equal(textOf(assistant('S')), 'partial')
})

test('cancel before run_started passes no run id (the WS transport aborts the run when it starts)', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  await threadStore.cancel(f.t, 'S')
  assert.deepEqual(f.cancels, [['S', undefined]])
  assert.equal(assistant('S').status?.type, 'incomplete')
})

test('duplicate run_started is idempotent and agent_name is taken from it', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_started', session_id: 'S', run_id: 'R1' })
  f.emit('S', { type: 'run_started', session_id: 'S', run_id: 'R1', agent_name: 'Researcher' })
  f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R1', token: 'ok' })
  const msgs = threadStore.get('S').messages
  assert.equal(msgs.filter((m) => m.role === 'assistant').length, 1)
  assert.equal(assistant('S').runId, 'R1')
  assert.equal(assistant('S').agentName, 'Researcher')
  assert.equal(threadStore.get('S').activeRunId, 'R1')
  // A frame from a different run of the same session is ignored.
  f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R2', token: 'stray' })
  assert.equal(textOf(assistant('S')), 'ok')
})

test('elements are deduped by url (WS sends message_element and tool_call_completed.elements)', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  const el = { type: 'image', url: '/chart.png', name: 'chart' }
  f.emit('S', { type: 'tool_call_started', name: 'plot', tool_call_id: 'tc1', args: {} })
  f.emit('S', { type: 'message_element', element: el })
  f.emit('S', { type: 'tool_call_completed', name: 'plot', tool_call_id: 'tc1', result: 'ok', elements: [el] })
  f.emit('S', { type: 'message_element', element: { ...el } })
  const els = assistant('S').parts.filter((p) => p.type === 'data' && p.name === 'element')
  assert.equal(els.length, 1)
})

test('approval: resolving the gate records the decision and returns the message to running', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'tool_call_started', name: 'shell', tool_call_id: 'tc9', args: { cmd: 'ls' } })
  f.emit('S', {
    type: 'run_paused',
    extra_data: { type: 'approval_required', id: 'ap1', tool_name: 'shell', arguments: { cmd: 'ls' }, tool_call_id: 'tc9', risk_level: 'high' },
  })
  let m = assistant('S')
  assert.deepEqual(m.status, { type: 'requires-action', reason: 'tool-calls' })
  const gated = m.parts.filter((p) => p.type === 'tool-call')
  assert.equal(gated.length, 1, 'tool_call_id attaches the gate to the existing tool card')
  assert.equal(threadStore.findApproval('S', 'ap1')?.id, 'tc9')

  threadStore.resolveApproval('S', 'ap1', true)
  m = assistant('S')
  assert.equal(m.status?.type, 'running')
  assert.equal(threadStore.findApproval('S', 'ap1')?.approval?.approved, true)

  // A rejected decision is rolled back so the controls work again.
  threadStore.revertApproval('S', 'ap1')
  assert.equal(threadStore.findApproval('S', 'ap1')?.approval?.approved, undefined)
  assert.equal(assistant('S').status?.type, 'requires-action')
  threadStore.resolveApproval('S', 'ap1', false)
  assert.equal(threadStore.findApproval('S', 'ap1')?.approval?.approved, false)

  f.emit('S', { type: 'tool_call_completed', name: 'shell', tool_call_id: 'tc9', result: 'denied', error: true })
  f.emit('S', { type: 'run_completed', content: 'Not run.' })
  f.end('S')
  await tick()
  assert.equal(assistant('S').status?.type, 'complete')
})

/** A session paused on approval gate ap1 (tool call tc9). */
async function gated() {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'please approve')
  await tick()
  f.emit('S', { type: 'tool_call_started', name: 'shell', tool_call_id: 'tc9', args: { cmd: 'ls' } })
  f.emit('S', { type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap1', tool_name: 'shell', tool_call_id: 'tc9' } })
  return f
}

/** fetch stub: answers each call with the next status (or throws for 'offline'), recording the URLs. */
function stubFetch(...answers: (number | 'offline')[]) {
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const next = answers.shift() ?? 200
    if (next === 'offline') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(next === 404 ? { error: 'Approval not found' } : { ok: true }), { status: next })
  }) as typeof fetch
  return calls
}

test('regression: a rejected approve (404) keeps the gate open and leaves the error on the part', async () => {
  const f = await gated()
  let release!: () => void
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    await new Promise<void>((r) => (release = r))
    return new Response('{"error":"Approval not found"}', { status: 404 })
  }) as typeof fetch

  const p = threadStore.respondApproval(f.t, 'S', 'ap1', { approved: true })
  // In flight: the gate is still open (it does not unmount), marked pending.
  let part = threadStore.findApproval('S', 'ap1')
  assert.equal(part?.approval?.approved, undefined)
  assert.equal(part?.artifact[APPROVAL_PENDING], 'approve')
  assert.equal(assistant('S').status?.type, 'requires-action')
  // a second click while one decision is in flight sends nothing
  await threadStore.respondApproval(f.t, 'S', 'ap1', { approved: false })
  assert.deepEqual(calls, ['/api/approvals/ap1/approve'])

  release()
  await assert.rejects(p, /This approval is no longer pending/)
  part = threadStore.findApproval('S', 'ap1')
  assert.equal(part?.approval?.approved, undefined, 'the gate is open again')
  assert.equal(part?.artifact[APPROVAL_PENDING], undefined)
  assert.equal(part?.artifact[APPROVAL_ERROR], 'This approval is no longer pending', 'a remounted gate can show it')
  assert.deepEqual(assistant('S').status, { type: 'requires-action', reason: 'tool-calls' })
})

test('approval: no network and other HTTP errors are reported on the part; a later success clears them', async () => {
  const f = await gated()
  const calls = stubFetch('offline', 500, 200)
  await assert.rejects(threadStore.respondApproval(f.t, 'S', 'ap1', { approved: true }), /Could not reach the server/)
  assert.equal(threadStore.findApproval('S', 'ap1')?.artifact[APPROVAL_ERROR], 'Could not reach the server; try again')

  await assert.rejects(threadStore.respondApproval(f.t, 'S', 'ap1', { approved: false, text: 'no' }), /HTTP 500/)
  assert.equal(threadStore.findApproval('S', 'ap1')?.artifact[APPROVAL_ERROR], 'The server answered HTTP 500')

  await threadStore.respondApproval(f.t, 'S', 'ap1', { approved: false, text: 'no' })
  const part = threadStore.findApproval('S', 'ap1')
  assert.equal(part?.approval?.approved, false)
  assert.equal(part?.artifact[APPROVAL_ERROR], undefined)
  assert.equal(part?.artifact[APPROVAL_PENDING], undefined)
  assert.equal(assistant('S').status?.type, 'running')
  assert.deepEqual(calls.map((c) => c.url), ['/api/approvals/ap1/approve', '/api/approvals/ap1/deny', '/api/approvals/ap1/deny'])
  assert.deepEqual(calls[2].body, { reason: 'no' })
})

test('approval: a gate the stream resolved while the POST was in flight is not reopened by a late failure', async () => {
  const f = await gated()
  let release!: () => void
  globalThis.fetch = (async () => {
    await new Promise<void>((r) => (release = r))
    return new Response('{}', { status: 502 })
  }) as typeof fetch
  const p = threadStore.respondApproval(f.t, 'S', 'ap1', { approved: true })
  f.emit('S', { type: 'tool_call_completed', name: 'shell', tool_call_id: 'tc9', result: 'ok' })
  release()
  await assert.rejects(p, /HTTP 502/)
  const part = threadStore.findApproval('S', 'ap1')
  assert.equal(part?.approval?.approved, true, 'the tool ran, so the gate stays passed')
  assert.equal(part?.artifact[APPROVAL_ERROR], undefined)
})

test('regression: a failed ask_response keeps the ask open with the error on the part', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_started', run_id: 'R1' })
  f.emit('S', { type: 'run_paused', session_id: 'S', run_id: 'R1', question: 'Which file?', options: ['a.txt', 'b.txt'] })
  const ask = assistant('S').parts.find((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask')
  assert.ok(ask?.type === 'tool-call' && ask.approval)
  const askId = ask.approval.id

  let fail = true
  const sent: [string, string | undefined, string][] = []
  f.t.respondAsk = async (sid, runId, text) => {
    sent.push([sid, runId, text])
    if (fail) throw new Error('The server did not confirm the answer')
  }
  await assert.rejects(threadStore.respondApproval(f.t, 'S', askId, { approved: true, optionId: 'opt_1' }), /did not confirm/)
  let part = threadStore.findApproval('S', askId)
  assert.equal(part?.approval?.approved, undefined)
  assert.equal(part?.result, undefined)
  assert.equal(part?.artifact[APPROVAL_ERROR], 'The server did not confirm the answer')

  fail = false
  await threadStore.respondApproval(f.t, 'S', askId, { approved: true, optionId: 'opt_1' })
  part = threadStore.findApproval('S', askId)
  assert.equal(part?.approval?.approved, true)
  assert.equal(part?.result, 'b.txt')
  assert.equal(part?.artifact[APPROVAL_ERROR], undefined)
  assert.deepEqual(sent, [['S', 'R1', 'b.txt'], ['S', 'R1', 'b.txt']], 'ask_response carries the run id')
})

test('an ask on a turn with no answer channel (SSE) reports that on the part instead of sending', async () => {
  const f = fakeTransport('sse')
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_paused', session_id: 'S', run_id: 'R1', question: 'Which file?', options: [] })
  const ask = assistant('S').parts.find((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask')
  assert.ok(ask?.type === 'tool-call' && ask.approval)
  await assert.rejects(threadStore.respondApproval(f.t, 'S', ask.approval.id, { approved: true, text: 'x' }), /live connection/)
  assert.equal(f.asks.length, 0)
  assert.match(String(threadStore.findApproval('S', ask.approval.id)?.artifact[APPROVAL_ERROR]), /live connection/)
})

test('older WS servers: an undescribed approval shows a placeholder that an aiui:approval-required record fills in', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  // pre-WP3 chat.py: run_paused with only the default question, no extra_data / pause_type
  f.emit('S', { type: 'run_paused', session_id: 'S', run_id: 'R1', question: 'The agent needs your input', options: [] })
  let m = assistant('S')
  assert.ok(m.parts.some((p) => p.type === 'data' && p.name === 'approval-pending'))
  assert.ok(!m.parts.some((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask'), 'not misread as an ask')

  assert.equal(threadStore.injectApproval({ id: 'ap7', tool_name: 'shell', arguments: { cmd: 'ls' }, session_id: 'OTHER' }), null)
  assert.equal(threadStore.injectApproval({ id: 'ap7', tool_name: 'shell', arguments: { cmd: 'ls' } }), 'S')
  m = assistant('S')
  assert.ok(!m.parts.some((p) => p.type === 'data' && p.name === 'approval-pending'))
  assert.equal(threadStore.findApproval('S', 'ap7')?.toolName, 'shell')
  assert.equal(m.status?.type, 'requires-action')
  // nothing left to fill: a second record is not applied
  assert.equal(threadStore.injectApproval({ id: 'ap8', tool_name: 'x' }), null)
})

test('a real ask with its own question stays an ask on every server', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_paused', session_id: 'S', run_id: 'R1', question: 'Which file?', options: [] })
  const ask = assistant('S').parts.find((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask')
  assert.ok(ask && ask.type === 'tool-call' && ask.approval?.display === 'text')
  assert.equal(assistant('S').status?.type, 'requires-action')
})

test('a dropped WS turn reconnects and is finalized from history when the reply finished offline', async () => {
  const f = fakeTransport()
  const history = {
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Full answer', toolCalls: [{ name: 'search', tool_call_id: 'tc1', result: 'r' }] },
    ],
  }
  globalThis.fetch = (async () => new Response(JSON.stringify(history), { status: 200 })) as typeof fetch
  const sent = threadStore.send(f.t, 'S', 'hi')
  await tick()
  f.emit('S', { type: 'run_started', session_id: 'S', run_id: 'R1' })
  f.emit('S', { type: 'tool_call_started', name: 'search', tool_call_id: 'tc1', args: {} })
  f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R1', token: 'Full' })
  f.drop('S')
  await sent
  assert.equal(threadStore.get('S').reconnecting, true)
  assert.equal(threadStore.get('S').isRunning, true)
  assert.equal(assistant('S').custom?.reconnecting, true)
  assert.ok(f.watching('S'), 'the session keeps listening while the socket is down')

  f.reopen()
  for (let i = 0; i < 5; i++) await tick()
  const m = assistant('S')
  assert.equal(textOf(m), 'Full answer')
  assert.equal(m.status?.type, 'complete')
  const tc = m.parts.find((p) => p.type === 'tool-call')
  assert.ok(tc && tc.type === 'tool-call' && tc.result === 'r')
  assert.equal(threadStore.get('S').isRunning, false)
  assert.equal(threadStore.get('S').reconnecting, false)
  assert.equal(f.watching('S'), false)
})

test('a dropped turn still running server-side resumes through watch(), behind a watchdog', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const f = fakeTransport()
    // history has the user turn but no reply yet
    globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }), { status: 200 })) as typeof fetch
    threadStore.configure({ watchdogMs: 60_000 })
    void threadStore.send(f.t, 'S', 'hi')
    await Promise.resolve()
    f.emit('S', { type: 'run_started', session_id: 'S', run_id: 'R1' })
    f.drop('S')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    f.reopen()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    assert.equal(threadStore.get('S').reconnecting, false)
    assert.equal(threadStore.get('S').isRunning, true)

    f.emit('S', { type: 'run_content', session_id: 'S', run_id: 'R1', token: 'resumed' })
    mock.timers.tick(59_999) // every event re-arms the watchdog
    f.emit('S', { type: 'run_completed', session_id: 'S', run_id: 'R1', content: 'resumed' })
    assert.equal(threadStore.get('S').isRunning, false)
    assert.equal(assistant('S').status?.type, 'complete')

    // Second drop: nothing ever arrives again -> the watchdog ends the turn with an error.
    void threadStore.send(f.t, 'S', 'again')
    await Promise.resolve()
    f.drop('S')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    f.reopen()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    assert.equal(threadStore.get('S').isRunning, true)
    mock.timers.tick(60_000)
    assert.equal(threadStore.get('S').isRunning, false)
    assert.equal(assistant('S').status?.type, 'incomplete')
  } finally {
    mock.timers.reset()
  }
})

test('history loads once per session and keeps a turn that started while it was loading', async () => {
  let release!: (r: Response) => void
  let calls = 0
  globalThis.fetch = (() => {
    calls += 1
    return new Promise<Response>((r) => {
      release = r
    })
  }) as typeof fetch
  const f = fakeTransport()
  const loading = threadStore.load('S')
  assert.equal(threadStore.get('S').isLoading, true)
  void threadStore.send(f.t, 'S', 'new question') // the user sends before history arrives
  release(new Response(JSON.stringify({ messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'old answer', status: 'cancelled' }] })))
  await loading
  const msgs = threadStore.get('S').messages
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.deepEqual(msgs[1].status, { type: 'incomplete', reason: 'cancelled' }, 'persisted status:cancelled is restored')
  await threadStore.load('S')
  assert.equal(calls, 1)
})

test('sending while a turn runs is ignored (queueing is deferred; the composer is disabled)', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S', 'one')
  await tick()
  void threadStore.send(f.t, 'S', 'two')
  await tick()
  assert.equal(threadStore.get('S').messages.filter((m) => m.role === 'user').length, 1)
})
