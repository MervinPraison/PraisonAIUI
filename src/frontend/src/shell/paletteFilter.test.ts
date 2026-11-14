// ⌘K ranking (review r1: typing "log" + Enter opened Knowledge, not Logs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paletteFilter, rankSections } from './paletteFilter'

const pages = [
  ['Chat', 'chat'], ['Knowledge', 'knowledge'], ['Memory', 'memory'], ['Channel Inbox', 'inbox'],
  ['Overview', 'overview'], ['Logs', 'logs'], ['Config', 'config'], ['Usage', 'usage'], ['Login settings', 'auth'],
]

function rank(search: string): string[] {
  return pages
    .map(([title, id]) => ({ id, score: paletteFilter(`${title} ${id}`, search, [id, 'Settings']) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id)
}

test('a title prefix beats a fuzzy match: "log" opens Logs', () => {
  assert.equal(rank('log')[0], 'logs')
  assert.ok(rank('log').indexOf('knowledge') > rank('log').indexOf('logs'))
})

test('a word inside the title beats a fuzzy match', () => {
  assert.equal(rank('inbox')[0], 'inbox')
  assert.equal(rank('box')[0], 'inbox', 'substring')
})

test('an empty query keeps everything; nonsense matches nothing', () => {
  assert.equal(rank('').length, pages.length)
  assert.deepEqual(rank('zzzq'), [])
})

test('keywords count only as word prefixes, below title matches', () => {
  assert.equal(paletteFilter('Usage usage', 'settings', ['usage', 'Settings']), 0.5)
  assert.ok(paletteFilter('Usage usage', 'us', ['usage']) > 0.5)
})

test('groups are ordered by their best match, so Enter picks Logs (cmdk does not order groups)', () => {
  const section = (key: string, titles: string[]) => ({
    key,
    heading: key,
    items: titles.map((t) => ({ key: t, value: `${t} ${t.toLowerCase()}`, keywords: [key], node: null })),
  })
  const sections = [section('Agent', ['Chat', 'Knowledge']), section('Work', ['Work Hub']), section('Settings', ['Config', 'Logs'])]
  assert.deepEqual(rankSections(sections, 'log').map((s) => s.key), ['Settings', 'Agent', 'Work'])
  assert.deepEqual(rankSections(sections, '').map((s) => s.key), ['Agent', 'Work', 'Settings'], 'no query: sidebar order')
})
