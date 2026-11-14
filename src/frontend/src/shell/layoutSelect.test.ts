import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ShellLayouts } from '@/sdk/manifest'
import {
  layoutFromQuery,
  layoutRender,
  layoutSpec,
  resetLayoutSeedForTests,
  seedLayoutPreview,
  selectLayout,
} from './layoutSelect'

const spec = (id: string) => ({ id, title: id, source: 'builtin' })
const offered = (over: Partial<ShellLayouts> = {}): ShellLayouts => ({
  default: 'alpha',
  userChoice: true,
  available: [spec('alpha'), spec('beta'), spec('gamma')],
  ...over,
})
const none = { preview: null, choice: null }

test('no layouts key, or none offered, is the classic frame', () => {
  assert.equal(selectLayout(undefined, { preview: 'alpha', choice: 'alpha' }), '')
  assert.equal(selectLayout(offered({ available: [] }), { preview: 'alpha', choice: 'alpha' }), '')
})

test('the server default applies when nothing is stored', () => {
  assert.equal(selectLayout(offered(), none), 'alpha')
  assert.equal(selectLayout(offered({ default: '' }), none), '')
})

test('the tab preview beats the stored choice, which beats the default', () => {
  assert.equal(selectLayout(offered(), { preview: 'gamma', choice: 'beta' }), 'gamma')
  assert.equal(selectLayout(offered(), { preview: null, choice: 'beta' }), 'beta')
  // '' (classic) is a real choice at every level
  assert.equal(selectLayout(offered(), { preview: '', choice: 'beta' }), '')
  assert.equal(selectLayout(offered(), { preview: null, choice: '' }), '')
})

test('the stored choice counts only when the server allows a user choice', () => {
  assert.equal(selectLayout(offered({ userChoice: false }), { preview: null, choice: 'beta' }), 'alpha')
  // a preview (?layout=) still works: screenshots and support links
  assert.equal(selectLayout(offered({ userChoice: false }), { preview: 'gamma', choice: 'beta' }), 'gamma')
})

test('ids the server does not offer fall through to the next candidate, then classic', () => {
  assert.equal(selectLayout(offered(), { preview: 'gone', choice: 'beta' }), 'beta')
  assert.equal(selectLayout(offered(), { preview: 'gone', choice: 'gone' }), 'alpha')
  assert.equal(selectLayout(offered({ default: 'gone' }), { preview: 'gone', choice: 'gone' }), '')
})

test('layoutSpec finds the offered entry', () => {
  assert.equal(layoutSpec(offered(), 'beta')?.id, 'beta')
  assert.equal(layoutSpec(offered(), ''), undefined)
  assert.equal(layoutSpec(undefined, 'beta'), undefined)
})

test('?layout= is read as a layout id, classic as the classic frame, junk as nothing', () => {
  assert.equal(layoutFromQuery('?layout=beta&x=1'), 'beta')
  assert.equal(layoutFromQuery('?layout=classic'), '')
  assert.equal(layoutFromQuery('?layout='), '')
  assert.equal(layoutFromQuery('?layout=Bad_Id'), null)
  assert.equal(layoutFromQuery('?x=1'), null)
  assert.equal(layoutFromQuery(''), null)
})

test('the ?layout= preview is copied into sessionStorage once per page load', () => {
  resetLayoutSeedForTests()
  const writes: [string, string][] = []
  const storage = { setItem: (k: string, v: string) => void writes.push([k, v]) }
  seedLayoutPreview('?layout=beta', storage)
  seedLayoutPreview('?layout=gamma', storage) // a later navigation does not re-seed
  assert.deepEqual(writes, [['aiui-layout-preview', 'beta']])

  resetLayoutSeedForTests()
  writes.length = 0
  seedLayoutPreview('?layout=classic', storage)
  assert.deepEqual(writes, [['aiui-layout-preview', 'classic']])

  resetLayoutSeedForTests()
  writes.length = 0
  seedLayoutPreview('?other=1', storage)
  seedLayoutPreview('?layout=beta', storage)
  assert.deepEqual(writes, [], 'no ?layout= on load: nothing is seeded later either')
})

test('blocked storage never breaks the seed', () => {
  resetLayoutSeedForTests()
  assert.doesNotThrow(() =>
    seedLayoutPreview('?layout=beta', {
      setItem: () => {
        throw new Error('SecurityError')
      },
    }),
  )
})

test('render: classic, the frame, or a skeleton while plugins may still register it', () => {
  assert.equal(layoutRender('', false, false), 'classic')
  assert.equal(layoutRender('alpha', true, false), 'layout')
  assert.equal(layoutRender('alpha', false, false), 'pending')
  assert.equal(layoutRender('alpha', false, true), 'classic')
})
