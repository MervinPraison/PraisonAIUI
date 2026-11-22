// The `table` block: format helpers, numeric-aware stable sorting, search,
// paging defaults and what the block renders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { TableBlock } from './DataTable'
import { cellText, compareValues, filterIndexes, formatNumber, inferColumns, nextSort, pageSizeOf, sortIndexes, sortValue, toColumns } from './model'

const html = (props: Record<string, unknown>) => renderMarkup(<TableBlock node={{ type: 'table', props }} />).split('<!-- -->').join('')
const [TEXT] = toColumns(['Name'], [])
const cases = (f: (...a: never[]) => unknown, rows: [unknown[], unknown][]) => {
  for (const [args, want] of rows) assert.deepEqual(f(...(args as never[])), want, JSON.stringify(args))
}

test('formatNumber: compact, percent, multiplier, fixed and the default', () => {
  cases(formatNumber, [
    [[950, 'compact'], '950'], [[1234, 'compact'], '1.2k'], [[1000, 'compact'], '1k'], [[3_400_000, 'compact'], '3.4M'],
    [[999_950, 'compact'], '1M'], [[-2_500, 'compact'], '-2.5k'], [[0.123, 'percent'], '12.3%'], [[0.5, 'percent', 0], '50%'],
    [[2.345, 'multiplier'], '2.3x'], [[2, 'x'], '2x'], [[3.14159, 'fixed'], '3.14'], [[3, 'fixed', 1], '3.0'],
    [[1234567.891], '1,234,567.89'], [['42'], '42'], [['n/a', 'compact'], 'n/a'],
  ])
})

test('cellText: auto numbers stay as sent, number columns format, records show their text', () => {
  const [views] = toColumns([{ key: 'v', type: 'number', format: 'compact' }], [])
  assert.deepEqual(
    [cellText(2024, TEXT), cellText(1200, views), cellText({ text: 'Open', href: '/x' }, TEXT), cellText({ a: 1 }, TEXT), cellText(['ai', 'news'], TEXT), cellText(null, TEXT)],
    ['2024', '1.2k', 'Open', '{"a":1}', 'ai, news', ''],
  )
})

test('toColumns: headers, labels, types, alignment, sortable; auto numbers align right', () => {
  const cols = toColumns(['Name', { key: 'subs', label: 'Subs', type: 'number', width: 120 }, { key: 'pic', type: 'image' }, { key: 'x', type: 'bogus', align: 'end', sortable: false }], [])
  assert.deepEqual(
    cols.map((c) => [c.key, c.label, c.type, c.align, c.sortable, c.width]),
    [['Name', 'Name', 'auto', 'left', true, undefined], ['subs', 'Subs', 'number', 'right', true, '120px'], ['pic', 'pic', 'image', 'left', false, undefined], ['x', 'x', 'auto', 'right', false, undefined]],
  )
  assert.equal(toColumns(null, ['A'], false)[0].sortable, false)
  assert.deepEqual(inferColumns(toColumns(null, ['A', 'B']), [[1, 'x'], [null, 'y'], [3, 'z']]).map((c) => c.align), ['right', 'left'])
})

test('sortValue: numeric-aware text and records', () => {
  cases((v: unknown) => sortValue(v, TEXT), [
    [['1,234'], 1234], [['1.2k'], 1200], [['3.4M'], 3_400_000], [['$12'], 12], [['-5'], -5], [['12%'], 12],
    [['2.5x'], 2.5], [['Hello'], 'hello'], [[''], null], [[{ text: 'B', href: '/b' }], 'b'],
  ])
})

test('sorting is stable, numbers before text, empty cells last; header clicks cycle', () => {
  const values = [3, null, 'b', 1, 3, 'a']
  assert.deepEqual(sortIndexes(values, 'asc'), [3, 0, 4, 5, 2, 1])
  assert.deepEqual(sortIndexes(values, 'desc'), [2, 5, 0, 4, 3, 1])
  assert.deepEqual(sortIndexes(values, 'asc', [0, 5, 3]), [3, 0, 5])
  assert.equal(compareValues('item 2', 'item 10'), -1)
  const a = nextSort(null, 2)
  assert.deepEqual([a, nextSort(a, 2), nextSort(nextSort(a, 2), 2), nextSort(a, 0)], [{ col: 2, dir: 'asc' }, { col: 2, dir: 'desc' }, null, { col: 0, dir: 'asc' }])
})

test('search matches every word; page size is explicit, off, or 50 past 100 rows', () => {
  const texts = ['alpha news 12', 'beta ai', 'alpha ai']
  assert.deepEqual([filterIndexes(texts, ''), filterIndexes(texts, 'ALPHA'), filterIndexes(texts, 'ai  alpha'), filterIndexes(texts, 'zzz')], [[0, 1, 2], [0, 2], [2], []])
  assert.deepEqual([pageSizeOf(undefined, 100), pageSizeOf(undefined, 1095), pageSizeOf(25, 10), pageSizeOf(0, 1095), pageSizeOf(false, 1095)], [0, 50, 25, 0, 0])
})

test('TableBlock: the old shape renders with sortable headers', () => {
  const out = html({ headers: ['Agent', 'Tasks'], rows: [['Researcher', 15], ['Writer', 8]] })
  assert.match(out, /<th scope="col" aria-sort="none"[^>]*><button type="button"[^>]*>Agent/)
  assert.match(out, /text-right[^"]*">15</)
  assert.doesNotMatch(out, /Search/)
})

test('TableBlock: typed cells render safely', () => {
  const out = html({
    columns: [{ key: 'name', type: 'link' }, { key: 's', type: 'badge', tones: { live: 'success' } }, { key: 'pic', type: 'image' }, { key: 'done', type: 'progress' }, { key: 'v', type: 'number', format: 'compact' }],
    rows: [
      [{ text: 'Chan', href: '/c/1' }, 'live', 'https://img.example/x.png', 0.42, 12500],
      [{ text: 'Bad', href: 'javascript:alert(1)' }, 'off', 'javascript:1', 2, null],
    ],
  })
  assert.match(out, /<a href="\/c\/1"[^>]*>Chan<\/a>/)
  assert.doesNotMatch(out, /javascript:/)
  assert.match(out, /bg-success\/10[^"]*">live</)
  assert.match(out, /<img src="https:\/\/img.example\/x.png" alt="pic" loading="lazy"/)
  assert.match(out, /role="progressbar"[^>]*aria-label="done 42%"/)
  assert.match(out, />100%</)
  assert.match(out, />12.5k</)
})

test('TableBlock: search box, 50-row pages for 1,100 rows, row links', () => {
  const rows = Array.from({ length: 1100 }, (_, i) => [`Channel ${i}`, i])
  const out = html({ headers: ['Name', 'Subs'], rows, searchable: true, caption: 'Channels', row_hrefs: rows.map((_, i) => `/c/${i}`) })
  assert.match(out, /aria-label="Search Channels"/)
  assert.match(out, /1100 rows/)
  assert.equal((out.match(/<tr /g) ?? []).length, 50)
  assert.match(out, /1–50 of 1100/)
  assert.match(out, /aria-label="Next page"/)
  assert.match(out, /<a href="\/c\/0"[^>]*>Channel 0<\/a>/)
})
