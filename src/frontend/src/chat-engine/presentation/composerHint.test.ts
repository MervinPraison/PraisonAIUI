// The composer's key hint inside a layout retires after three live sends.
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { HINT_KEY, HINT_SENDS, hintOff, isSendGesture, noteSend, readSends } from './composerHint'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

test('a send is Enter with text (not Shift+Enter, not composing) or an enabled Send press', () => {
  assert.equal(isSendGesture({ type: 'keydown', key: 'Enter' }, 'hi', false), true)
  assert.equal(isSendGesture({ type: 'keydown', key: 'Enter', shiftKey: true }, 'hi', false), false)
  assert.equal(isSendGesture({ type: 'keydown', key: 'Enter', isComposing: true }, 'hi', false), false)
  assert.equal(isSendGesture({ type: 'keydown', key: 'Enter' }, '  ', false), false, 'nothing to send')
  assert.equal(isSendGesture({ type: 'keydown', key: 'a' }, 'hi', false), false)
  assert.equal(isSendGesture({ type: 'click' }, '', true), true)
  assert.equal(isSendGesture({ type: 'click' }, 'hi', false), false)
})
test('three sends retire the hint; storage failures keep it', () => {
  assert.equal(readSends(), 0)
  for (let i = 1; i <= HINT_SENDS; i++) assert.equal(noteSend(), i)
  assert.equal(store.get(HINT_KEY), String(HINT_SENDS))
  assert.ok(hintOff(readSends()))
  assert.ok(!hintOff(HINT_SENDS - 1))
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
  assert.equal(readSends(), 0)
  assert.equal(noteSend(), 1)
})
