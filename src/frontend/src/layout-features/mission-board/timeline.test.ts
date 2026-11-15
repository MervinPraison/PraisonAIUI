// The run timeline of an assistant turn (timeline.ts), on the design's
// "Compare sorting algorithms" run: Think 2.0s, terminal 0.3s, Answer 4.1s,
// Handoff → Coder, Approval pending.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessageView, ChatPartView } from '@/sdk/layoutTypes'
import { isLive, lastAssistant, stepMs, stepWeight, timelineSteps } from './timeline'

const T0 = 1_000_000

function turn(parts: ChatPartView[], extra: Partial<ChatMessageView> = {}): ChatMessageView {
  return { id: 'm1', role: 'assistant', parts, createdAt: T0, status: { type: 'running' }, agentName: 'Researcher', ...extra }
}

const think: ChatPartView = { type: 'reasoning', id: 'r1', text: 'plan', done: true, timing: { startedAt: T0, completedAt: T0 + 2000 } }
const terminal: ChatPartView = {
  type: 'tool-call',
  id: 'tc1',
  toolName: 'terminal',
  args: { cmd: 'python3 --version' },
  result: 'Python 3.12.4',
  artifact: {},
  timing: { startedAt: T0 + 2000, completedAt: T0 + 2300 },
}
const answer: ChatPartView = { type: 'text', id: 't1', text: 'All three average O(n log n)…' }
const handoff: ChatPartView = {
  type: 'tool-call',
  id: 'tc2',
  toolName: 'transfer_to_coder',
  args: {},
  result: 'ok',
  artifact: {},
  timing: { startedAt: T0 + 6400, completedAt: T0 + 7000 },
}
const gate: ChatPartView = {
  type: 'tool-call',
  id: 'tc3',
  toolName: 'shell',
  args: { cmd: 'pip install numpy' },
  artifact: {},
  timing: { startedAt: T0 + 7000 },
  approval: { id: 'ap_1' },
}

test('the sorting run: think, tool, answer, handoff, approval pending', () => {
  const steps = timelineSteps(turn([think, terminal, answer, handoff, gate], { status: { type: 'requires-action', reason: 'interrupt' } }))
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label, s.status]),
    [
      ['think', 'Think', 'done'],
      ['tool', 'terminal', 'done'],
      ['answer', 'Answer', 'done'],
      ['handoff', 'Handoff → Coder', 'done'],
      ['approval', 'Approval pending', 'waiting'],
    ],
  )
  const now = T0 + 49_000
  assert.deepEqual(
    steps.map((s) => stepMs(s, now)),
    [2000, 300, 4100, 600, 42_000],
  )
  assert.equal(isLive(steps), true)
})

test('a handoff names its target from the arguments first', () => {
  const steps = timelineSteps(turn([{ ...handoff, toolName: 'handoff', args: { agent_name: 'Writer' } }]))
  assert.equal(steps[0].label, 'Handoff → Writer')
})

test('a finished turn ends its answer at completedAt and has no live step', () => {
  const steps = timelineSteps(turn([think, answer], { status: { type: 'complete' }, completedAt: T0 + 5000 }))
  assert.deepEqual(
    steps.map((s) => [s.kind, s.status, s.endedAt]),
    [
      ['think', 'done', T0 + 2000],
      ['answer', 'done', T0 + 5000],
    ],
  )
  assert.equal(isLive(steps), false)
})

test('a running answer counts up; text stretches merge; empty text and data parts are skipped', () => {
  const steps = timelineSteps(
    turn([think, answer, { type: 'data', id: 'd1', name: 'element', data: {} }, { type: 'text', id: 't2', text: 'more' }, { type: 'text', id: 't3', text: '  ' }]),
  )
  assert.deepEqual(steps.map((s) => s.kind), ['think', 'answer'])
  assert.equal(steps[1].status, 'running')
  assert.equal(stepMs(steps[1], T0 + 3500), 1500)
})

test('errors: a failed tool, a denied gate, a cancelled turn', () => {
  const failed = { ...terminal, isError: true, result: 'boom' } as ChatPartView
  const denied = { ...gate, approval: { id: 'ap_1', approved: false } } as ChatPartView
  const steps = timelineSteps(turn([failed, denied, think], { status: { type: 'incomplete', reason: 'cancelled' } }))
  assert.deepEqual(steps.map((s) => s.status), ['error', 'error', 'done'])
  const open = timelineSteps(turn([{ type: 'reasoning', id: 'r2', text: '', done: false }], { status: { type: 'incomplete', reason: 'error' } }))
  assert.equal(open[0].status, 'error')
})

test('user messages and missing turns have no timeline; weights keep short steps visible', () => {
  assert.deepEqual(timelineSteps(undefined), [])
  assert.deepEqual(timelineSteps({ id: 'u', role: 'user', parts: [answer], createdAt: T0 }), [])
  const [tool] = timelineSteps(turn([terminal]))
  assert.equal(stepWeight(tool, T0), 0.5)
  assert.equal(stepWeight({ ...tool, endedAt: tool.startedAt + 4000 }, T0), 4)
  const msgs: ChatMessageView[] = [{ id: 'u', role: 'user', parts: [], createdAt: T0 }, turn([]), { id: 'u2', role: 'user', parts: [], createdAt: T0 }]
  assert.equal(lastAssistant(msgs)?.id, 'm1')
  assert.equal(lastAssistant([]), undefined)
})

test('while a turn waits on a gate, only the gate counts up', () => {
  const steps = timelineSteps(turn([think, gate, answer], { status: { type: 'requires-action', reason: 'interrupt' } }))
  assert.deepEqual(steps.map((s) => [s.kind, s.status]), [
    ['think', 'done'],
    ['approval', 'waiting'],
    ['answer', 'done'],
  ])
  assert.equal(steps.filter((s) => s.endedAt === undefined).length, 1)
})
