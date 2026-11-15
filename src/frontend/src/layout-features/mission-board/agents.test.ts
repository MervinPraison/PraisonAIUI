// The agents column's model (agents.ts) and what its cards and the KPI
// strip say (cards.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentStatus, ApprovalItem, ChatMessageView, RunKpis, SessionSummary } from '@/sdk/layoutTypes'
import { agentCountsLabel, agentViews, attention, chatGates, defaultAgent, sessionsOf, withChatGates } from './agents'
import { agentDoing, agentMeta, agentTimer, approvalTitle, kpiCells, requestTitle } from './cards'

const NOW = 50_000_000
const researcher: AgentStatus = { name: 'Researcher', state: 'running', elapsedMs: 7000, model: 'gpt-4o-mini', tokensToday: 3412, costToday: 0.012, lastRunAt: NOW - 7000 }
const writer: AgentStatus = { name: 'Writer', state: 'idle', lastRunAt: NOW - 38 * 60_000, model: 'claude-haiku', costToday: 0.41 }
const coder: AgentStatus = { name: 'Coder', state: 'running', model: 'gpt-4o', costToday: 0.07 }
const pip: ApprovalItem = { id: 'ap_1', agentName: 'coder', toolName: 'shell', args: { cmd: 'pip install numpy' }, createdAt: NOW - 42_000 }

test('a pending approval turns its agent to waiting and lists it first', () => {
  const views = agentViews([researcher, writer, coder], [pip])
  assert.deepEqual(
    views.map((a) => [a.name, a.state]),
    [
      ['Coder', 'waiting'],
      ['Researcher', 'running'],
      ['Writer', 'idle'],
    ],
  )
  assert.equal(views[0].approval?.id, 'ap_1')
  assert.equal(agentCountsLabel(views), '1 running · 1 waiting · 1 idle')
})

test('an agent the ledger does not know still shows while it waits (run history off)', () => {
  const views = agentViews([], [pip, { id: 'ap_0', agentName: 'Coder', createdAt: NOW - 90_000 }, { id: 'ap_x' }])
  assert.deepEqual(views.map((a) => [a.name, a.state, a.approval?.id]), [['Coder', 'waiting', 'ap_0']])
  assert.equal(agentCountsLabel([]), '')
})

test('duplicate and unnamed agents are dropped', () => {
  assert.deepEqual(agentViews([writer, { ...writer }, { name: ' ', state: 'idle' }], []).map((a) => a.name), ['Writer'])
})

test('sessions of an agent, or all of them when no session says its agent', () => {
  const sessions: SessionSummary[] = [
    { id: 's1', title: 'Compare sorting algorithms', agent: 'Researcher' },
    { id: 's2', title: 'Quick: weekly metrics', agent: 'Writer' },
  ]
  assert.deepEqual(sessionsOf(sessions, 'researcher'), { sessions: [sessions[0]], filtered: true })
  assert.deepEqual(sessionsOf(sessions, null), { sessions, filtered: false })
  const plain = sessions.map((s) => ({ id: s.id, title: s.title }))
  assert.deepEqual(sessionsOf(plain, 'Researcher'), { sessions: plain, filtered: false })
})

test('the column opens on the open chat’s agent, else the first busy one', () => {
  const views = agentViews([writer, researcher], [])
  assert.equal(defaultAgent(views, 'Writer'), 'Writer')
  assert.equal(defaultAgent(views, undefined), 'Researcher')
  assert.equal(defaultAgent(agentViews([writer], []), 'Nobody'), 'Writer')
  assert.equal(defaultAgent([], undefined), null)
})

test('card lines: the call it waits on, the chat it runs, its last run', () => {
  const [c, r, w] = agentViews([researcher, writer, coder], [pip])
  assert.deepEqual(agentDoing(c, NOW), { text: 'Wants to run', code: 'pip install numpy' })
  assert.deepEqual(agentDoing(r, NOW, 'Compare sorting algorithms'), { text: 'Compare sorting algorithms' })
  assert.deepEqual(agentDoing(w, NOW), { text: 'Last run 38m ago' })
  assert.deepEqual(agentDoing({ name: 'New', state: 'idle' }, NOW), { text: 'No runs yet' })
  assert.equal(agentMeta(r), 'gpt-4o-mini · 3,412 tok · $0.012')
  assert.equal(agentMeta({ name: 'x', state: 'idle' }), '')
  assert.deepEqual(agentTimer(c, NOW), { text: '0:42', warn: true })
  assert.deepEqual(agentTimer(r, NOW), { text: '7.0s', warn: false })
  assert.deepEqual(agentTimer(w, NOW), { text: '38m ago', warn: false })
  const long = agentDoing({ name: 'x', state: 'waiting', approval: { id: 'a', args: { cmd: 'x'.repeat(80) } } }, NOW)
  assert.equal(long.code?.length, 60)
})

test('KPI cells like the design: Runs today +6, Success 97.6%, Cost $1.84 of $10, p50 2.1s / p95 6.8s', () => {
  const k: RunKpis = { window: 'today', runs: 42, runsDelta: 6, successRate: 41 / 42, cost: 1.84, budget: 10, p50Ms: 2100, p95Ms: 6800 }
  assert.deepEqual(
    kpiCells(k).map((c) => [c.label, c.value, c.sub ?? '', c.tone ?? '']),
    [
      ['Runs today', '42', '+6', ''],
      ['Success', '97.6%', 'finished', 'success'],
      ['Cost today', '$1.84', 'of $10.00', ''],
      ['p50 latency', '2.1s', 'p95 6.8s', ''],
    ],
  )
  const empty = kpiCells({ window: 'today', runs: 0, cost: 12, budget: 10 })
  assert.deepEqual(
    empty.map((c) => [c.value, c.sub ?? '', c.tone ?? '']),
    [
      ['0', '', ''],
      ['—', 'none finished', ''],
      ['$12.00', 'of $10.00', 'warning'],
      ['—', '', ''],
    ],
  )
})

test('the banner title names the agent that asks', () => {
  assert.equal(approvalTitle({ agentName: 'Coder' }), 'Coder needs your approval to continue')
  assert.equal(approvalTitle({ agentName: ' ' }), 'An agent needs your approval to continue')
})

test('a request card says what the agent wants to do', () => {
  assert.equal(requestTitle({ agentName: 'Coder', toolName: 'shell' }), 'Coder wants to run a command')
  assert.equal(requestTitle({ agentName: 'Coder' }), 'Coder wants to run a command')
  assert.equal(requestTitle({ toolName: 'web_search' }), 'An agent wants to use web_search')
})

const gated: ChatMessageView[] = [
  { id: 'u', role: 'user', createdAt: 1, parts: [{ type: 'text', id: 't', text: 'go' }] },
  {
    id: 'm',
    role: 'assistant',
    agentName: 'Coder',
    createdAt: 2,
    parts: [
      { type: 'tool-call', id: 'a', toolName: 'shell', args: { cmd: 'ls' }, artifact: { risk_level: 'high' }, timing: { startedAt: 3 }, approval: { id: 'g1', prompt: 'List files?' } },
      { type: 'tool-call', id: 'b', toolName: 'shell', args: {}, artifact: {}, approval: { id: 'g0', approved: true } },
    ],
  },
]

test('gates waiting in the open chat count as approvals (once, by id)', () => {
  assert.deepEqual(chatGates(gated), [
    { id: 'g1', toolName: 'shell', agentName: 'Coder', args: { cmd: 'ls' }, description: 'List files?', riskLevel: 'high', createdAt: 3 },
  ])
  assert.deepEqual(withChatGates([pip], gated).map((p) => p.id), ['ap_1', 'g1'])
  assert.deepEqual(withChatGates([{ id: 'g1' }], gated).map((p) => p.id), ['g1'])
  assert.equal(agentViews([], withChatGates([], gated))[0].state, 'waiting')
})

test('the banner: listed approvals first, the chat gate off the chat page, none where the page shows it', () => {
  const on = (page: string) => ({ onApprovals: page === 'approvals', onChat: page === 'chat' })
  assert.deepEqual(attention([pip], gated, on('logs')), { item: pip, source: 'approvals', more: 1 })
  assert.deepEqual(attention([pip], gated, on('chat')), { item: pip, source: 'approvals', more: 1 })
  assert.equal(attention([pip], gated, on('approvals'))?.source, 'chat')
  assert.equal(attention([], gated, on('chat')), null)
  assert.equal(attention([pip], [], on('approvals')), null)
  assert.equal(attention([], [], on('logs')), null)
  const older = { id: 'old', createdAt: 1 }
  assert.equal(attention([pip, older], [], on('logs'))?.item.id, 'old')
})
