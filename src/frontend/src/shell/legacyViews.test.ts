// A custom.js / dashboard-plugin registerView takes priority over a page's
// server handler under the app shell (review r1: Example 29 showed the
// BlockPage fallback "Plugin not loaded").
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { hasLegacyView, subscribeLegacyView, VIEW_REGISTERED_EVENT, watchQueuedRegistrations } from './legacyViews'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  const et = new EventTarget()
  g.addEventListener = et.addEventListener.bind(et)
  g.removeEventListener = et.removeEventListener.bind(et)
  g.dispatchEvent = et.dispatchEvent.bind(et)
}
const w = globalThis as unknown as { aiui?: Record<string, unknown> }

/** The server's custom.js queue stub (server.py _CUSTOM_JS_QUEUE). */
function installQueueStub() {
  const a: Record<string, unknown> = (w.aiui = {})
  a.__queue = []
  a.registerView = (...args: unknown[]) => {
    ;(a.__queue as unknown[]).push(['registerView', args])
  }
  return a
}

afterEach(() => {
  delete w.aiui
})

test('a view queued by custom.js before dashboard.js loads is detected', () => {
  const a = installQueueStub()
  ;(a.registerView as (...x: unknown[]) => void)('custom-view', () => undefined)
  assert.equal(hasLegacyView('custom-view'), true)
  assert.equal(hasLegacyView('other'), false)
})

test('a view in the loaded legacy registry is detected', () => {
  w.aiui = { views: { 'custom-view': { render() {} } } }
  assert.equal(hasLegacyView('custom-view'), true)
  assert.equal(hasLegacyView('toString'), false, 'own keys only')
})

test('a late registration through the stub is announced, so a page on screen switches to it', () => {
  const a = installQueueStub()
  watchQueuedRegistrations()
  watchQueuedRegistrations() // idempotent
  const seen: unknown[] = []
  const on = (e: Event) => seen.push((e as CustomEvent).detail?.pageId)
  window.addEventListener(VIEW_REGISTERED_EVENT, on)
  try {
    ;(a.registerView as (...x: unknown[]) => void)('late-view', () => undefined)
  } finally {
    window.removeEventListener(VIEW_REGISTERED_EVENT, on)
  }
  assert.deepEqual(seen, ['late-view'])
  assert.equal((a.__queue as unknown[]).length, 1, 'still queued for dashboard.js to replay')
  assert.equal(hasLegacyView('late-view'), true)
})

test('the real registry (dashboard.js loaded) is never wrapped by the stub watcher', () => {
  const real = () => undefined
  w.aiui = { views: {}, registerView: real }
  watchQueuedRegistrations()
  assert.equal(w.aiui.registerView, real)
})

test('subscribeLegacyView wraps the stub and reports only registrations of its page', () => {
  const a = installQueueStub()
  let calls = 0
  const off = subscribeLegacyView('mine', () => calls++)
  try {
    const register = a.registerView as (...x: unknown[]) => void
    register('other', () => undefined)
    assert.equal(calls, 0, 'another page id is ignored')
    register('mine', () => undefined)
    assert.equal(calls, 1)
    assert.equal(hasLegacyView('mine'), true)
    window.dispatchEvent(new CustomEvent(VIEW_REGISTERED_EVENT, { detail: {} }))
    assert.equal(calls, 2, 'an event without a page id re-checks every page')
  } finally {
    off()
  }
  ;(a.registerView as (...x: unknown[]) => void)('mine', () => undefined)
  assert.equal(calls, 2, 'unsubscribed')
})
