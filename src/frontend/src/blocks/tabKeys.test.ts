// The tabs block's keyboard model (blocks/tabKeys.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabForKey } from '@/blocks/tabKeys'

test('arrows move and wrap; Home and End jump to the first and last tab', () => {
  assert.equal(tabForKey('ArrowRight', 0, 3), 1)
  assert.equal(tabForKey('ArrowRight', 2, 3), 0)
  assert.equal(tabForKey('ArrowLeft', 0, 3), 2)
  assert.equal(tabForKey('Home', 2, 3), 0)
  assert.equal(tabForKey('End', 0, 3), 2)
})

test('other keys and an empty list are not handled', () => {
  assert.equal(tabForKey('Enter', 1, 3), null)
  assert.equal(tabForKey('a', 1, 3), null)
  assert.equal(tabForKey('Home', 0, 0), null)
})
