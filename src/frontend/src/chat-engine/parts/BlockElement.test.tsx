import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BlockElement from './BlockElement'
import { dataframeToBlock, elementToBlockNodes, plotlyToBlock } from './blockElementModel'
import ElementPart from './ElementPart'

test('dataframeToBlock converts DataframeElement payload to a searchable table block', () => {
  const out = dataframeToBlock({
    type: 'dataframe',
    name: 'Sales',
    data: {
      columns: ['Region', 'Revenue'],
      data: [
        { Region: 'EMEA', Revenue: 1200 },
        { Region: 'US', Revenue: 2400 },
      ],
    },
  })
  assert.deepEqual(out, {
    type: 'table',
    headers: ['Region', 'Revenue'],
    rows: [
      ['EMEA', 1200],
      ['US', 2400],
    ],
    searchable: true,
    sortable: true,
    caption: 'Sales',
  })
})

test('dataframeToBlock handles empty DataFrames gracefully', () => {
  const out = dataframeToBlock({ type: 'dataframe', name: 'Empty', data: { columns: [], data: [] } })
  assert.deepEqual(out, { type: 'empty', text: 'Empty: no rows' })
})

test('plotlyToBlock converts stacked bar, donut, histogram and heatmap traces', () => {
  const bar = plotlyToBlock({
    type: 'plotly',
    fig_data: {
      data: [
        { type: 'bar', name: 'A', x: ['Q1', 'Q2'], y: [10, 20] },
        { type: 'bar', name: 'B', x: ['Q1', 'Q2'], y: [5, 15] },
      ],
      layout: { title: { text: 'Quarterly' }, barmode: 'stack' },
    },
  })
  assert.equal(bar.type, 'chart')
  assert.equal(bar.title, 'Quarterly')
  assert.equal(bar.chart_type, 'bar')
  assert.equal(bar.stacked, true)
  assert.deepEqual(bar.y, ['A', 'B'])

  const donut = plotlyToBlock({
    type: 'plotly',
    data: {
      data: [{ type: 'pie', labels: ['X', 'Y'], values: [70, 30], hole: 0.5 }],
      layout: { title: 'Share' },
    },
  })
  assert.equal(donut.chart_type, 'donut')
  assert.equal(donut.title, 'Share')

  const hist = plotlyToBlock({
    type: 'plotly',
    fig_data: { data: [{ type: 'histogram', x: [1, 2, 2, 3] }] },
  })
  assert.equal(hist.chart_type, 'histogram')

  const heat = plotlyToBlock({
    type: 'plotly',
    fig_data: { data: [{ type: 'heatmap', x: ['c1'], y: ['r1'], z: [[9]] }] },
  })
  assert.equal(heat.chart_type, 'heatmap')
  assert.deepEqual(heat.data, [{ x: 'c1', y: 'r1', value: 9 }])
})

test('plotlyToBlock degrades unsupported Plotly traces cleanly', () => {
  const fallback = plotlyToBlock({
    type: 'plotly',
    name: '3D Plot',
    fig_data: { data: [{ type: 'scatter3d', x: [1], y: [2], z: [3] }] },
  })
  assert.equal(fallback.type, 'container')
  assert.ok(Array.isArray(fallback.children))
})

test('BlockElement renders an inline metric block and dataframe table inside chat', () => {
  const metricHtml = renderToStaticMarkup(
    createElement(BlockElement, {
      data: {
        type: 'block',
        id: 'blk_1',
        block: { type: 'metric', label: 'Active Agents', value: '12', delta: '+3' },
      },
    }),
  )
  assert.match(metricHtml, /Active Agents/)
  assert.match(metricHtml, />12</)
  assert.match(metricHtml, /\+3/)

  const dfHtml = renderToStaticMarkup(
    createElement(BlockElement, {
      data: {
        type: 'dataframe',
        name: 'Models',
        data: { columns: ['Model', 'Tokens'], data: [{ Model: 'gpt-4o', Tokens: 420 }] },
      },
    }),
  )
  assert.match(dfHtml, /gpt-4o/)
  assert.match(dfHtml, /420/)
})

test('elementToBlockNodes accepts raw block dicts and skips media types', () => {
  assert.equal(elementToBlockNodes({ type: 'alert', message: 'Hello', variant: 'info' }).length, 1)
  assert.equal(elementToBlockNodes({ type: 'image', url: '/a.png' }).length, 0)
})

test('ElementPart preserves click-to-load exfiltration guard for untrusted external image URLs', () => {
  const html = renderToStaticMarkup(
    createElement(ElementPart, {
      data: { type: 'image', url: 'https://evil.example/pixel.png', name: 'Tracker' },
    }),
  )
  assert.match(html, /Image from evil\.example/)
  assert.doesNotMatch(html, /<img /)
})
