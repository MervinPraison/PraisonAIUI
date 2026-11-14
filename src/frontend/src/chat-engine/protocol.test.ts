// npm test -- chat-engine/protocol  (scripts/run-tests.mjs bundles, then node --test)
// Fixtures are REAL frames captured from the mock provider (SSE /run and WS /api/chat/ws).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEvent, fromHistory, newAssistant, reconcileFromHistory, type AiuiMessage, type WireEvent } from './protocol'
import { convertMessage } from './convert'

const run = (events: WireEvent[]) => events.reduce<AiuiMessage>((m, ev) => applyEvent(m, ev).message, newAssistant())

const SSE: WireEvent[] = [
  { type: 'session', session_id: 'spike-1' },
  { type: 'run_started', agent_name: 'Mock' },
  { type: 'reasoning_started' },
  { type: 'reasoning_step', step: 'Parse the request' },
  { type: 'reasoning_step', step: 'Decide to call a tool' },
  { type: 'reasoning_completed' },
  { type: 'tool_call_started', name: 'web_search', args: { query: 'hello ask approve' }, tool_call_id: 'tc_1', icon: '🔍', description: '🔍 Searching the web for "hello ask approve"', step_number: 1 },
  { type: 'tool_call_completed', name: 'web_search', args: { query: 'hello ask approve' }, result: { hits: 2 }, tool_call_id: 'tc_1', extra_data: { elements: [{ type: 'image', url: '/icon.svg', name: 'chart' }] }, elements: [{ type: 'image', url: '/icon.svg', name: 'chart' }], formatted_result: '✓ Done' },
  { type: 'references', query: 'hello ask approve', references: [{ name: 'doc.md', content: 'lorem', chunk: 0, chunk_size: 5 }] },
  { type: 'run_content', token: 'You ', agent_name: 'Mock' },
  { type: 'run_content', token: 'said: ', agent_name: 'Mock' },
  { type: 'run_content', token: '**', agent_name: 'Mock' },
  { type: 'run_content', token: 'hello ask approve', agent_name: 'Mock' },
  { type: 'run_content', token: '**\n\n', agent_name: 'Mock' },
  { type: 'run_content', token: '```py\nprint(1)\n```', agent_name: 'Mock' },
  { type: 'run_paused', extra_data: { question: 'Pick one', options: ['A', 'B'] } },
  { type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap_1', tool_name: 'shell', arguments: { cmd: 'ls' }, risk_level: 'high' } },
  { type: 'run_completed', content: 'You said: **hello ask approve**\n\n```py\nprint(1)\n```' },
  { type: 'end' },
]

test('SSE /run stream -> ordered parts', () => {
  const m = run(SSE)
  assert.deepEqual(m.parts.map((p) => (p.type === 'data' ? `data-${p.name}` : p.type)), [
    'reasoning', 'tool-call', 'data-element', 'data-references', 'text', 'tool-call', 'tool-call',
  ])
  const r = m.parts[0]
  assert.ok(r.type === 'reasoning' && r.done && r.text === '- Parse the request\n- Decide to call a tool')
  const tool = m.parts[1]
  assert.ok(tool.type === 'tool-call' && tool.id === 'tc_1' && tool.artifact.icon === '🔍')
  assert.deepEqual(tool.type === 'tool-call' && tool.result, { hits: 2 })
  const text = m.parts[4]
  assert.ok(text.type === 'text' && text.text.startsWith('You said: **hello'))
  const ask = m.parts[5]
  assert.ok(ask.type === 'tool-call' && ask.toolName === 'aiui_ask' && ask.approval?.display === 'select')
  assert.deepEqual(ask.type === 'tool-call' && ask.approval?.options?.map((o) => o.label), ['A', 'B'])
  const gate = m.parts[6]
  assert.ok(gate.type === 'tool-call' && gate.toolName === 'shell' && gate.approval?.id === 'ap_1')
  // open gates keep the message in requires-action even after run_completed
  assert.equal(m.status?.type, 'requires-action')
  assert.equal(m.agentName, 'Mock')
})

test('WS stream: duplicate run_started, run_id, element dedupe, top-level ask', () => {
  const W = (e: WireEvent) => ({ session_id: 'spike-ws', run_id: 'R1', ...e })
  const m = run([
    W({ type: 'run_started' }),
    W({ type: 'run_started', agent_name: 'Mock' }),
    W({ type: 'tool_call_started', name: 'web_search', tool_call_id: 'tc_1', args: { q: 1 } }),
    W({ type: 'message_element', element: { type: 'image', url: '/icon.svg', name: 'chart' } }),
    W({ type: 'tool_call_completed', name: 'web_search', tool_call_id: 'tc_1', result: { hits: 2 }, elements: [{ type: 'image', url: '/icon.svg', name: 'chart' }] }),
    W({ type: 'references' }),
    W({ type: 'run_content', token: 'hi' }),
    W({ type: 'run_paused', question: 'Pick one', options: ['A', 'B'] }),
    W({ type: 'run_completed', content: 'hi' }),
  ])
  assert.equal(m.runId, 'R1')
  assert.equal(m.parts.filter((p) => p.type === 'data' && p.name === 'element').length, 1)
  const ask = m.parts.find((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask')
  assert.ok(ask && ask.type === 'tool-call' && ask.artifact.run_id === 'R1')
})

test('hook-style tool events without ids merge by name; approval precedes tool start', () => {
  const m = run([
    { type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap_9', tool_name: 'shell', arguments: { cmd: 'rm' } } },
    { type: 'tool_call_started', name: 'shell', args: { cmd: 'rm' } },
    { type: 'tool_call_completed', name: 'shell', result: 'ok' },
    { type: 'run_completed', content: 'done' },
  ])
  const tools = m.parts.filter((p) => p.type === 'tool-call')
  assert.equal(tools.length, 1)
  assert.ok(tools[0].type === 'tool-call' && tools[0].result === 'ok' && tools[0].approval?.approved === true)
  assert.equal(m.status?.type, 'complete')
})

test('final content replaces divergent tokens; interleaved text/tool/text preserved', () => {
  const a = run([{ type: 'run_content', token: 'draft' }, { type: 'run_completed', content: 'Final' }])
  assert.deepEqual(a.parts.map((p) => p.type === 'text' && p.text), ['Final'])
  const b = run([
    { type: 'run_content', token: 'Let me check. ' },
    { type: 'tool_call_started', name: 't', tool_call_id: 'x' },
    { type: 'tool_call_completed', name: 't', tool_call_id: 'x', result: 1 },
    { type: 'run_content', token: 'Done.' },
    { type: 'run_completed', content: 'Let me check. Done.' },
  ])
  assert.deepEqual(b.parts.map((p) => p.type), ['text', 'tool-call', 'text'])
})

test('error / cancel statuses', () => {
  assert.deepEqual(run([{ type: 'run_error', error: 'boom' }]).status, { type: 'incomplete', reason: 'error', error: 'boom' })
  assert.equal(run([{ type: 'run_cancelled' }]).status?.type, 'incomplete')
})

test('history rehydration keeps tool calls + elements before text', () => {
  const m = fromHistory({ role: 'assistant', content: 'ok', toolCalls: [{ name: 'web_search', tool_call_id: 'tc_1', result: 1, icon: '🔍' }], elements: [{ type: 'image', url: '/a.png' }] }, 0)
  assert.deepEqual(m.parts.map((p) => p.type), ['tool-call', 'data', 'text'])
})

// ── WP3 protocol additions (used when present, harmless when absent) ─────

test('WP3 approval frame: top-level fields + extra_data with tool_call_id attach the gate to its tool card', () => {
  const m = run([
    { type: 'run_started', session_id: 'S', run_id: 'R1', agent_name: 'Ops' },
    { type: 'tool_call_started', session_id: 'S', run_id: 'R1', name: 'shell', tool_call_id: 'tc_7', args: { cmd: 'ls' } },
    {
      type: 'run_paused', session_id: 'S', run_id: 'R1', pause_type: 'approval_required',
      question: 'The agent needs your input', options: [],
      id: 'ap_7', approval_id: 'ap_7', tool_name: 'shell', arguments: { cmd: 'ls' }, risk_level: 'high', tool_call_id: 'tc_7',
      extra_data: { type: 'approval_required', id: 'ap_7', tool_name: 'shell', arguments: { cmd: 'ls' }, risk_level: 'high', tool_call_id: 'tc_7' },
    },
  ])
  const tools = m.parts.filter((p) => p.type === 'tool-call')
  assert.equal(tools.length, 1)
  const t = tools[0]
  assert.ok(t.type === 'tool-call' && t.id === 'tc_7' && t.approval?.id === 'ap_7' && t.approval.display === 'decision')
  assert.equal(t.type === 'tool-call' && t.artifact.risk_level, 'high')
  assert.equal(m.agentName, 'Ops', 'agent_name on the single run_started')
  assert.deepEqual(m.status, { type: 'requires-action', reason: 'tool-calls' })
})

test('pre-WP3 approval frame (no extra_data, default question) becomes a pending-approval placeholder, not an ask', () => {
  const m = run([
    { type: 'tool_call_started', name: 'shell', tool_call_id: 'tc_1' },
    { type: 'run_paused', session_id: 'S', run_id: 'R1', question: 'The agent needs your input', options: [] },
  ])
  assert.ok(m.parts.some((p) => p.type === 'data' && p.name === 'approval-pending'))
  assert.ok(!m.parts.some((p) => p.type === 'tool-call' && p.toolName === 'aiui_ask'))
  // decided elsewhere: the run moves on and the placeholder goes away
  const after = ([
    { type: 'tool_call_completed', name: 'shell', tool_call_id: 'tc_1', result: 'ok' },
    { type: 'run_completed', content: 'done' },
  ] as WireEvent[]).reduce((acc, ev) => applyEvent(acc, ev).message, m)
  assert.ok(!after.parts.some((p) => p.type === 'data' && p.name === 'approval-pending'))
  assert.equal(after.status?.type, 'complete')
})

test('approval without tool_call_id attaches to the newest unfinished call of that tool (pre-WP3 correlation by name)', () => {
  const m = run([
    { type: 'tool_call_started', name: 'shell', tool_call_id: 'tc_old', args: { cmd: 'pwd' } },
    { type: 'tool_call_completed', name: 'shell', tool_call_id: 'tc_old', result: '/' },
    { type: 'tool_call_started', name: 'shell', tool_call_id: 'tc_2', args: { cmd: 'ls' } },
    { type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap_1', tool_name: 'shell', arguments: { cmd: 'ls' } } },
  ])
  const tools = m.parts.filter((p) => p.type === 'tool-call')
  assert.equal(tools.length, 2)
  assert.ok(tools[1].type === 'tool-call' && tools[1].id === 'tc_2' && tools[1].approval?.id === 'ap_1')
  assert.ok(tools[0].type === 'tool-call' && !tools[0].approval)
})

test('WP3 WS ask frame (pause_type ask + extra_data) is an ask with options', () => {
  const m = run([
    { type: 'run_paused', session_id: 'S', run_id: 'R1', pause_type: 'ask', question: 'Pick one', options: ['A', 'B'], extra_data: { question: 'Pick one', options: ['A', 'B'] } },
  ])
  const ask = m.parts[0]
  assert.ok(ask.type === 'tool-call' && ask.toolName === 'aiui_ask' && ask.approval?.display === 'select')
  assert.equal(ask.type === 'tool-call' && ask.artifact.run_id, 'R1')
})

test('references: WP3 payload renders, an empty pre-WP3 frame is skipped', () => {
  const withRefs = run([{ type: 'references', query: 'q', references: [{ name: 'a.md' }] }])
  assert.equal(withRefs.parts.length, 1)
  assert.equal(run([{ type: 'references' }]).parts.length, 0)
})

test('history: status cancelled (WP3) restores a stopped reply; missing status means complete', () => {
  assert.deepEqual(fromHistory({ role: 'assistant', content: 'part', status: 'cancelled' }, 0).status, { type: 'incomplete', reason: 'cancelled' })
  assert.deepEqual(fromHistory({ role: 'assistant', content: 'all' }, 1).status, { type: 'complete' })
})

test('reconcileFromHistory: completes tools that finished offline and takes the persisted text', () => {
  const live = run([
    { type: 'tool_call_started', name: 'search', tool_call_id: 'tc_1', args: { q: 1 } },
    { type: 'run_content', token: 'Partial' },
  ])
  const m = reconcileFromHistory(live, {
    role: 'assistant', content: 'Partial answer, complete',
    toolCalls: [{ name: 'search', tool_call_id: 'tc_1', result: { hits: 3 } }],
    elements: [{ type: 'image', url: '/x.png' }],
  })
  const tc = m.parts.find((p) => p.type === 'tool-call')
  assert.deepEqual(tc && tc.type === 'tool-call' && tc.result, { hits: 3 })
  assert.equal(m.parts.filter((p) => p.type === 'tool-call').length, 1)
  assert.ok(m.parts.some((p) => p.type === 'data' && p.name === 'element'))
  assert.equal(m.parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : '')).join(''), 'Partial answer, complete')
  assert.equal(m.status?.type, 'complete')
  const stopped = reconcileFromHistory(live, { role: 'assistant', content: 'Partial', status: 'cancelled' })
  assert.deepEqual(stopped.status, { type: 'incomplete', reason: 'cancelled' })
})

test('convertMessage: elements become data-element (never `image`), statuses and running reasoning map for assistant-ui', () => {
  const m = run([
    { type: 'reasoning_started' },
    { type: 'message_element', element: { type: 'image', url: 'http://evil.test/x.png' } },
    { type: 'references', query: 'q', references: [{ name: 'a' }] },
  ])
  const like = convertMessage(m)
  const types = (like.content as readonly { type: string }[]).map((c) => c.type)
  assert.deepEqual(types, ['reasoning', 'data-element', 'data-references'])
  assert.ok(!types.includes('image'))
  // an empty, running reasoning part keeps a placeholder so core does not drop it
  assert.equal((like.content as readonly { text?: string }[])[0].text, '​')
  assert.deepEqual(like.status, { type: 'running' })
  assert.deepEqual(convertMessage(run([{ type: 'run_completed', content: 'x' }])).status, { type: 'complete', reason: 'stop' })
  assert.deepEqual(convertMessage(run([{ type: 'run_cancelled' }])).status, { type: 'incomplete', reason: 'cancelled', error: undefined })
  const user = convertMessage({
    id: 'u1', role: 'user', createdAt: 0, parts: [{ type: 'text', id: 't', text: 'hi' }],
    attachments: [{ id: 'a1', name: 'doc.pdf', contentType: 'application/pdf' }],
  })
  assert.equal(user.attachments?.[0].type, 'document')
  assert.equal(user.status, undefined)
})
