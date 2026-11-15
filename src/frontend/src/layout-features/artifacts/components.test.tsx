// The canvas, the cards, the page and the viewers, rendered to static markup
// from the sorting conversation loaded as chat history (client only: no
// manifest, so builtin.artifacts is off and nothing but the history is fetched).
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ArtifactCards from './ArtifactCards'
import ArtifactsPage from './ArtifactsPage'
import CanvasPanel from './CanvasPanel'
import { artifactsStore } from './feed'
import { CODE, T0, TABLE_V1, TABLE_V2 } from './fixtures'
import TableViewer from './viewers/Table'
import CodeViewer from './viewers/Code'
import ImageViewer from './viewers/Image'
import { compareCells, nextSort, sortRows, sortSummary } from './viewers/sort'

const g = globalThis as unknown as Record<string, unknown>
const win = new EventTarget() as EventTarget & Record<string, unknown>
win.location = { href: 'http://app.test/chat', origin: 'http://app.test', pathname: '/chat', search: '' }
win.fetch = (...args: unknown[]) => (g.fetch as (...a: unknown[]) => unknown)(...args)
g.window = win
g.location = win.location

const requests: string[] = []
g.fetch = async (url: string) => {
  requests.push(url)
  if (url === '/api/chat/history/s1') {
    const at = (min: number) => new Date(T0 + min * 60_000).toISOString()
    return Response.json({
      messages: [
        { role: 'user', content: 'Compare quicksort, mergesort and timsort, with a code sample', timestamp: at(0) },
        { role: 'assistant', agent_name: 'Researcher', content: `Here is how they compare.\n\n${TABLE_V1}\n\n${CODE}`, timestamp: at(1) },
        { role: 'user', content: 'Add whether each one is stable', timestamp: at(1.5) },
        { role: 'assistant', agent_name: 'Researcher', content: `I added the Stable column.\n\n${TABLE_V2}`, timestamp: at(2) },
      ],
    })
  }
  return Response.json({ messages: [] })
}

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el)

before(async () => {
  await artifactsStore().ensure('s1')
})

test('only the chat history was fetched (client only: no artifacts or code API calls)', () => {
  assert.deepEqual(requests, ['/api/chat/history/s1'])
})

test('CanvasPanel: tabs, the newest artifact with its versions and actions, the badge', () => {
  const badges: number[] = []
  const out = html(createElement(CanvasPanel, { sessionId: 's1', viewport: 'desktop', reportBadge: (n: number) => badges.push(n) }))
  assert.match(out, /<section aria-label="Canvas" data-aiui-canvas="true"/)
  assert.match(out, /role="tablist" aria-label="Canvas artifacts"/)
  const tabs = [...out.matchAll(/role="tab"[^>]*aria-selected="(true|false)"[^>]*>.*?<span class="truncate">([^<]+)<\/span>/g)].map((m) => `${m[2]}:${m[1]}`)
  assert.deepEqual(tabs, ['Comparison table:true', 'sort_demo.py:false'])
  assert.match(out, /role="tabpanel" id="aiui-art-panel" aria-labelledby="aiui-art-tab-table_algorithm_average_worst"/)
  assert.match(out, /<h2[^>]*>Comparison table<\/h2>/)
  assert.match(out, /Table · 3 rows · from the reply at \d\d:\d\d/)
  assert.match(out, /aria-label="Version 2 of 2\. Show another version"/)
  for (const label of ['Copy', 'Download', 'Share']) assert.match(out, new RegExp(`</svg>${label}</button>`))
  assert.doesNotMatch(out, />Run</, 'no Run: code_execution is not on')
  assert.match(out, /<aside aria-label="History"/)
  assert.match(out, /Researcher added the Stable column/)
  assert.match(out, /Researcher created the table/)
  assert.match(out, /aria-label="Restore version 1"/)
  assert.match(out, /aria-label="Split: show another artifact below"/)
  assert.match(out, /aria-label="Expand the canvas"/)
  // The sortable table.
  assert.equal((out.match(/<th scope="col" aria-sort="none"/g) ?? []).length, 4)
  assert.match(out, /<th scope="row"[^>]*><span class="">Quicksort<\/span><\/th>/)
  assert.match(out, /In the order the agent wrote\. Select a column header to sort\./)
  assert.deepEqual(badges, [], 'effects do not run in static markup')
})

test('CanvasPanel on a phone: no split or expand, History under the viewer', () => {
  const out = html(createElement(CanvasPanel, { sessionId: 's1', viewport: 'phone', reportBadge: () => {} }))
  assert.doesNotMatch(out, /Split: show another/)
  assert.doesNotMatch(out, /Expand the canvas/)
  assert.match(out, /aria-label="History" class="flex flex-col gap-2\.5 w-full border-t/)
})

test('CanvasPanel: the split pane, and the empty canvas', () => {
  const store = artifactsStore()
  store.setSplit('s1', 'sort_demo.py')
  const out = html(createElement(CanvasPanel, { sessionId: 's1', viewport: 'desktop', reportBadge: () => {} }))
  store.setSplit('s1', null)
  assert.match(out, /aria-label="sort_demo\.py \(split view\)"/)
  assert.match(out, /Python · 5 lines/)
  assert.match(out, />split<\/span>/)
  assert.match(out, /aria-label="Close the split view"/)
  assert.match(out, /data-aiui-art-code="true"/)
  const empty = html(createElement(CanvasPanel, { sessionId: 'nothing-here', viewport: 'desktop', reportBadge: () => {} }))
  assert.match(empty, /Nothing in the canvas yet/)
  assert.doesNotMatch(empty, /tablist/)
})

test('ArtifactCards: one card per artifact a reply made; older versions say so; none for other turns', () => {
  const first = html(createElement(ArtifactCards, { sessionId: 's1', messageId: 'h_1', viewport: 'desktop', reportBadge: () => {} }))
  const cards = [...first.matchAll(/data-artifact-card="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(cards, ['table:algorithm|average|worst', 'sort_demo.py'])
  assert.match(first, /Table · 3 rows · v2 is newer/)
  assert.match(first, /href="\/artifacts\?session=s1&amp;artifact=sort_demo\.py&amp;v=1"/)
  assert.match(first, /aria-label="Open sort_demo\.py in the canvas"/)
  assert.match(first, /In canvas/)
  const second = html(createElement(ArtifactCards, { sessionId: 's1', messageId: 'h_3', viewport: 'phone', reportBadge: () => {} }))
  assert.match(second, /Comparison table/)
  assert.match(second, /Table · 3 rows · v2</, 'phone: the compact meta line')
  assert.match(second, /min-h-14/, 'phone: 56 px cards')
  assert.equal(html(createElement(ArtifactCards, { sessionId: 's1', messageId: 'h_0', viewport: 'desktop', reportBadge: () => {} })), '')
})

test('ArtifactsPage (client only): the chats this tab opened, grouped, with links', () => {
  const out = html(createElement(ArtifactsPage, {}))
  assert.match(out, /<h1[^>]*>Artifacts<\/h1>/)
  assert.match(out, /from the chats opened in this tab/)
  assert.match(out, /aria-label="Search artifacts"/)
  assert.match(out, /Comparison table/)
  assert.match(out, /sort_demo\.py/)
  assert.match(out, /href="\/artifacts\?session=s1&amp;artifact=table%3Aalgorithm%7Caverage%7Cworst&amp;v=2"/)
})

test('ArtifactsPage opened from a share link shows that artifact and version', () => {
  ;(win.location as Record<string, string>).search = '?session=s1&artifact=table%3Aalgorithm%7Caverage%7Cworst&v=1'
  try {
    const out = html(createElement(ArtifactsPage, {}))
    assert.match(out, /All artifacts/)
    assert.match(out, /Open the chat/)
    assert.match(out, /data-artifact="table:algorithm\|average\|worst" data-version="1"/)
    assert.match(out, /aria-label="Version 1 of 2/)
  } finally {
    ;(win.location as Record<string, string>).search = ''
  }
})

test('viewers: table header buttons, plain code before Shiki loads, blocked third-party images', () => {
  const t = html(createElement(TableViewer, { content: '| n | name |\n|---|---|\n| 10 | `x` |\n| 9 | yes |', label: 'T' }))
  assert.match(t, /<table class="[^"]*" aria-label="T">/)
  assert.match(t, /<span class="font-mono text-xs whitespace-nowrap">x<\/span>/)
  assert.match(t, /text-success[^>]*>.*yes<\/span>/)
  const c = html(createElement(CodeViewer, { code: 'a = 1\nb = 2', language: 'python' }))
  assert.match(c, /<pre aria-hidden="true"[^>]*>1\n2\n<\/pre>/)
  assert.match(c, /<code>a = 1\nb = 2<\/code>/)
  assert.match(html(createElement(ImageViewer, { url: 'https://evil.example/p.png', alt: 'x' })), /Image from evil\.example.*Load/)
  assert.match(html(createElement(ImageViewer, { url: '/files/p.png', alt: 'chart' })), /<img src="\/files\/p\.png" alt="chart"/)
  assert.match(html(createElement(ImageViewer, { url: 'javascript:alert(1)', alt: 'x' })), /unsupported link/)
})

test('table sorting: numbers as numbers, natural text, empty last, three-state header', () => {
  const rows = [['b', '10'], ['a', '9'], ['c', ''], ['A2', '1,200']]
  assert.deepEqual(sortRows(rows, { col: 1, dir: 'asc' }).map((r) => r[0]), ['a', 'b', 'A2', 'c'])
  assert.deepEqual(sortRows(rows, { col: 1, dir: 'desc' }).map((r) => r[0]), ['A2', 'b', 'a', 'c'])
  assert.deepEqual(sortRows(rows, { col: 0, dir: 'asc' }).map((r) => r[0]), ['a', 'A2', 'b', 'c'])
  assert.deepEqual(sortRows(rows, null), rows)
  assert.equal(compareCells('`O(n)`', 'O(n)'), 0)
  assert.deepEqual(nextSort(null, 2), { col: 2, dir: 'asc' })
  assert.deepEqual(nextSort({ col: 2, dir: 'asc' }, 2), { col: 2, dir: 'desc' })
  assert.equal(nextSort({ col: 2, dir: 'desc' }, 2), null)
  assert.deepEqual(nextSort({ col: 2, dir: 'desc' }, 0), { col: 0, dir: 'asc' })
  assert.equal(sortSummary({ col: 0, dir: 'asc' }, ['Algorithm'], [['x']]), 'Sorted by Algorithm, A to Z. Select a column header to sort.')
  assert.equal(sortSummary({ col: 1, dir: 'desc' }, ['a', 'Cost'], rows), 'Sorted by Cost, largest first. Select a column header to sort.')
})
