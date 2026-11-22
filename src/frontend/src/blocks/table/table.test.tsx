// The `table` block: format helpers, numeric-aware stable sorting, search,
// paging defaults and what the block renders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { TableBlock } from './DataTable'
import {
  cellText,
  compareValues,
  filterIndexes,
  formatDate,
  formatNumber,
  inferColumns,
  nextSort,
  pageSizeOf,
  sortIndexes,
  sortValue,
  toColumns,
} from './model'

const html = (props: Record<string, unknown>) => renderMarkup(<TableBlock node={{ type: 'table', props }} />).split('<!-- -->').join('')
const [TEXT] = toColumns(['Name'], [])

test('formatNumber: compact, percent, multiplier, fixed and the default', () => {
  assert.equal(formatNumber(950, 'compact'), '950')
  assert.equal(formatNumber(1234, 'compact'), '1.2k')
  assert.equal(formatNumber(1000, 'compact'), '1k')
  assert.equal(formatNumber(3_400_000, 'compact'), '3.4M')
  assert.equal(formatNumber(999_950, 'compact'), '1M')
  assert.equal(formatNumber(-2_500, 'compact'), '-2.5k')
  assert.equal(formatNumber(0.123, 'percent'), '12.3%')
  assert.equal(formatNumber(0.5, 'percent', 0), '50%')
  assert.equal(formatNumber(2.345, 'multiplier'), '2.3x')
  assert.equal(formatNumber(2, 'x'), '2x')
  assert.equal(formatNumber(3.14159, 'fixed'), '3.14')
  assert.equal(formatNumber(3, 'fixed', 1), '3.0')
  assert.equal(formatNumber(1234567.891), '1,234,567.89')
  assert.equal(formatNumber('42'), '42')
  assert.equal(formatNumber('n/a', 'compact'), 'n/a')
})

test('formatDate: date-only strings stay on their day; seconds or ms; iso', () => {
  assert.equal(formatDate('2026-11-22'), 'Nov 22, 2026')
  assert.equal(formatDate('2026-11-22', 'iso'), '2026-11-22')
  assert.equal(formatDate(Date.UTC(2026, 0, 2, 15, 4) / 1000, 'datetime'), 'Jan 2, 2026, 15:04')
  assert.equal(formatDate(Date.UTC(2026, 0, 2)), 'Jan 2, 2026')
  assert.equal(formatDate('soon'), 'soon')
})

test('cellText: auto numbers stay as sent, number columns format, records show their text', () => {
  const [views] = toColumns([{ key: 'v', type: 'number', format: 'compact' }], [])
  assert.equal(cellText(2024, TEXT), '2024')
  assert.equal(cellText(1200, views), '1.2k')
  assert.equal(cellText({ text: 'Open', href: '/x' }, TEXT), 'Open')
  assert.equal(cellText({ a: 1 }, TEXT), '{"a":1}')
  assert.equal(cellText(['ai', 'news'], TEXT), 'ai, news')
  assert.equal(cellText(null, TEXT), '')
})

test('toColumns: headers, labels, types, alignment and sortable', () => {
  const cols = toColumns(
    ['Name', { key: 'subs', label: 'Subscribers', type: 'number', width: 120 }, { key: 'pic', type: 'image' }, { key: 'x', type: 'bogus', align: 'end', sortable: false }],
    [],
  )
  assert.deepEqual(
    cols.map((c) => [c.key, c.label, c.type, c.align, c.sortable, c.width]),
    [
      ['Name', 'Name', 'auto', 'left', true, undefined],
      ['subs', 'Subscribers', 'number', 'right', true, '120px'],
      ['pic', 'pic', 'image', 'left', false, undefined],
      ['x', 'x', 'auto', 'right', false, undefined],
    ],
  )
  assert.equal(toColumns(null, ['A', 'B']).length, 2)
  assert.equal(toColumns(null, ['A'], false)[0].sortable, false)
  // An auto column of numbers lines up at the end.
  const inferred = inferColumns(toColumns(null, ['A', 'B']), [[1, 'x'], [null, 'y'], [3, 'z']])
  assert.deepEqual(inferred.map((c) => c.align), ['right', 'left'])
})

test('sortValue: numeric-aware text, dates, records', () => {
  assert.equal(sortValue('1,234', TEXT), 1234)
  assert.equal(sortValue('1.2k', TEXT), 1200)
  assert.equal(sortValue('3.4M', TEXT), 3_400_000)
  assert.equal(sortValue('$12', TEXT), 12)
  assert.equal(sortValue('-5', TEXT), -5)
  assert.equal(sortValue('12%', TEXT), 12)
  assert.equal(sortValue('2.5x', TEXT), 2.5)
  assert.equal(sortValue('Hello', TEXT), 'hello')
  assert.equal(sortValue('', TEXT), null)
  assert.equal(sortValue({ text: 'B', href: '/b' }, TEXT), 'b')
  const [date] = toColumns([{ key: 'd', type: 'date' }], [])
  assert.equal(sortValue('2026-01-02', date), Date.UTC(2026, 0, 2))
})

test('sorting is stable, numbers before text, empty cells last in both directions', () => {
  const values = [3, null, 'b', 1, 3, 'a']
  assert.deepEqual(sortIndexes(values, 'asc'), [3, 0, 4, 5, 2, 1])
  assert.deepEqual(sortIndexes(values, 'desc'), [2, 5, 0, 4, 3, 1])
  assert.equal(compareValues('item 2', 'item 10'), -1)
  // Sorting a filtered subset keeps only those rows.
  assert.deepEqual(sortIndexes(values, 'asc', [0, 5, 3]), [3, 0, 5])
})

test('nextSort cycles ascending, descending, off', () => {
  const a = nextSort(null, 2)
  assert.deepEqual(a, { col: 2, dir: 'asc' })
  const d = nextSort(a, 2)
  assert.deepEqual(d, { col: 2, dir: 'desc' })
  assert.equal(nextSort(d, 2), null)
  assert.deepEqual(nextSort(d, 0), { col: 0, dir: 'asc' })
})

test('filterIndexes matches every word, case-insensitive', () => {
  const texts = ['alpha news 12', 'beta ai', 'alpha ai']
  assert.deepEqual(filterIndexes(texts, ''), [0, 1, 2])
  assert.deepEqual(filterIndexes(texts, 'ALPHA'), [0, 2])
  assert.deepEqual(filterIndexes(texts, 'ai  alpha'), [2])
  assert.deepEqual(filterIndexes(texts, 'zzz'), [])
})

test('pageSizeOf: explicit, off, and 50 past 100 rows', () => {
  assert.equal(pageSizeOf(undefined, 100), 0)
  assert.equal(pageSizeOf(undefined, 1095), 50)
  assert.equal(pageSizeOf(25, 10), 25)
  assert.equal(pageSizeOf(0, 1095), 0)
  assert.equal(pageSizeOf(false, 1095), 0)
})

test('TableBlock: the old shape renders with sortable headers', () => {
  const out = html({ headers: ['Agent', 'Tasks'], rows: [['Researcher', 15], ['Writer', 8]] })
  assert.match(out, /<th scope="col" aria-sort="none"[^>]*><button type="button"[^>]*>Agent/)
  assert.match(out, />Researcher</)
  assert.match(out, /text-right[^"]*">15</)
  assert.doesNotMatch(out, /Search/)
})

test('TableBlock: typed cells render safely', () => {
  const out = html({
    columns: [
      { key: 'name', type: 'link' },
      { key: 'status', type: 'badge', tones: { live: 'success' } },
      { key: 'pic', type: 'image' },
      { key: 'done', type: 'progress' },
      { key: 'views', type: 'number', format: 'compact' },
    ],
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

test('TableBlock: rows with a detail drawer are keyboard reachable', () => {
  const out = html({ headers: ['Name'], rows: [['a']], row_detail: true })
  assert.match(out, /<tr tabindex="0" class="cursor-pointer/)
})
