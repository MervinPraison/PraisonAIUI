// The chart block's data model (blocks/chart/model.ts): formats, inference, bins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellKey, chartKind, facetSpecs, formatValue, heatColor, heatGrid, heatT, histogram, isBelowReference, MAX_FACETS, MAX_ROWS, references, seriesColor, sharedDomain, toChartSpec, truncate } from '@/blocks/chart/model'
import { benchmarkText, MAX_SPARK_POINTS, sparkPath, sparkValues } from '@/blocks/chart/spark'

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

test('heatmap: keys, grid order, sums, theme scale', () => {
  const spec = toChartSpec({ chart_type: 'heatmap', data: [
    { d: 'Mon', h: 9, n: 2 }, { d: 'Tue', h: 9, n: '4' }, { d: 'Mon', h: 10, n: 1 }, { d: 'Mon', h: 9, n: 1 }, { d: 'Wed', h: 11 },
  ], x: 'h', y: 'd', value: 'n' })
  assert.deepEqual([spec.x, spec.row, spec.series.map((s) => s.key), spec.legend, spec.references], ['h', 'd', ['n'], true, []])
  const g = heatGrid(spec)
  assert.deepEqual([g.cols, g.rows, g.min, g.max], [['9', '10', '11'], ['Mon', 'Tue', 'Wed'], 1, 4])
  assert.equal(g.cells.get(cellKey('Mon', '9')), 3, 'a repeated cell sums')
  assert.equal(g.cells.has(cellKey('Wed', '11')), false, 'no value: an empty cell')
  assert.equal(toChartSpec({ chart_type: 'heatmap', data: [{ x: 1, y: 'a', value: 2 }] }).row, 'y', 'default keys x, y, value')
  assert.match(heatColor(0), /^color-mix\(in oklab, var\(--chart-1\) 12%, var\(--muted\)\)$/)
  assert.equal(heatColor(1), 'color-mix(in oklab, var(--chart-1) 100%, var(--muted))')
  assert.deepEqual([heatT(1, g), heatT(4, g)], [0, 1])
})

test('sparkline kind: one series, no legend, small height; plain numbers', () => {
  const s = toChartSpec({ chart_type: 'sparkline', data: [{ value: 1 }, { value: 3 }] })
  assert.deepEqual([s.series.map((x) => x.key), s.legend, s.height], [['value'], false, 48])
  assert.equal(chartKind('spark'), 'sparkline')
})

test('facets: one spec per value, shared domain, facet key never plotted', () => {
  const data = [
    { platform: 'A', month: 'Jan', views: 10 }, { platform: 'B', month: 'Jan', views: 40 }, { platform: 'A', month: 'Feb', views: 20 },
  ]
  const f = facetSpecs({ chart_type: 'bar', data, facet: 'platform' })
  assert.deepEqual(f.map((x) => [x.label, x.spec.rows.length, x.spec.x, x.spec.height]), [['A', 2, 'month', 160], ['B', 1, 'month', 160]])
  assert.deepEqual(f.map((x) => x.spec.yDomain), [[0, 40], [0, 40]], 'bars share a zero-based domain')
  assert.deepEqual(facetSpecs({ data }), [], 'no facet key: no panels')
  assert.deepEqual(facetSpecs({ data, facet: 'platform', y_domain: [0, 100] })[1].spec.yDomain, [0, 100])
  assert.deepEqual(sharedDomain([toChartSpec({ chart_type: 'line', data: [{ m: 'a', v: 5 }, { m: 'b', v: 7 }] })]), [5, 7])
  const many = Array.from({ length: MAX_FACETS + 5 }, (_, i) => ({ k: String(i), m: 'a', v: i }))
  assert.equal(facetSpecs({ data: many, facet: 'k' }).length, MAX_FACETS)
})

test('sparkline path and benchmark text', () => {
  assert.equal(sparkPath([0, 10], 100, 20), 'M0 18L100 2')
  assert.equal(sparkPath([5], 100, 20), 'M0 10L100 10', 'one point: a flat line')
  assert.equal(sparkPath([], 100, 20), '')
  assert.deepEqual(sparkValues([1, '2', 'x', null, Infinity]), [1, 2])
  assert.equal(sparkValues(Array.from({ length: MAX_SPARK_POINTS + 9 }, (_, i) => i)).length, MAX_SPARK_POINTS)
  assert.deepEqual(benchmarkText(0.024, 0.41, 'median'), { text: '17x below median', sign: -1 })
  assert.deepEqual(benchmarkText(1.2, 0.4, 'median'), { text: '3x above median', sign: 1 })
  assert.deepEqual(benchmarkText(0.5, 0.4), { text: '25% above benchmark', sign: 1 })
  assert.deepEqual(benchmarkText(0.25, 0.1), { text: '2.5x above benchmark', sign: 1 })
  assert.deepEqual(benchmarkText('0.41', 0.41, 'median'), { text: 'at median', sign: 0 })
  assert.deepEqual(benchmarkText('n/a', 0.41, 'median'), { text: 'median 0.41', sign: 0 })
  assert.equal(benchmarkText(1, 'x'), null)
})
