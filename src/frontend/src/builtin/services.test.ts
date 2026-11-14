// The service built-ins: builtin.approvals (approval toasts on notify/navigate)
// and builtin.chat's "New chat" command. A fake window with a location and
// real events; no DOM library.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface FakeWindow extends EventTarget {
  location: { pathname: string }
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}
const win = new EventTarget() as FakeWindow
win.location = { pathname: '/' }
win.setTimeout = setTimeout
win.clearTimeout = clearTimeout
;(globalThis as { window?: unknown }).window = win

const { APPROVAL_EVENT, RESOLVED_EVENT, listenForApprovals } = await import('./approvals')
const { startNewChat } = await import('./chat')
const { PAGE_CHANGE_EVENT, whenPageShown } = await import('./page')
const { getPageId } = await import('@/sdk/services')

type Toast = { title: string; opts: Record<string, unknown> }
function fakeSdk(pageId: () => string = getPageId) {
  const toasts: Toast[] = []
  const navigations: string[] = []
  const dismissed: unknown[] = []
  const fetches: string[] = []
  let pending: unknown = { approvals: [] }
  const sdk = {
    getPageId: pageId,
    dismiss: (id?: string | number) => {
      dismissed.push(id)
      return Promise.resolve()
    },
    fetchJson: (url: string) => {
      fetches.push(url)
      return pending instanceof Error ? Promise.reject(pending) : Promise.resolve(pending)
    },
    notify: (title: string, opts: Record<string, unknown> = {}) => {
      toasts.push({ title, opts })
      return Promise.resolve(undefined)
    },
    navigate: (id: string) => {
      navigations.push(id)
      win.location.pathname = `/${id}`
    },
  }
  const setPending = (v: unknown) => {
    pending = v
  }
  return { sdk: sdk as never, toasts, navigations, dismissed, fetches, setPending }
}

const approval = (detail: Record<string, unknown>) => win.dispatchEvent(new CustomEvent(APPROVAL_EVENT, { detail }))
const resolved = (detail: Record<string, unknown> = {}) => win.dispatchEvent(new CustomEvent(RESOLVED_EVENT, { detail }))
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  win.location.pathname = '/overview'
})

test('the built-ins learn the current page from sdk.getPageId, not from the URL themselves', () => {
  // The SDK reads the first path segment, as the shell router does.
  win.location.pathname = '/chat/x'
  assert.equal(getPageId(), 'chat')
  // Whatever the SDK says wins: here the shell reports chat while the URL says overview.
  win.location.pathname = '/overview'
  const { sdk, toasts } = fakeSdk(() => 'chat')
  const stop = listenForApprovals(sdk, true)
  try {
    approval({ id: 'p1', tool_name: 'shell' })
    assert.equal(toasts.length, 0, 'chat shows the gate in the thread')
  } finally {
    stop()
  }
})

test('an approval raises one toast per request, with Review opening the approvals page', () => {
  const { sdk, toasts, navigations } = fakeSdk()
  const stop = listenForApprovals(sdk, true)
  try {
    approval({ id: 'a1', tool_name: 'shell', agent_name: 'Coder', risk_level: 'high' })
    approval({ id: 'a1', tool_name: 'shell' }) // same request: no second toast
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].title, 'Approval needed: shell')
    assert.equal(toasts[0].opts.id, 'aiui-approval-a1')
    assert.equal(toasts[0].opts.type, 'warning')
    const action = toasts[0].opts.action as { label: string; onClick: () => void }
    assert.equal(action.label, 'Review')
    action.onClick()
    assert.deepEqual(navigations, ['approvals'])
  } finally {
    stop()
  }
  approval({ id: 'a2' })
  assert.equal(toasts.length, 1, 'no toast once stopped')
})

test('no toast on the chat page; no Review on the approvals page or without one', () => {
  const { sdk, toasts } = fakeSdk()
  let stop = listenForApprovals(sdk, true)
  try {
    win.location.pathname = '/chat'
    approval({ id: 'c1' })
    assert.equal(toasts.length, 0, 'the React chat shows the gate in the thread')
    win.location.pathname = '/approvals'
    approval({ id: 'c2' })
    assert.equal(toasts.length, 1)
    assert.equal(toasts[0].opts.action, undefined)
  } finally {
    stop()
  }
  stop = listenForApprovals(sdk, false)
  try {
    approval({ id: 'c3' })
    assert.equal(toasts.length, 2)
    assert.equal(toasts[1].opts.action, undefined, 'no approvals page, no Review')
  } finally {
    stop()
  }
})

test('whenPageShown resolves on the matching aiui:page-change only, or on timeout', async () => {
  let done = false
  const p = whenPageShown('chat', 1000).then(() => {
    done = true
  })
  win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'logs' } }))
  await Promise.resolve()
  assert.equal(done, false)
  win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'chat' } }))
  await p
  assert.equal(done, true)
  const started = Date.now()
  await whenPageShown('never', 20)
  assert.ok(Date.now() - started >= 15)
})

test('a decided approval closes its toast; the others stay until they are decided', async () => {
  const { sdk, dismissed, fetches, setPending } = fakeSdk()
  const stop = listenForApprovals(sdk, true)
  try {
    resolved()
    assert.deepEqual(fetches, [], 'no toast on screen: nothing to look up')
    approval({ id: 'a1', tool_name: 'shell' })
    approval({ id: 'a2', tool_name: 'write' })
    // The stream says only that something was decided: a1 is gone from the pending list.
    setPending({ approvals: [{ id: 'a2' }] })
    resolved()
    await settle()
    assert.deepEqual(fetches, ['/api/approvals/pending'])
    assert.deepEqual(dismissed, ['aiui-approval-a1'])
    // A lookup that fails closes nothing.
    setPending(new Error('offline'))
    resolved()
    await settle()
    assert.deepEqual(dismissed, ['aiui-approval-a1'])
    // A resolved event that names its request closes it without a lookup.
    resolved({ id: 'a2' })
    await settle()
    assert.deepEqual(dismissed, ['aiui-approval-a1', 'aiui-approval-a2'])
    assert.equal(fetches.length, 2)
    // a1 is not toasted again if it is announced once more.
    approval({ id: 'a1', tool_name: 'shell' })
    resolved()
    assert.equal(fetches.length, 2, 'every toast is closed: no lookup')
  } finally {
    stop()
  }
  approval({ id: 'a3' })
  resolved({ id: 'a3' })
  assert.equal(dismissed.length, 2, 'stopped: no longer listening')
})

test('New chat: on chat it resets at once; elsewhere it navigates, then resets once chat is shown', async () => {
  const resets: unknown[] = []
  const onSelect = (e: Event) => resets.push((e as CustomEvent<{ sessionId: unknown }>).detail.sessionId)
  win.addEventListener('aiui:session-select', onSelect)
  try {
    const { sdk, navigations } = fakeSdk()
    win.location.pathname = '/chat'
    startNewChat(sdk)
    assert.deepEqual(resets, [null])
    assert.deepEqual(navigations, [])

    win.location.pathname = '/logs'
    startNewChat(sdk)
    assert.deepEqual(navigations, ['chat'])
    assert.deepEqual(resets, [null], 'waits for the chat view to mount')
    win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'chat' } }))
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(resets, [null, null])
  } finally {
    win.removeEventListener('aiui:session-select', onSelect)
  }
})
