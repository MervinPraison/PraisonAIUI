// The run inspector over the chat feed: the paused run of the design, the
// empty states without a run or without the chat, the phone peek, and the
// ledger record check and detail mapping.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests } from '@/sdk/layouts'
import type { ApprovalsFeed, ChatFeed, ChatMessageView, ChatState } from '@/sdk/layoutTypes'
import RunInspector from './RunInspector'
import { hasRunLedger, normalizeRunDetail } from './api'

const T0 = Date.now() - 5000

const paused: ChatMessageView[] = [
  { id: 'u1', role: 'user', createdAt: T0 - 500, parts: [{ type: 'text', id: 't', text: 'Compare sorting algorithms' }] },
  {
    id: 'a1', role: 'assistant', createdAt: T0, runId: 'run_3c7e19', agentName: 'Researcher',
    status: { type: 'requires-action', reason: 'interrupt' },
    parts: [
      { type: 'reasoning', id: 'r', text: 'plan', done: true, timing: { startedAt: T0, completedAt: T0 + 2000 } },
      { type: 'tool-call', id: 'tc1', toolName: 'terminal', args: { cmd: 'python3 --version' }, result: 'Python 3.12.4', artifact: {}, timing: { startedAt: T0 + 2000, completedAt: T0 + 2300 } },
      { type: 'text', id: 'x', text: 'All three average O(n log n).' },
      {
        type: 'tool-call', id: 'tc2', toolName: 'terminal', args: { cmd: 'pip install numpy' }, artifact: { description: 'To benchmark on 1M items.' },
        timing: { startedAt: T0 + 4400 }, approval: { id: 'ap_1' },
      },
    ],
  },
]

function chatFeed(messages: ChatMessageView[]): ChatFeed {
  const state: ChatState = { sessionId: 's1', messages, isRunning: true }
  return {
    get: () => state,
    subscribe: () => () => {},
    prefill: () => {},
    cancel: async () => {},
    resolveApproval: async () => {},
  }
}

const approvalsFeed: ApprovalsFeed = {
  get: () => ({ pending: [] }),
  subscribe: () => () => {},
  approve: async () => {},
  deny: async () => {},
}

const html = (props: Parameters<typeof RunInspector>[0] = {}) => renderToStaticMarkup(createElement(RunInspector, props))

beforeEach(() => resetLayoutsForTests())

test('without the chat feed: an empty state, never a crash', () => {
  const out = html()
  assert.match(out, /aria-label="Run inspector"/)
  assert.match(out, /Run details appear here when chat is on/)
})

test('a chat with no answer yet: "No run yet"', () => {
  provideLayoutData('chat', chatFeed([paused[0]]))
  assert.match(html(), /data-run-empty/)
  assert.equal(html({ variant: 'sheet' }), '', 'the phone peek waits for a run')
})

test('the paused run: header, approval with A / D and Always allow, metrics, steps, files', () => {
  provideLayoutData('chat', chatFeed(paused))
  provideLayoutData('approvals', approvalsFeed)
  const out = html()
  assert.match(out, /<h2[^>]*>Run<\/h2>/)
  assert.match(out, /run_3c7e19/)
  assert.match(out, /data-run-status="waiting"[^>]*>awaiting approval</)
  assert.match(out, /data-run-stop/)
  assert.match(out, /Approval needed/)
  assert.match(out, /terminal wants to run/)
  assert.match(out, /pip install numpy/)
  assert.match(out, /To benchmark on 1M items\./)
  assert.match(out, /Always allow/)
  assert.match(out, /aria-keyshortcuts="A"/)
  assert.match(out, /aria-keyshortcuts="D"/)
  assert.match(out, /<dt[^>]*>Elapsed<\/dt>/)
  assert.match(out, /<dt[^>]*>Tokens<\/dt><dd[^>]*>—<\/dd>/, 'no ledger: tokens unknown')
  assert.match(out, />3\/4</, 'three of four steps done')
  assert.deepEqual([...out.matchAll(/data-run-step="(\d+)" data-state="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`), ['01:done', '02:done', '03:done', '04:waiting'])
  assert.match(out, /No files touched/)
  assert.match(out, /<span class="flex items-center gap-1"><kbd[^>]*>J<\/kbd>/, 'the key legend')
})

test('without the approvals feed there is no "Always allow"', () => {
  provideLayoutData('chat', chatFeed(paused))
  assert.doesNotMatch(html(), /Always allow/)
})

test('the phone peek: run status, steps and the approval row with 44 px buttons', () => {
  provideLayoutData('chat', chatFeed(paused))
  const out = html({ variant: 'sheet' })
  assert.match(out, /data-run-inspector="sheet"/)
  assert.match(out, /aria-expanded="false" aria-label="Expand run panel"/)
  assert.match(out, />3\/4</)
  assert.match(out, /class="[^"]*h-11[^"]*"[^>]*data-run-deny/)
  assert.match(out, /class="[^"]*h-11[^"]*"[^>]*data-run-approve/)
  assert.doesNotMatch(out, /data-run-metrics/, 'collapsed: the body is not rendered')
})

test('the ledger is asked only while its record is ok; its run maps onto RunDetail', () => {
  assert.equal(hasRunLedger(null), false)
  assert.equal(hasRunLedger({ plugins: [{ name: 'builtin.run-ledger', status: 'disabled' }] }), false)
  assert.equal(hasRunLedger({ plugins: [{ name: 'builtin.run-ledger', status: 'ok' }] }), true)
  assert.equal(normalizeRunDetail({ id: 'r' }), null)
  assert.deepEqual(
    normalizeRunDetail({ id: 'r', startedAt: 1, status: 'completed', tokens: 1432, tokensIn: 912, tokensOut: 520, cost: 0.00045, model: 'gpt-4o-mini', approximate: false, steps: [{}] }),
    {
      id: 'r', startedAt: 1, status: 'completed', sessionId: undefined, agent: undefined, endedAt: undefined, stepCount: undefined,
      tokens: 1432, tokensIn: 912, tokensOut: 520, cost: 0.00045, model: 'gpt-4o-mini', approximate: undefined, steps: [],
    },
  )
  assert.equal(normalizeRunDetail({ id: 'r', startedAt: 1, status: 'weird' })?.status, 'completed')
})
