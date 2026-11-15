// Plain-language step labels for the Guided step tracker (ADR 0003 §3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessageView, ChatToolPartView } from '@/sdk/layoutTypes'
import { clip, deriveSteps, firstLine, formatSeconds, hasWork, humanize, spokenDuration, stepMeta, summarize, toolInput, toolLabel } from './labels'

const tool = (toolName: string, extra: Partial<ChatToolPartView> = {}): ChatToolPartView => ({
  type: 'tool-call',
  id: `tc_${toolName}`,
  toolName,
  args: {},
  artifact: {},
  ...extra,
})

/** The sorting conversation of the design (Guided.dc.html), finished. */
function sortingTurn(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: 'm1',
    role: 'assistant',
    agentName: 'Researcher',
    createdAt: 1_000,
    completedAt: 4_000,
    status: { type: 'complete' },
    parts: [
      { type: 'reasoning', id: 'r1', text: '- Compare the three', done: true, timing: { startedAt: 1_000, completedAt: 3_000 } },
      tool('terminal', {
        args: { command: 'python3 --version' },
        artifact: { label: 'Checking Python version' },
        result: 'Python 3.12.4\n',
        timing: { startedAt: 3_000, completedAt: 3_300 },
      }),
      { type: 'text', id: 't1', text: 'All three sort in **O(n log n)**' },
      { type: 'data', id: 'd1', name: 'element', data: {} },
      { type: 'text', id: 't2', text: ' on average.' },
    ],
    ...over,
  }
}

test('toolLabel: the server label wins', () => {
  assert.equal(toolLabel('terminal', { command: 'python3 --version' }, { label: 'Checking Python version' }), 'Checking Python version')
  assert.equal(toolLabel('terminal', {}, { label: '  ' }), 'Running a command')
})

test('toolLabel: tool-name patterns in plain words', () => {
  assert.equal(toolLabel('shell', { cmd: 'ls' }), 'Running a command')
  assert.equal(toolLabel('execute_command'), 'Running a command')
  assert.equal(toolLabel('bash'), 'Running a command')
  assert.equal(toolLabel('web_search', { query: 'x' }), 'Searching the web')
  assert.equal(toolLabel('tavily_search'), 'Searching the web')
  assert.equal(toolLabel('knowledge_search'), 'Searching your documents')
  assert.equal(toolLabel('search_memory'), 'Searching your documents')
  assert.equal(toolLabel('read_file', { path: '/tmp/data/report.csv' }), 'Reading report.csv')
  assert.equal(toolLabel('read_file'), 'Reading a file')
  assert.equal(toolLabel('write_file', { file_path: 'C:\\work\\sort_demo.py' }), 'Saving sort_demo.py')
  assert.equal(toolLabel('save_file'), 'Saving a file')
  assert.equal(toolLabel('fetch_url', { url: 'https://www.python.org/doc/' }), 'Visiting python.org')
  assert.equal(toolLabel('browse'), 'Visiting a web page')
  assert.equal(toolLabel('summarize_page', { url: 'https://docs.example.com/x' }), 'Visiting docs.example.com')
  assert.equal(toolLabel('get_weather', { city: 'Paris' }), 'Using Get weather')
  assert.equal(toolLabel('calculateTax'), 'Using Calculate tax')
})

test('humanize, clip and the meta line are short', () => {
  assert.equal(humanize('web_search'), 'Web search')
  assert.equal(humanize(''), 'a tool')
  assert.equal(clip('a'.repeat(50)).length, 40)
  assert.ok(clip('a'.repeat(50)).endsWith('…'))
  assert.equal(firstLine('\n  Python 3.12.4\nmore'), 'Python 3.12.4')
  assert.equal(firstLine({ stdout: 'ok\n' }), 'ok')
  assert.equal(firstLine({ hits: 2 }), '{"hits":2}')
  assert.equal(firstLine([1, 2, 3]), '3 results')
  assert.equal(firstLine([]), 'no results')
  assert.equal(firstLine(null), '')
  assert.equal(firstLine(42), '42')
  assert.equal(toolInput({ command: 'python3 --version' }), 'python3 --version')
  assert.equal(toolInput({ cmd: ['pip', 'install', 'numpy'] }), 'pip install numpy')
  assert.equal(toolInput({ city: 'Paris' }), '{"city":"Paris"}')
  assert.equal(toolInput({}), '')
})

test('durations: compact for a step, spoken for the turn', () => {
  assert.equal(formatSeconds(300), '0.3s')
  assert.equal(formatSeconds(20), '0.1s')
  assert.equal(formatSeconds(2_000), '2s')
  assert.equal(formatSeconds(65_000), '1m 5s')
  assert.equal(formatSeconds(120_000), '2m')
  assert.equal(formatSeconds(-1), '')
  assert.equal(spokenDuration(400), 'less than a second')
  assert.equal(spokenDuration(1_000), '1 second')
  assert.equal(spokenDuration(3_000), '3 seconds')
  assert.equal(spokenDuration(125_000), '2 minutes 5 seconds')
  assert.equal(spokenDuration(60_000), '1 minute')
})

test('deriveSteps: the sorting turn is three steps, the text one step', () => {
  const steps = deriveSteps(sortingTurn())
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label, s.status, s.meta]),
    [
      ['reasoning', 'Understanding your question', 'done', 'thought for 2s'],
      ['tool', 'Checking Python version', 'done', 'Python 3.12.4'],
      ['text', 'Writing the answer', 'done', undefined],
    ],
  )
  assert.equal(steps[1].durationMs, 300)
  assert.deepEqual(steps[1].detail, { tool: 'terminal', input: 'python3 --version', output: 'Python 3.12.4' })
  assert.deepEqual(steps[0].detail, { text: '- Compare the three' })
  assert.deepEqual(steps.map(stepMeta), ['Done · thought for 2s', 'Done · Python 3.12.4', 'Done'])
  assert.equal(hasWork(steps), true)
})

test('deriveSteps: a running turn marks the step in progress', () => {
  const running = deriveSteps({
    id: 'm',
    role: 'assistant',
    createdAt: 0,
    status: { type: 'running' },
    parts: [
      { type: 'reasoning', id: 'r', text: '', done: false, timing: { startedAt: 0 } },
    ],
  })
  assert.deepEqual(running.map((s) => [s.label, s.status, s.meta]), [['Understanding your question', 'running', undefined]])
  const toolRunning = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'running' }, parts: [tool('shell', { timing: { startedAt: 0 } })] })
  assert.equal(toolRunning[0].status, 'running')
  assert.equal(stepMeta(toolRunning[0]), 'Working…')
  const writing = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'running' }, parts: [tool('shell', { result: 'ok' }), { type: 'text', id: 't', text: 'Hel' }] })
  assert.deepEqual(writing.map((s) => s.status), ['done', 'running'])
})

test('deriveSteps: an open gate waits for your OK; a refused one is skipped; an error is a problem', () => {
  const gate = deriveSteps({
    id: 'm',
    role: 'assistant',
    createdAt: 0,
    status: { type: 'requires-action', reason: 'interrupt' },
    parts: [tool('shell', { args: { command: 'pip install numpy' }, approval: { id: 'ap_1' } })],
  })
  assert.deepEqual([gate[0].label, gate[0].status, gate[0].meta], ['Waiting for your OK', 'waiting', 'Running a command'])
  assert.equal(stepMeta(gate[0]), 'Needs your OK · Running a command')
  const refused = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'complete' }, parts: [tool('shell', { approval: { id: 'a', approved: false } })] })
  assert.deepEqual([refused[0].label, refused[0].status], ['Running a command', 'skipped'])
  const failed = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'complete' }, parts: [tool('shell', { isError: true, result: 'command not found: foo' })] })
  assert.deepEqual([failed[0].status, failed[0].meta], ['error', 'command not found: foo'])
})

test('deriveSteps: a stopped turn does not leave a step running', () => {
  const steps = deriveSteps({
    id: 'm',
    role: 'assistant',
    createdAt: 0,
    status: { type: 'incomplete', reason: 'cancelled' },
    parts: [tool('shell', { timing: { startedAt: 0 } })],
  })
  assert.equal(steps[0].status, 'skipped', 'a stopped turn never shows a spinner')
  const errored = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'incomplete', reason: 'error' }, parts: [tool('shell')] })
  assert.equal(errored[0].status, 'error')
  const quiet = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'complete' }, parts: [tool('shell')] })
  assert.equal(quiet[0].status, 'done', 'a finished turn whose tool sent no result')
})

test('deriveSteps: a text-only reply has no work to show', () => {
  const steps = deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, status: { type: 'complete' }, parts: [{ type: 'text', id: 't', text: 'Hi' }] })
  assert.equal(hasWork(steps), false)
  assert.deepEqual(deriveSteps({ id: 'm', role: 'assistant', createdAt: 0, parts: [{ type: 'text', id: 't', text: '   ' }] }), [])
})

test('summarize: done, running, waiting, stopped and failed turns', () => {
  const done = sortingTurn()
  assert.deepEqual(summarize(done, deriveSteps(done)), { title: 'Here is what Researcher did', status: 'All done in 3 seconds', state: 'done' })
  const noAgent = sortingTurn({ agentName: undefined, completedAt: undefined })
  assert.equal(summarize(noAgent, deriveSteps(noAgent)).title, 'Here is what the assistant did')
  assert.equal(summarize(noAgent, deriveSteps(noAgent)).status, 'All done in 2 seconds', 'without completedAt: the steps add up')
  const running = sortingTurn({ status: { type: 'running' }, completedAt: undefined })
  assert.equal(summarize(running, deriveSteps(running)).state, 'running')
  assert.match(summarize(running, deriveSteps(running)).status, /^Working on step \d$/)
  const waiting = sortingTurn({ status: { type: 'requires-action', reason: 'interrupt' } })
  assert.deepEqual(summarize(waiting, []), { title: 'Here is what Researcher did so far', status: 'Waiting for your OK', state: 'waiting' })
  assert.equal(summarize(sortingTurn({ status: { type: 'incomplete', reason: 'cancelled' } }), []).status, 'You stopped it')
  assert.equal(summarize(sortingTurn({ status: { type: 'incomplete', reason: 'error' } }), []).state, 'error')
})
