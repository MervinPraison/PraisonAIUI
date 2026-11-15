// The composer's key hint inside a layout retires after three live sends.
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { HINT_KEY, HINT_SENDS, hintOff, isLiveSend, noteSend, readSends } from './composerHint'

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

test('a live send is one more user message while running or with the user message last', () => {
  assert.equal(isLiveSend(2, 3, true), true)
  assert.equal(isLiveSend(2, 3, false, true), true)
  assert.equal(isLiveSend(2, 3, false, false), false, 'a history page that ends with an answer')
  assert.equal(isLiveSend(0, 4, true), false, 'a history load is not a send')
  assert.equal(isLiveSend(3, 3, true), false)
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
