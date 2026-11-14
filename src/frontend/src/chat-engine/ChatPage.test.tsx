// npm test -- chat-engine/ChatPage
// The chat inside a layout (ADR 0003 §1.3): the Thread renders the "sorting"
// conversation in every variant and approval presentation the page passes
// from useLayout().meta.chat, regions included; without them it is the
// thread as before. The aside's phone switch and desktop panel are rendered
// on their own. Rendered to HTML with react-dom/static, which waits for the
// lazy chunks (variant headers, the approval card, the keyboard strip,
// regions). The page itself (its rail, the header toggle) is covered by
// e2e: useAiuiRuntime has no server snapshot, so it cannot render here.
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ReactNode } from 'react'
import { prerenderToNodeStream } from 'react-dom/static'
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react'
import type { ChatPresentation, ChatRegionProps, TurnRegionProps } from '@/sdk/layouts'
import { convertMessage } from './convert'
import ChatAside from './presentation/Aside'
import * as host from './presentation/host'
import { reportBadge } from './presentation/regionState'
import { Thread } from './Thread'
import { resetSessionsForTests } from './sessionsStore'
import { threadStore } from './store'
import type { AiuiTransport, SendArgs } from './transports'
import type { WireEvent } from './protocol'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
}

const SID = 'sort'

/** The design files' conversation: reasoning, a tool, a table, a code block, then a gate. */
const SORTING: WireEvent[] = [
  { type: 'run_started', run_id: 'run_3c7e19', agent_name: 'Researcher' },
  { type: 'reasoning_started' },
  { type: 'reasoning_step', step: 'Compare the three on average and worst case' },
  { type: 'reasoning_completed' },
  { type: 'tool_call_started', name: 'terminal', tool_call_id: 'tc1', args: { command: 'python3 --version' } },
  { type: 'tool_call_completed', name: 'terminal', tool_call_id: 'tc1', result: 'Python 3.12.4' },
  {
    type: 'token',
    token:
      'All three sort in **O(n log n)** on average.\n\n| Algorithm | Average | Worst | Stable |\n|---|---|---|---|\n| quicksort | O(n log n) | O(n²) | No |\n| mergesort | O(n log n) | O(n log n) | Yes |\n| timsort | O(n log n) | O(n log n) | Yes |\n\n```python\ndata = [5, 2, 9, 1]\nsorted(data)  # timsort\n```\n',
  },
  {
    type: 'run_paused',
    extra_data: {
      type: 'approval_required',
      id: 'ap_numpy',
      tool_name: 'terminal',
      arguments: { command: 'pip install numpy' },
      risk_level: 'medium',
      description: 'Researcher wants to install numpy to run the benchmark.',
    },
  },
]

function sortingSession() {
  let emit: (ev: WireEvent) => void = () => undefined
  const t: AiuiTransport = {
    kind: 'ws',
    send: (args: SendArgs) =>
      new Promise<void>((resolve) => {
        emit = args.onEvent
        args.signal.addEventListener('abort', () => resolve(), { once: true })
      }),
    async cancel() {},
    async respondAsk() {},
  }
  return { t, start: async () => {
    void threadStore.send(t, SID, 'Compare quicksort, mergesort and timsort, with a code sample')
    await new Promise((r) => setTimeout(r, 0))
    for (const ev of SORTING) emit(ev)
    threadStore.flush()
  } }
}

async function html(node: ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node)
  let out = ''
  for await (const chunk of prelude) out += String(chunk)
  return out.replace(/<!-- -->/g, '') // text-node separators
}

/** An <aside> whose class list holds the token `hidden` (not overflow-hidden). */
const HIDDEN_ASIDE = /<aside[^>]*class="(?:[^"]* )?hidden(?: [^"]*)?"/

/** Region stand-ins a layout would load from its own chunk. */
const regions = {
  turnHeader: async () => ({ default: (p: TurnRegionProps) => createElement('div', { 'data-test-tracker': p.messageId, 'data-viewport': p.viewport }) }),
  turnFooter: async () => ({ default: (p: TurnRegionProps) => createElement('div', { 'data-test-chips': p.messageId }) }),
  aside: async () => ({ default: (p: ChatRegionProps) => createElement('div', { 'data-test-canvas': p.sessionId ?? 'none' }, 'Canvas body') }),
  empty: async () => ({ default: () => createElement('div', { 'data-test-templates': '' }, 'Templates') }),
}

let chat: ChatPresentation | null = null
/** false: the host chunk has not loaded yet. */
let loaded = true
function withLayout(c: ChatPresentation) {
  chat = c
}

/** What ChatPage does with meta.chat, around a plain external-store runtime. */
function Harness({ sid }: { sid: string | null }) {
  const thread = threadStore.get(sid)
  const runtime = useExternalStoreRuntime({
    messages: thread.messages,
    isRunning: thread.isRunning,
    convertMessage,
    onNew: async () => undefined,
  })
  const presentation = chat ? { chat, host: loaded ? host : null, sessionId: sid } : undefined
  return createElement(AssistantRuntimeProvider, { runtime }, createElement(Thread, { sessionId: sid ?? undefined, presentation }))
}

let session: ReturnType<typeof sortingSession>
let sid: string | null = SID
beforeEach(async () => {
  chat = null
  loaded = true
  sid = SID
  setWidth(1440)
  resetSessionsForTests()
  threadStore.reset()
  session = sortingSession()
  await session.start()
})
afterEach(async () => {
  await threadStore.cancel(session.t, SID)
  threadStore.reset()
  resetSessionsForTests()
})

const render = () => html(createElement(Harness, { sid }))

test('without a layout the thread is as before: no variant, the inline gate', async () => {
  const out = await render()
  assert.doesNotMatch(out, /data-variant="(quiet|bubbles|steps|dense)"/)
  assert.doesNotMatch(out, /data-approvals=/)
  assert.match(out, /data-approval-gate/)
  assert.doesNotMatch(out, /data-approval-card|data-approval-keys|data-turn-meta|data-chat-aside/)
  // The fixture is there: question, tool row, gate.
  assert.match(out, /Compare quicksort, mergesort and timsort/)
  assert.match(out, /data-tool="terminal"/)
  assert.match(out, /data-user-bubble/)
})

test('every thread variant renders the sorting fixture with its own marker and turn header', async () => {
  const cases = [
    ['quiet', null],
    ['bubbles', 'bubbles'],
    ['steps', 'steps'],
    ['dense', 'dense'],
  ] as const
  for (const [thread, meta] of cases) {
    withLayout({ sessions: 'frame', thread })
    const out = await render()
    assert.match(out, new RegExp(`data-variant="${thread}"`), thread)
    assert.match(out, /Compare quicksort, mergesort and timsort/, thread)
    assert.match(out, /data-tool="terminal"/, thread)
    assert.match(out, /data-approval-gate/, thread)
    if (meta) assert.match(out, new RegExp(`data-turn-meta="${meta}"[^]*Researcher`), thread)
    else assert.doesNotMatch(out, /data-turn-meta=/, thread)
    if (thread === 'dense') assert.match(out, /run_3c7e19/, 'dense shows the run id')
  }
})

test('approvals card: the explained card with "Why am I asked?", the command and the risk', async () => {
  withLayout({ approvals: 'card' })
  const out = await render()
  assert.match(out, /data-approval-card/)
  assert.match(out, /Allow Researcher to use terminal\?/)
  assert.match(out, /Researcher wants to install numpy to run the benchmark\./)
  assert.match(out, /pip install numpy/)
  assert.match(out, /Why am I asked\?/)
  assert.match(out, /aria-expanded="false"[^>]*>Why am I asked\?/)
  assert.match(out, />Not now</)
  assert.match(out, />Approve</)
  assert.match(out, /medium/)
})

test('approvals keyboard: the paused strip with A and D', async () => {
  withLayout({ approvals: 'keyboard', thread: 'dense' })
  const out = await render()
  assert.match(out, /data-approval-keys/)
  assert.match(out, /Paused: Researcher wants to run/)
  assert.match(out, /pip install numpy/)
  assert.match(out, /aria-keyshortcuts="A"/)
  assert.match(out, /aria-keyshortcuts="D"/)
})

test('approvals inline (or unset) keeps the default gate', async () => {
  withLayout({ approvals: 'inline' })
  const out = await render()
  assert.match(out, /data-approval-gate/)
  assert.doesNotMatch(out, /data-approval-card|data-approval-keys/)
})

test('turnHeader and turnFooter render around each assistant turn with its message id; steps hands the steps to the tracker', async () => {
  withLayout({ thread: 'steps', turnHeader: regions.turnHeader, turnFooter: regions.turnFooter })
  const out = await render()
  const assistantId = threadStore.get(SID).messages.find((m) => m.role === 'assistant')!.id
  assert.match(out, new RegExp(`data-test-tracker="${assistantId}"`))
  assert.match(out, new RegExp(`data-test-chips="${assistantId}"`))
  assert.match(out, /data-chat-region="turnHeader"/)
  // The tracker comes before the answer, the chips after it.
  assert.ok(out.indexOf('data-test-tracker') < out.indexOf('data-tool="terminal"'))
  assert.ok(out.indexOf('data-test-chips') > out.indexOf('data-tool="terminal"'))
})

test('a region that fails to load disappears on its own; the chat still renders', async () => {
  const warn = console.warn
  console.warn = () => undefined
  try {
    withLayout({ turnHeader: async () => Promise.reject(new Error('chunk gone')) })
    const out = await render()
    assert.match(out, /Compare quicksort/)
    assert.doesNotMatch(out, /data-test-tracker/)
  } finally {
    console.warn = warn
  }
})

test('empty: an empty thread shows the region instead of the starters', async () => {
  sid = null
  withLayout({ empty: regions.empty })
  const out = await render()
  assert.match(out, /data-test-templates/)
})

function setWidth(w: number) {
  Object.defineProperty(globalThis, 'innerWidth', { value: w, configurable: true, writable: true })
}

const asideProps = { loader: regions.aside, label: 'Canvas', sessionId: SID }

test('aside on a desktop: an open, resizable panel with the region', async () => {
  const out = await html(createElement(ChatAside, asideProps))
  assert.match(out, /role="separator"[^>]*aria-label="Resize Canvas"/)
  assert.match(out, /<aside[^>]*aria-label="Canvas"/)
  assert.doesNotMatch(out, HIDDEN_ASIDE)
  assert.match(out, new RegExp(`data-test-canvas="${SID}"`))
  assert.doesNotMatch(out, /data-chat-aside-switch/)
})

test('aside on a tablet: collapsed by default, the region still mounted', async () => {
  setWidth(900)
  const out = await html(createElement(ChatAside, asideProps))
  assert.doesNotMatch(out, /role="separator"/)
  assert.match(out, HIDDEN_ASIDE)
  assert.match(out, /data-test-canvas/)
})

test('aside on a phone: a Chat | Canvas switch with the badge; the region stays mounted while the chat side shows', async () => {
  setWidth(390)
  reportBadge(2)
  try {
    const out = await html(createElement(ChatAside, asideProps))
    assert.match(out, /data-chat-aside-switch[^>]*data-tab="chat"/)
    assert.match(out, /aria-pressed="true"[^>]*>Chat</)
    assert.match(out, /Canvas<span[^>]*aria-label="2 items"/)
    assert.match(out, /min-h-11/, '44 px touch targets')
    assert.match(out, HIDDEN_ASIDE)
    assert.match(out, /data-test-canvas/, 'mounted while hidden, so it can report its badge')
    assert.doesNotMatch(out, /role="separator"/)
  } finally {
    reportBadge(0)
  }
})

test('regions get the viewport class and a reportBadge that ignores junk', async () => {
  setWidth(390)
  let got: ChatRegionProps | null = null
  const loader = async () => ({ default: (p: ChatRegionProps) => ((got = p), null) })
  await html(createElement(host.Region, { loader, name: 'empty', sessionId: 'x' }))
  assert.equal(got!.viewport, 'phone')
  assert.equal(got!.sessionId, 'x')
  got!.reportBadge(Number.NaN)
  got!.reportBadge(-3)
})

test('before the host chunk has loaded the thread renders as without a layout', async () => {
  withLayout({ thread: 'bubbles', approvals: 'card', turnHeader: regions.turnHeader })
  loaded = false
  const out = await render()
  assert.match(out, /data-variant="bubbles"/)
  assert.match(out, /data-approval-gate/)
  assert.doesNotMatch(out, /data-approval-card|data-turn-meta|data-test-tracker/)
})
