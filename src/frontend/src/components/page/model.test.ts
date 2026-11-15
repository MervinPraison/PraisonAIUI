// Page template logic (components/page/model.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countLevels,
  entryMatches,
  filterEntries,
  findCard,
  isStackedBelow,
  logTime,
  monogram,
  moveCard,
  moveSelection,
  normalizeLevel,
  pageRange,
  splitMatches,
  stepGrab,
  stepMatch,
  stepTab,
  type LogLevel,
} from './model'

test('moveSelection clamps to the list and starts at an end', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(moveSelection(ids, 'a', 1), 'b')
  assert.equal(moveSelection(ids, 'c', 1), 'c')
  assert.equal(moveSelection(ids, 'a', -1), 'a')
  assert.equal(moveSelection(ids, null, 1), 'a')
  assert.equal(moveSelection(ids, null, -1), 'c')
  assert.equal(moveSelection(ids, 'gone', 1), 'a')
  assert.equal(moveSelection([], 'a', 1), null)
})

test('pageRange gives "from–to of total" for a page', () => {
  assert.deepEqual(pageRange(1, 8, 42), { from: 1, to: 8, pages: 6 })
  assert.deepEqual(pageRange(6, 8, 42), { from: 41, to: 42, pages: 6 })
  assert.deepEqual(pageRange(99, 8, 42), { from: 41, to: 42, pages: 6 })
  assert.deepEqual(pageRange(1, 8, 0), { from: 0, to: 0, pages: 1 })
})

const cols = [
  { id: 'todo', cards: [{ id: 't1' }, { id: 't2' }] },
  { id: 'doing', cards: [{ id: 'd1' }] },
  { id: 'done', cards: [] as { id: string }[] },
]

test('findCard locates a card', () => {
  assert.deepEqual(findCard(cols, 'd1'), { col: 1, index: 0 })
  assert.equal(findCard(cols, 'nope'), null)
})

test('moveCard moves across and within columns, clamping the index', () => {
  const ids = (c: readonly { cards: readonly { id: string }[] }[]) => c.map((k) => k.cards.map((x) => x.id))
  assert.deepEqual(ids(moveCard(cols, 't1', 'doing', 1)), [['t2'], ['d1', 't1'], []])
  assert.deepEqual(ids(moveCard(cols, 't1', 'done', 99)), [['t2'], ['d1'], ['t1']])
  assert.deepEqual(ids(moveCard(cols, 't1', 'todo', 1)), [['t2', 't1'], ['d1'], []])
  assert.equal(moveCard(cols, 't1', 'todo', 0), cols, 'no move returns the same columns')
  assert.equal(moveCard(cols, 'nope', 'todo', 0), cols)
  assert.equal(moveCard(cols, 't1', 'nowhere', 0), cols)
})

test('stepGrab moves the drop position with the arrows', () => {
  const sizes = [1, 1, 0] // column sizes without the grabbed card
  const g = { cardId: 't1', col: 0, index: 0 }
  assert.deepEqual(stepGrab(g, 'ArrowRight', sizes), { cardId: 't1', col: 1, index: 0 })
  assert.deepEqual(stepGrab(g, 'ArrowDown', sizes), { cardId: 't1', col: 0, index: 1 })
  assert.deepEqual(stepGrab({ ...g, index: 1 }, 'ArrowRight', [1, 1, 0]), { cardId: 't1', col: 1, index: 1 })
  assert.deepEqual(stepGrab({ ...g, col: 1, index: 1 }, 'ArrowRight', sizes), { cardId: 't1', col: 2, index: 0 })
  assert.deepEqual(stepGrab(g, 'ArrowLeft', sizes), g)
  assert.deepEqual(stepGrab(g, 'ArrowUp', sizes), g)
  assert.equal(stepGrab(g, 'x', sizes), g)
})

test('normalizeLevel maps logger spellings', () => {
  assert.equal(normalizeLevel('WARNING'), 'warn')
  assert.equal(normalizeLevel('CRITICAL'), 'error')
  assert.equal(normalizeLevel('err'), 'error')
  assert.equal(normalizeLevel('TRACE'), 'debug')
  assert.equal(normalizeLevel('INFO'), 'info')
  assert.equal(normalizeLevel(undefined), 'info')
})

const lines = [
  { level: 'INFO', source: 'uvicorn', message: 'GET /api 200' },
  { level: 'WARNING', source: 'knowledge', message: 'Embedding failed (text-embedding-3)' },
  { level: 'ERROR', source: 'knowledge', message: 'Embedding failed again' },
  { level: 'DEBUG', source: 'gateway', message: 'ws connected' },
]

test('countLevels and filterEntries', () => {
  assert.deepEqual(countLevels(lines), { debug: 1, info: 1, warn: 1, error: 1 })
  const all = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])
  assert.equal(filterEntries(lines, all, '', false).length, 4)
  assert.equal(filterEntries(lines, new Set<LogLevel>(['error']), '', false).length, 1)
  assert.equal(filterEntries(lines, all, 'embedding', false).length, 4, 'search alone keeps every line')
  assert.equal(filterEntries(lines, all, 'embedding', true).length, 2)
  assert.equal(filterEntries(lines, all, '  ', true).length, 4, 'an empty query filters nothing')
  assert.ok(entryMatches(lines[1], 'KNOWLEDGE'), 'the source matches too')
  assert.ok(!entryMatches(lines[0], ''))
})

test('splitMatches marks every case-insensitive match', () => {
  assert.deepEqual(splitMatches('Embedding failed (text-embedding-3)', 'embedding'), [
    { text: 'Embedding', match: true },
    { text: ' failed (text-', match: false },
    { text: 'embedding', match: true },
    { text: '-3)', match: false },
  ])
  assert.deepEqual(splitMatches('abc', ''), [{ text: 'abc', match: false }])
  assert.deepEqual(splitMatches('abc', 'x'), [{ text: 'abc', match: false }])
  assert.deepEqual(splitMatches('aaa', 'a').length, 3)
})

test('stepMatch wraps', () => {
  assert.equal(stepMatch(-1, 4, 1), 0)
  assert.equal(stepMatch(-1, 4, -1), 3)
  assert.equal(stepMatch(3, 4, 1), 0)
  assert.equal(stepMatch(0, 4, -1), 3)
  assert.equal(stepMatch(0, 0, 1), -1)
})

test('stepTab roves with arrows, Home and End', () => {
  const ids = ['all', 'agents', 'tools']
  assert.equal(stepTab(ids, 'all', 'ArrowRight'), 'agents')
  assert.equal(stepTab(ids, 'all', 'ArrowLeft'), 'tools')
  assert.equal(stepTab(ids, 'agents', 'End'), 'tools')
  assert.equal(stepTab(ids, 'tools', 'Home'), 'all')
  assert.equal(stepTab(ids, 'tools', 'a'), 'tools')
})

test('monogram', () => {
  assert.equal(monogram('GitHub Toolkit'), 'GT')
  assert.equal(monogram('code_reviewer'), 'CR')
  assert.equal(monogram('Slack'), 'SL')
  assert.equal(monogram('  '), '?')
})

test('isStackedBelow: a panel under the table (phone), not beside it', () => {
  const main = { top: 100, bottom: 900 }
  assert.equal(isStackedBelow({ top: 900, bottom: 1300 }, main), true)
  assert.equal(isStackedBelow({ top: 899.7, bottom: 1300 }, main), true, 'sub-pixel slack')
  assert.equal(isStackedBelow({ top: 100, bottom: 700 }, main), false, 'beside the table')
})

test('logTime: a time of day from ISO stamps, epochs and bare times', () => {
  const local = (d: Date, ms = true) => {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    return ms ? `${t}.${p(d.getMilliseconds(), 3)}` : t
  }
  const utc = '2026-11-15T10:00:10Z'
  assert.deepEqual(logTime(utc), { text: local(new Date(utc), false), full: utc })
  // Python isoformat(): microseconds and an offset; milliseconds are kept.
  const py = '2026-11-15T10:00:10.123456+05:30'
  assert.deepEqual(logTime(py), { text: local(new Date('2026-11-15T04:30:10.123Z')), full: py })
  assert.equal(logTime('2026-11-15T10:00:10.5-0800').text, local(new Date('2026-11-15T18:00:10.500Z')))
  // No zone: shown as written. logging's asctime uses a comma.
  assert.deepEqual(logTime('2026-11-15 10:00:10,042'), { text: '10:00:10.042', full: '2026-11-15 10:00:10,042' })
  assert.deepEqual(logTime('2026-11-15T09:05'), { text: '09:05:00', full: '2026-11-15T09:05' })
  // Epoch seconds (float), milliseconds, and as a numeric string.
  const at = Date.UTC(2026, 10, 15, 10, 0, 10, 250)
  assert.deepEqual(logTime(at / 1000), { text: local(new Date(at)), full: '2026-11-15T10:00:10.250Z' })
  assert.deepEqual(logTime(at), { text: local(new Date(at)), full: '2026-11-15T10:00:10.250Z' })
  assert.equal(logTime(String(Math.floor(at / 1000))).text, local(new Date(Math.floor(at / 1000) * 1000), false))
  // A bare time passes through; other text keeps its full value as the title.
  assert.deepEqual(logTime('15:20:31.204'), { text: '15:20:31.204' })
  assert.deepEqual(logTime('Nov 15 10:00:10'), { text: 'Nov 15 10:00:10', full: 'Nov 15 10:00:10' })
  assert.deepEqual(logTime(undefined), { text: '' })
  assert.deepEqual(logTime(''), { text: '' })
  // Every converted form fits the 100px column: at most "HH:MM:SS.mmm".
  for (const v of [utc, py, at, at / 1000, '2026-11-15 10:00:10,042']) assert.ok(logTime(v).text.length <= 12, String(v))
})
