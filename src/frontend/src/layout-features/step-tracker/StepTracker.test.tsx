// The step tracker region over the `chat` layout feed.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests, type LayoutViewport } from '@/sdk/layouts'
import type { ChatFeed, ChatMessageView } from '@/sdk/layoutTypes'
import StepTracker from './StepTracker'

beforeEach(() => resetLayoutsForTests())

function chatFeed(messages: ChatMessageView[]): ChatFeed {
  const state = { sessionId: 's1', messages, isRunning: false }
  return {
    get: () => state,
    subscribe: () => () => {},
    prefill: () => {},
    cancel: async () => {},
    resolveApproval: async () => {},
  }
}

const sorting: ChatMessageView = {
  id: 'm1',
  role: 'assistant',
  agentName: 'Researcher',
  createdAt: 1_000,
  completedAt: 4_000,
  status: { type: 'complete' },
  parts: [
    { type: 'reasoning', id: 'r1', text: 'thinking', done: true, timing: { startedAt: 1_000, completedAt: 3_000 } },
    {
      type: 'tool-call',
      id: 'tc1',
      toolName: 'terminal',
      args: { command: 'python3 --version' },
      artifact: { label: 'Checking Python version' },
      result: 'Python 3.12.4',
      timing: { startedAt: 3_000, completedAt: 3_300 },
    },
    { type: 'text', id: 't1', text: 'All three sort in O(n log n).' },
  ],
}

const render = (messageId: string, viewport: LayoutViewport = 'desktop') =>
  renderToStaticMarkup(createElement(StepTracker, { messageId, sessionId: 's1', viewport, reportBadge: () => {} }))

test('renders nothing without the chat feed or for an unknown turn', () => {
  assert.equal(render('m1'), '')
  provideLayoutData('chat', chatFeed([sorting]))
  assert.equal(render('nope'), '')
})

test('desktop: the heading, numbered plain steps with their results, the total time, Show details', () => {
  provideLayoutData('chat', chatFeed([sorting]))
  const out = render('m1')
  assert.match(out, /aria-label="What Researcher did"/)
  assert.match(out, /data-step-tracker="done"/)
  assert.match(out, />Here is what Researcher did</)
  assert.match(out, />All done in 3 seconds</)
  assert.match(out, /1 <\/span>Understanding your question/)
  assert.match(out, /Done · thought for 2s/)
  assert.match(out, /2 <\/span>Checking Python version/)
  assert.match(out, /Done · Python 3.12.4/)
  assert.match(out, /3 <\/span>Writing the answer/)
  assert.match(out, /aria-expanded="false"[^>]*>Show details/)
  assert.doesNotMatch(out, /data-step-details/, 'details stay closed until asked')
})

test('phone: one step per row with its short result, the status under the list', () => {
  provideLayoutData('chat', chatFeed([sorting]))
  const out = render('m1', 'phone')
  assert.doesNotMatch(out, /<h3/)
  assert.match(out, /flex-col gap-2/)
  assert.match(out, />Python 3.12.4</)
  assert.match(out, /min-h-11/, 'the toggle is a 44 px target')
})

test('a text-only reply shows no tracker; a turn waiting on a gate says so', () => {
  provideLayoutData(
    'chat',
    chatFeed([
      { id: 'plain', role: 'assistant', createdAt: 0, status: { type: 'complete' }, parts: [{ type: 'text', id: 't', text: 'Hi' }] },
      {
        id: 'gate',
        role: 'assistant',
        agentName: 'Researcher',
        createdAt: 0,
        status: { type: 'requires-action', reason: 'interrupt' },
        parts: [{ type: 'tool-call', id: 'tc', toolName: 'shell', args: { command: 'pip install numpy' }, artifact: {}, approval: { id: 'ap' } }],
      },
    ]),
  )
  assert.equal(render('plain'), '')
  const out = render('gate')
  assert.match(out, /data-step-tracker="waiting"/)
  assert.match(out, />Waiting for your OK</)
  assert.match(out, /Needs your OK · Running a command/)
})
