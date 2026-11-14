// npm test -- chat-engine/register
// registerChatPage(): lazy page registration + buffering of the window events
// other pages dispatch before the chat chunk has loaded.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'

const g = globalThis as { window?: unknown }
g.window ??= new EventTarget()
const win = g.window as EventTarget

const { getPage, registerPage } = await import('@/sdk/registry')
const { registerChatPage, takePendingPrefill, takePendingSessionSelect } = await import('./register')

test('registers a lazy chat page (the engine is not imported eagerly)', () => {
  const warn = mock.method(console, 'warn', () => {})
  try {
    registerChatPage()
    const first = getPage('chat')
    registerChatPage() // idempotent
    assert.ok(first, 'chat page is registered')
    assert.equal(getPage('chat'), first, 'the second call keeps the registration')
    assert.equal(warn.mock.callCount(), 0, 'no "replaces an earlier registration" warning')
  } finally {
    warn.mock.restore()
  }
})

test('takes the id back when something else registered it since', () => {
  const warn = mock.method(console, 'warn', () => {})
  try {
    registerChatPage('chat-reclaim')
    const ours = getPage('chat-reclaim')
    registerPage('chat-reclaim', () => null)
    assert.notEqual(getPage('chat-reclaim'), ours)
    registerChatPage('chat-reclaim')
    assert.notEqual(getPage('chat-reclaim'), undefined)
    registerChatPage('chat-reclaim')
    assert.equal(warn.mock.callCount(), 2, 'one warning per real replacement, none for the repeat')
  } finally {
    warn.mock.restore()
  }
})

test('buffers the last prefill / session-select until the chat page takes it', () => {
  win.dispatchEvent(new CustomEvent('aiui:prefill-composer', { detail: { text: 'first' } }))
  win.dispatchEvent(new CustomEvent('aiui:prefill-composer', { detail: { text: 'review this code' } }))
  win.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: 'S42' } }))
  win.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: 7 } })) // ignored: not a string
  assert.equal(takePendingPrefill(), 'review this code')
  assert.equal(takePendingPrefill(), null, 'taken once')
  assert.equal(takePendingSessionSelect(), 'S42')
  assert.equal(takePendingSessionSelect(), null)
})

test('a stale buffered event (over 30 s old) is not replayed', () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  try {
    win.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: 'old' } }))
    mock.timers.tick(30_001)
    assert.equal(takePendingSessionSelect(), null)
  } finally {
    mock.timers.reset()
  }
})
