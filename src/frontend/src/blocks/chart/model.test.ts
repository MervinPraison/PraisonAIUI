// The chart block's data model (blocks/chart/model.ts): formats, inference, bins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartKind, formatValue, histogram, isBelowReference, MAX_ROWS, references, seriesColor, toChartSpec, truncate } from '@/blocks/chart/model'

test('formats: number, compact, percent, multiplier, duration', () => {
  const cases: [unknown, Parameters<typeof formatValue>[1], string][] = [
    [1234567.891, 'number', '1,234,567.89'],
    [1234, 'compact', '1.2k'],
    [2_500_000, 'compact', '2.5M'],
    [3e9, 'compact', '3B'],
    [-1500, 'compact', '-1.5k'],
    [0.456, 'compact', '0.46'],
    ['12', 'compact', '12'],
    [0.25, 'percent', '25%'],
    [0.025, 'percent', '2.5%'],
    [1.5, 'multiplier', '1.5x'],
    [2, 'multiplier', '2x'],
    [45, 'duration', '45s'],
    [65, 'duration', '1:05'],
    [3725, 'duration', '1:02:05'],
    ['Jan', 'number', 'Jan'],
    [null, 'number', ''],
  ]
  for (const [v, fmt, want] of cases) assert.equal(formatValue(v, fmt), want, `${String(v)} as ${fmt}`)
})

test('kinds, aliases and references', () => {
  assert.deepEqual(['line', 'hbar', 'column', 'doughnut', 'sankey', undefined].map(chartKind), ['line', 'barh', 'bar', 'donut', 'bar', 'bar'])
  assert.deepEqual(references(1), [{ value: 1 }])
  assert.deepEqual(references([1, '2', 'x']), [{ value: 1 }, { value: 2 }])
  assert.deepEqual(references([{ value: 1, label: 'usual' }, { label: 'no value' }]), [{ value: 1, label: 'usual' }])
  assert.deepEqual(references(undefined), [])
})

test('the legacy dict draws: x is the text column, y the numeric ones', () => {
  const spec = toChartSpec({ title: 'Tasks', data: [{ name: 'Researcher', value: 15 }, { name: 'Writer', value: '8' }], chart_type: 'bar' })
  assert.equal(spec.x, 'name')
  assert.deepEqual(spec.series.map((s) => s.key), ['value'])
  assert.equal(spec.rows[1].value, 8, 'numeric strings become numbers')
  assert.equal(spec.legend, false, 'one series: no legend')
  assert.equal(spec.height, 240)
})

test('explicit keys, labels, y2, reference and formats', () => {
  const spec = toChartSpec({
    chart_type: 'line',
    data: [{ month: 'Jan', views: 1000, posts: 3 }, { month: 'Feb', views: 'n/a', posts: 5 }],
    x: 'month', y: ['views'], y2: 'posts', labels: { views: 'Usual views', posts: 'Posts' },
    reference: [{ value: 900, label: 'target' }], y_format: 'compact', y_domain: [0, 2000],
  })
  assert.deepEqual(spec.series, [{ key: 'views', label: 'Usual views', color: 'var(--chart-1)' }])
  assert.equal(spec.y2?.label, 'Posts')
  assert.equal(spec.rows[1].views, null, 'a non-number is a gap')
  assert.deepEqual(spec.references, [{ value: 900, label: 'target' }])
  assert.deepEqual([spec.yFormat, spec.yDomain, spec.legend], ['compact', [0, 2000], true])
})

test('stacking, pie, heights, row cap and scatter inference', () => {
  assert.equal(toChartSpec({ data: [{ a: 'x', b: 1 }], stacked: true }).stacked, false, 'stacking needs two series')
  assert.equal(toChartSpec({ data: [{ a: 'x', b: 1, c: 2 }], stacked: true }).stacked, true)
  const pie = toChartSpec({ chart_type: 'donut', data: [{ src: 'Search', n: 5, m: 1 }], reference: 1 })
  assert.deepEqual([pie.series.map((s) => s.key), pie.references, pie.legend], [['n'], [], true])
  const rows = Array.from({ length: 10 }, (_, i) => ({ label: `r${i}`, v: i }))
  assert.equal(toChartSpec({ chart_type: 'barh', data: rows }).height, 10 * 28 + 32)
  assert.equal(toChartSpec({ data: rows, height: 5 }).height, 80)
  const many = Array.from({ length: MAX_ROWS + 10 }, (_, i) => ({ k: String(i), v: i }))
  assert.equal(toChartSpec({ data: many }).rows.length, MAX_ROWS)
  const sc = toChartSpec({ chart_type: 'scatter', data: [{ name: 'A', subs: 100, ratio: 2 }], label: 'name' })
  assert.deepEqual([sc.x, sc.series.map((s) => s.key), sc.label], ['subs', ['ratio'], 'name'])
})

test('histogram: bins counted in the browser', () => {
  const spec = toChartSpec({ chart_type: 'histogram', data: [1, 2, 2, 3, 4, 10].map((value) => ({ value })), x: 'value', bins: 3 })
  assert.equal(spec.x, 'bin')
  assert.deepEqual(spec.series.map((s) => [s.key, s.label]), [['count', 'Count']])
  assert.deepEqual(spec.rows.map((r) => r.count), [4, 1, 1])
  assert.equal(spec.rows[0].bin, '1–4')
  assert.equal(histogram(Array.from({ length: 100 }, (_, i) => i)).length, 8, "Sturges' rule")
  assert.deepEqual(histogram([0, 5, 10], 2).map((x) => x.count), [1, 2], 'max lands in the last bin')
  assert.deepEqual(histogram([3, 3, 3]), [{ start: 3, end: 3, count: 3 }])
  assert.deepEqual(histogram([]), [])
  assert.equal(histogram([1, 2, 3], 500).length, 30, 'at most 30 bins')
})

test('colour by reference, palette and truncation', () => {
  const spec = { references: [{ value: 1 }], colorByReference: true }
  assert.deepEqual([isBelowReference(0.5, spec), isBelowReference(1, spec), isBelowReference(0.5, { ...spec, colorByReference: false })], [true, false, false])
  assert.equal(seriesColor(0), 'var(--chart-1)')
  assert.equal(seriesColor(4), 'var(--chart-5)')
  assert.match(seriesColor(5), /^color-mix\(in oklab, var\(--chart-1\)/)
  assert.deepEqual([truncate('Wednesday', 5), truncate('Mon', 5)], ['Wedn…', 'Mon'])
})
