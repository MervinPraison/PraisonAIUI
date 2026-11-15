// The run inspector's model: steps and timings, the pending approval, files
// touched, and the number formats of the Command Deck design.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessageView, ChatPartView } from '@/sdk/layoutTypes'
import { deriveFiles, deriveRun, filesOfCommand, isRunLive, rememberApprovals, formatCost, formatDuration, formatTokens, statusLabel } from './steps'

const T0 = 1_700_000_000_000

const user: ChatMessageView = { id: 'u1', role: 'user', createdAt: T0 - 1000, parts: [{ type: 'text', id: 't0', text: 'Compare sorting algorithms' }] }

/** The design's "Compare sorting algorithms" run: think 2 s, a 0.3 s tool, a table + code answer, a gate on pip install. */
function sortingRun(opts: { gate?: 'pending' | 'approved' | 'none'; status?: ChatMessageView['status'] } = {}): ChatMessageView {
  const gate = opts.gate ?? 'pending'
  const parts: ChatPartView[] = [
    { type: 'reasoning', id: 'r1', text: 'The user wants a comparison\nof three sorts', done: true, timing: { startedAt: T0, completedAt: T0 + 2000 } },
    {
      type: 'tool-call', id: 'tc1', toolName: 'terminal', args: { cmd: 'python3 --version' }, result: 'Python 3.12.4\n',
      artifact: {}, timing: { startedAt: T0 + 2000, completedAt: T0 + 2300 },
    },
    { type: 'text', id: 'x1', text: 'All three average O(n log n).\n\n| Algorithm | Worst |\n|---|---|\n| quicksort | O(n²) |\n\n```python\nsorted(data)\n```' },
  ]
  if (gate !== 'none') {
    parts.push({
      type: 'tool-call', id: 'tc2', toolName: 'terminal', args: { cmd: 'pip install numpy > requirements.txt' },
      artifact: { risk_level: 'medium', description: 'To benchmark the sorts on 1,000,000 integers.' },
      timing: { startedAt: T0 + 4400 },
      approval: { id: 'ap_1', ...(gate === 'approved' ? { approved: true } : {}) },
      ...(gate === 'approved' ? { result: 'ok', timing: { startedAt: T0 + 4400, completedAt: T0 + 6000 } } : {}),
    })
  }
  return {
    id: 'a1', role: 'assistant', createdAt: T0, runId: 'run_3c7e19', agentName: 'Researcher', parts,
    status: opts.status ?? (gate === 'pending' ? { type: 'requires-action', reason: 'interrupt' } : { type: 'complete' }),
    ...(gate === 'pending' ? {} : { completedAt: T0 + 6000 }),
  }
}

test('no assistant message: no run', () => {
  assert.equal(deriveRun([], T0), null)
  assert.equal(deriveRun([user], T0), null)
})

test('a run paused on approval: four steps, the gate waiting, its wait counted from first sight', () => {
  const seen = new Map<string, number>()
  assert.equal(isRunLive([user, sortingRun()]), true)
  assert.equal(rememberApprovals([user, sortingRun()], seen, T0 + 4800), true)
  assert.equal(rememberApprovals([user, sortingRun()], seen, T0 + 9999), false, 'first sight only')
  const first = deriveRun([user, sortingRun()], T0 + 4800, seen)!
  assert.equal(first.status, 'waiting')
  assert.equal(first.runId, 'run_3c7e19')
  assert.equal(first.agent, 'Researcher')
  assert.deepEqual(first.steps.map((s) => [s.n, s.kindLabel, s.state]), [
    ['01', 'reasoning', 'done'],
    ['02', 'tool · terminal', 'done'],
    ['03', 'response', 'done'],
    ['04', 'tool · terminal', 'waiting'],
  ])
  assert.equal(first.steps[0].title, 'Thought for 2s')
  assert.equal(first.steps[0].detail, 'The user wants a comparison')
  assert.equal(first.steps[1].title, '$ python3 --version')
  assert.equal(first.steps[1].detail, '→ Python 3.12.4')
  assert.equal(formatDuration(first.steps[1].durationMs), '0.3s')
  assert.equal(first.steps[2].title, 'markdown · table + code')
  assert.equal(formatDuration(first.steps[2].durationMs), '2.1s', 'the answer ends where the gated tool starts')
  assert.equal(first.steps[3].title, '$ pip install numpy > requirements.txt')
  assert.equal(first.steps[3].detail, 'needs approval · A / D')
  assert.equal(first.doneSteps, 3)
  assert.deepEqual(first.approval, {
    id: 'ap_1', toolName: 'terminal', call: 'pip install numpy > requirements.txt', isCommand: true,
    description: 'To benchmark the sorts on 1,000,000 integers.', risk: 'medium', since: T0 + 4800,
  })
  assert.equal(first.waitingMs, 0)
  // Twelve seconds later the same approval has waited 0:12.
  const later = deriveRun([user, sortingRun()], T0 + 16_800, seen)!
  assert.equal(formatDuration(later.waitingMs, true), '0:12')
  assert.equal(formatDuration(later.steps[3].durationMs, true), '0:12')
  assert.equal(later.endedAt, undefined)
  assert.equal(later.elapsedMs, 16_800)
  assert.deepEqual(later.files, [{ path: 'requirements.txt', state: 'if approved' }])
})

test('bars sit on the run’s time line: x and w are percents of the span', () => {
  const run = deriveRun([user, sortingRun({ gate: 'none' })], T0 + 9999)!
  assert.equal(isRunLive([user, sortingRun({ gate: 'none' })]), false)
  assert.equal(run.status, 'completed')
  assert.equal(run.endedAt, T0 + 6000)
  assert.equal(run.elapsedMs, 6000)
  const [think, tool] = run.steps
  assert.equal(think.x, 0)
  assert.equal(think.w, 33.3)
  assert.equal(tool.x, 33.3)
  assert.equal(tool.w, 5)
  for (const s of run.steps) assert.ok(s.x + s.w <= 100.0001, `${s.n} stays on the bar`)
})

test('an approved gate is a finished step and its files are written', () => {
  const run = deriveRun([user, sortingRun({ gate: 'approved' })], T0 + 9000)!
  assert.equal(run.status, 'completed')
  assert.equal(run.approval, undefined)
  assert.equal(run.steps[3].state, 'done')
  assert.deepEqual(run.files, [{ path: 'requirements.txt', state: 'written' }])
})

test('a stopped or failed reply', () => {
  const stopped = deriveRun([sortingRun({ gate: 'none', status: { type: 'incomplete', reason: 'cancelled' } })], T0 + 9000)!
  assert.equal(stopped.status, 'cancelled')
  assert.equal(statusLabel(stopped.status).text, 'stopped')
  const failed = deriveRun([sortingRun({ gate: 'pending', status: { type: 'incomplete', reason: 'error', error: 'x' } })], T0 + 9000)!
  assert.equal(failed.status, 'failed')
  assert.equal(failed.approval, undefined, 'a dead run has no live approval')
})

test('a running reply counts to now and its answer is open', () => {
  const m: ChatMessageView = {
    id: 'a2', role: 'assistant', createdAt: T0, status: { type: 'running' },
    parts: [
      { type: 'reasoning', id: 'r', text: '', done: false, timing: { startedAt: T0 } },
    ],
  }
  const run = deriveRun([m], T0 + 1500)!
  assert.equal(run.status, 'running')
  assert.equal(run.steps[0].title, 'Thinking…')
  assert.equal(run.steps[0].state, 'running')
  assert.equal(run.elapsedMs, 1500)
})

test('files touched: path arguments, shell writes and deletes; a read never hides a write', () => {
  assert.deepEqual(filesOfCommand('echo hi > out.txt && cat a | tee log/run.log; rm -f old.tmp; cp a.py b/'), [
    { path: 'out.txt' },
    { path: 'log/run.log' },
    { path: 'old.tmp', deleted: true },
    { path: 'b/' },
  ])
  assert.deepEqual(filesOfCommand('python3 --version 2>/dev/null'), [])
  const tool = (id: string, toolName: string, args: Record<string, unknown>, extra = {}): ChatPartView => ({
    type: 'tool-call', id, toolName, args, artifact: {}, result: 'ok', ...extra,
  })
  assert.deepEqual(
    deriveFiles([
      tool('1', 'write_file', { path: 'src/sort.py', content: 'x' }),
      tool('2', 'read_file', { path: 'src/sort.py' }),
      tool('3', 'read_file', { file_path: 'README.md' }),
      tool('4', 'delete_file', { path: 'tmp/x.txt' }),
      tool('5', 'write_file', { path: 'bad.txt' }, { isError: true }),
      tool('6', 'web_search', { query: 'how to sort. fast' }),
      tool('7', 'edit', { paths: ['a/b.ts', 'not a path'] }),
    ]),
    [
      { path: 'src/sort.py', state: 'written' },
      { path: 'README.md', state: 'read' },
      { path: 'tmp/x.txt', state: 'deleted' },
      { path: 'bad.txt', state: 'failed' },
      { path: 'a/b.ts', state: 'written' },
    ],
  )
})

test('formats: durations, cost and tokens as the design writes them', () => {
  assert.equal(formatDuration(300), '0.3s')
  assert.equal(formatDuration(4400), '4.4s')
  assert.equal(formatDuration(65_000), '1:05')
  assert.equal(formatDuration(12_400, true), '0:12')
  assert.equal(formatDuration(-5), '0.0s')
  assert.equal(formatCost(0.00045), '$0.00045')
  assert.equal(formatCost(0.0012345), '$0.0012')
  assert.equal(formatCost(0.0123), '$0.012')
  assert.equal(formatCost(1.234), '$1.23')
  assert.equal(formatCost(0), '$0.00')
  assert.equal(formatCost(undefined), null)
  assert.equal(formatTokens(1432), '1,432')
  assert.equal(formatTokens(undefined), null)
})

test('an approval shows the exact call even when the step has a label; a quick thought says <1s', () => {
  const m: ChatMessageView = {
    id: 'a', role: 'assistant', createdAt: T0, status: { type: 'requires-action', reason: 'interrupt' },
    parts: [
      { type: 'reasoning', id: 'r', text: 'x', done: true, timing: { startedAt: T0, completedAt: T0 + 40 } },
      { type: 'text', id: 't', text: 'Searching first.' },
      {
        type: 'tool-call', id: 'tc', toolName: 'web_search', args: { query: 'sorting algorithms' },
        artifact: { label: 'Searching the web' }, result: { hits: 2 }, timing: { startedAt: T0 + 100, completedAt: T0 + 200 },
        approval: { id: 'ap' },
      },
    ],
  }
  const run = deriveRun([m], T0 + 5000, new Map([['ap', T0 + 1000]]))!
  assert.equal(run.steps[0].title, 'Thought for <1s')
  assert.equal(run.steps.find((s) => s.kind === 'tool')?.title, 'Searching the web')
  assert.equal(run.approval?.call, 'sorting algorithms')
  assert.equal(run.approval?.isCommand, false)
  assert.equal(formatDuration(run.waitingMs, true), '0:04')
})

test('paused after its text: the answer ends when the pause was first seen, not now', () => {
  const m: ChatMessageView = {
    id: 'a', role: 'assistant', createdAt: T0, status: { type: 'requires-action', reason: 'interrupt' },
    parts: [
      { type: 'tool-call', id: 'tc', toolName: 'shell', args: { cmd: 'ls' }, artifact: {}, result: 'ok', timing: { startedAt: T0, completedAt: T0 + 1000 }, approval: { id: 'ap' } },
      { type: 'text', id: 't', text: 'Listed.' },
    ],
  }
  const run = deriveRun([m], T0 + 60_000, new Map([['ap', T0 + 3000]]))!
  const answer = run.steps.find((s) => s.kind === 'response')!
  assert.equal(formatDuration(answer.durationMs), '2.0s')
})
