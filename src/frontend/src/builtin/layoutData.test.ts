// npm test -- builtin/layoutData
// The layout data first-party built-ins provide (ADR 0003 §1.1): builtin.chat's
// lazy `sessions` and `chat` feeds, builtin.approvals' `approvals` feed with its
// own EventSource, and no approval toasts while a layout shows them itself.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface FakeWindow extends EventTarget {
  location: { pathname: string; search: string; href: string }
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}
const win = new EventTarget() as FakeWindow
win.location = { pathname: '/', search: '', href: 'http://test/' }
win.setTimeout = setTimeout
win.clearTimeout = clearTimeout
;(globalThis as { window?: unknown }).window = win

const { APPROVAL_EVENT, RESOLVED_EVENT, createApprovalsFeed, layoutShowsApprovals, listenForApprovals, toApprovalItem } = await import('./approvals')
const { provideChatFeeds, showChat } = await import('./chat')
const { activateBuiltins, resetBuiltinsForTests } = await import('@/builtin')
const { activateLayout, getLayoutData, loadLayoutData, registerLayout, resetLayoutsForTests } = await import('@/sdk/layouts')
const { sdkApi } = await import('@/sdk/install')

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetLayoutsForTests()
  win.location.pathname = '/overview'
})

// ── toast suppression ────────────────────────────────────────────────

function toastSdk() {
  const toasts: string[] = []
  const sdk = {
    getPageId: () => 'overview',
    dismiss: () => Promise.resolve(),
    fetchJson: () => Promise.resolve({ approvals: [] }),
    notify: (title: string) => {
      toasts.push(title)
      return Promise.resolve(undefined)
    },
    navigate: () => undefined,
  }
  return { sdk: sdk as never, toasts }
}

test('no approval toast while the active layout shows approvals itself (meta.approvals: frame)', () => {
  const { sdk, toasts } = toastSdk()
  const stop = listenForApprovals(sdk, true)
  try {
    registerLayout('deck', { title: 'Deck', approvals: 'frame' }, () => null)
    registerLayout('plain', { title: 'Plain' }, () => null)
    activateLayout('deck')
    assert.equal(layoutShowsApprovals(), true)
    win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail: { id: 'a1', tool_name: 'shell' } }))
    assert.deepEqual(toasts, [])
    activateLayout('plain')
    assert.equal(layoutShowsApprovals(), false)
    win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail: { id: 'a2', tool_name: 'shell' } }))
    activateLayout('')
    win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail: { id: 'a3', tool_name: 'shell' } }))
    assert.deepEqual(toasts, ['Approval needed: shell', 'Approval needed: shell'], 'toasts under a toast layout and the classic frame')
  } finally {
    stop()
  }
})

// ── the approvals feed ───────────────────────────────────────────────

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 1
  closed = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  send(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

function feedSdk() {
  const calls: { url: string; opts?: Record<string, unknown> }[] = []
  let pending: unknown[] = []
  const sdk = {
    fetchJson: (url: string, opts?: Record<string, unknown>) => {
      calls.push({ url, opts })
      return Promise.resolve(url.endsWith('/pending') ? { approvals: pending } : {})
    },
  }
  return { sdk: sdk as never, calls, setPending: (p: unknown[]) => (pending = p), pendingCalls: () => calls.filter((c) => c.url.endsWith('/pending')).length }
}

const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, tool_name: 'terminal', agent_name: 'Researcher', risk_level: 'medium', created_at: 1700000000.5, ...extra })

test('toApprovalItem maps the server record (seconds to ms) and drops one without an id', () => {
  assert.deepEqual(toApprovalItem(rec('a', { session_id: 's1', description: 'Install numpy', arguments: { command: 'pip install numpy' } })), {
    id: 'a',
    toolName: 'terminal',
    agentName: 'Researcher',
    sessionId: 's1',
    riskLevel: 'medium',
    description: 'Install numpy',
    args: { command: 'pip install numpy' },
    createdAt: 1700000000500,
  })
  assert.equal(toApprovalItem({ tool_name: 'x' }), null)
  assert.equal(toApprovalItem({ id: 'b', created_at: 1700000000500 })?.createdAt, 1700000000500)
})

test('approvals feed: opens its own stream for the first subscriber, refreshes on stream messages, dedupes, keeps identity', async () => {
  FakeEventSource.instances = []
  const f = feedSdk()
  f.setPending([rec('a'), rec('a'), rec('b')])
  const feed = createApprovalsFeed(f.sdk, { EventSource: FakeEventSource as never })
  assert.equal(FakeEventSource.instances.length, 0, 'nothing opens before a frame subscribes')
  let n = 0
  const off1 = feed.subscribe(() => n++)
  const off2 = feed.subscribe(() => undefined)
  assert.equal(FakeEventSource.instances.length, 1, 'one stream for all subscribers')
  assert.equal(FakeEventSource.instances[0].url, '/api/approvals/stream')
  await settle()
  assert.deepEqual(feed.get().pending.map((p) => p.id), ['a', 'b'])
  const s1 = feed.get()
  const es = FakeEventSource.instances[0]
  es.send({ event: 'ping', pending: 2 })
  await settle()
  assert.equal(f.pendingCalls(), 1, 'a ping with the same count fetches nothing')
  es.send({ event: 'resolved', data: {}, pending: 2 })
  await settle()
  assert.equal(f.pendingCalls(), 2)
  assert.equal(feed.get(), s1, 'unchanged list: same state object')
  f.setPending([rec('b')])
  es.send({ event: 'ping', pending: 1 })
  await settle()
  assert.deepEqual(feed.get().pending.map((p) => p.id), ['b'])
  assert.ok(n >= 2)
  // The legacy runtime's window events refresh it too.
  win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail: { id: 'c' } }))
  await settle()
  assert.equal(f.pendingCalls(), 4)
  off1()
  assert.equal(es.closed, false, 'still one subscriber')
  off2()
  assert.equal(es.closed, true, 'the last unsubscribe closes the stream')
  win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail: { id: 'd' } }))
  await settle()
  assert.equal(f.pendingCalls(), 4, 'no listener left')
})

test('approvals feed: a refused stream falls back to polling; no EventSource polls from the start', async () => {
  FakeEventSource.instances = []
  const f = feedSdk()
  const feed = createApprovalsFeed(f.sdk, { EventSource: FakeEventSource as never, pollMs: 5 })
  const off = feed.subscribe(() => undefined)
  const es = FakeEventSource.instances[0]
  es.readyState = 2
  es.onerror?.()
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(f.pendingCalls() >= 3, `polled ${f.pendingCalls()} times`)
  off()
  const after = f.pendingCalls()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(f.pendingCalls(), after, 'polling stops with the last subscriber')

  const g = feedSdk()
  const noStream = createApprovalsFeed(g.sdk, { EventSource: undefined, pollMs: 5 })
  const off2 = noStream.subscribe(() => undefined)
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(g.pendingCalls() >= 2)
  off2()
})

test('approvals feed: approve (with always) and deny post the decision, drop the item and announce it', async () => {
  const f = feedSdk()
  f.setPending([rec('a'), rec('b')])
  const feed = createApprovalsFeed(f.sdk, { EventSource: FakeEventSource as never })
  const off = feed.subscribe(() => undefined)
  await settle()
  const announced: unknown[] = []
  const on = (e: Event) => announced.push((e as CustomEvent).detail)
  win.addEventListener(RESOLVED_EVENT, on)
  try {
    await feed.approve('a', { always: true })
    await feed.deny('b', 'not now')
  } finally {
    win.removeEventListener(RESOLVED_EVENT, on)
  }
  const posts = f.calls.filter((c) => c.opts?.method === 'POST')
  assert.deepEqual(posts.map((c) => [c.url, c.opts?.body]), [
    ['/api/approvals/a/approve', { always: true }],
    ['/api/approvals/b/deny', { reason: 'not now' }],
  ])
  assert.deepEqual(announced, [{ id: 'a' }, { id: 'b' }])
  off()
})

test('builtin.approvals provides the approvals feed when it activates', () => {
  resetBuiltinsForTests()
  const manifest = { sdk: 1, version: '0', style: 'app', site: {}, layout: {}, pages: [], blocks: [], toolRenderers: [], plugins: [], legacy: { customJs: null, viewsBase: '/plugins/views/' } }
  activateBuiltins(manifest as never)
  const feed = getLayoutData('approvals')
  assert.ok(feed, 'provided')
  assert.deepEqual(feed.get(), { pending: [] })
})

// ── the chat feeds ───────────────────────────────────────────────────

test('builtin.chat provides sessions and chat lazily; select opens the chat page when it is not on screen', async () => {
  const navigations: string[] = []
  let current = 'logs'
  const sdk = {
    getPageId: () => current,
    navigate: (id: string) => {
      navigations.push(id)
      current = id
    },
    provideLayoutData: sdkApi.provideLayoutData,
  }
  const removers = provideChatFeeds(sdk)
  assert.equal(removers.length, 2)
  assert.equal(getLayoutData('sessions'), null, 'not loaded until a frame reads it')
  const sessions = await loadLayoutData('sessions')
  const chat = await loadLayoutData('chat')
  assert.ok(sessions && chat)
  sessions.select('s1')
  assert.deepEqual(navigations, ['chat'])
  assert.equal(sessions.get().activeId, 's1')
  assert.equal(chat.get().sessionId, 's1')
  sessions.select('s2')
  assert.deepEqual(navigations, ['chat'], 'already on the chat page')
  showChat(sdk)
  assert.deepEqual(navigations, ['chat'])
  for (const off of removers) off()
  assert.equal(getLayoutData('sessions'), null)
})
