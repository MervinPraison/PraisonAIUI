// Page templates (components/page): what each one renders, and its block adapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { Board } from './Board'
import { BoardBlock } from './blocks/BoardBlock'
import { CodeEditorBlock } from './blocks/CodeEditorBlock'
import { GalleryBlock } from './blocks/GalleryBlock'
import { ListDetailBlock } from './blocks/ListDetailBlock'
import { LogViewerBlock } from './blocks/LogViewerBlock'
import { CodeView, Editor, FileTree } from './Editor'
import { Gallery } from './Gallery'
import { ListDetail, ListPagination } from './ListDetail'
import { Facts } from './parts'
import { LogViewer } from './LogViewer'

/** Markup without React's text separators, so assertions read like the page. */
const renderToStaticMarkup = (el: Parameters<typeof renderMarkup>[0]) => renderMarkup(el).split('<!-- -->').join('')

type Row = { id: string; title: string; tokens: number }
const rows: Row[] = [
  { id: 'sort', title: 'Compare sorting algorithms', tokens: 3412 },
  { id: 'notes', title: 'Summarise release notes', tokens: 3980 },
]
const columns = [
  { key: 'title', label: 'Title' },
  { key: 'tokens', label: 'Tokens', align: 'end' as const },
]

test('ListDetail: a labelled table, a roving tab stop and the selected row', () => {
  const html = renderToStaticMarkup(
    <ListDetail label="Sessions" columns={columns} rows={rows} selectedId="notes" detail={<Facts items={[{ label: 'Tokens', value: '3,980' }]} />} detailTitle="Summarise release notes" />,
  )
  assert.match(html, /data-aiui-template="list"/)
  assert.match(html, /<table class="aiui-tpl-table" aria-label="Sessions" aria-rowcount="3">/)
  assert.match(html, /<th scope="col" data-align="end">Tokens<\/th>/)
  assert.match(html, /data-row-id="notes" aria-selected="true" aria-controls="[^"]+" tabindex="0"/)
  assert.match(html, /data-row-id="sort" aria-selected="false" tabindex="-1"/)
  assert.match(html, /<aside id="[^"]+" class="aiui-tpl-detail" aria-label="Summarise release notes">/)
  assert.match(html, /aria-label="Close details"/)
  assert.match(html, /<dt>Tokens<\/dt><dd>3,980<\/dd>/)
})

test('ListDetail: no selection makes the first row the tab stop and hides the panel', () => {
  const html = renderToStaticMarkup(<ListDetail label="Sessions" columns={columns} rows={rows} detail={<p>x</p>} />)
  assert.match(html, /data-row-id="sort" aria-selected="false" tabindex="0"/)
  assert.doesNotMatch(html, /aiui-tpl-detail/)
})

test('ListDetail: sortable headers say their direction; empty rows show the empty state', () => {
  const sorted = renderToStaticMarkup(
    <ListDetail label="Sessions" columns={columns} rows={rows} sort={{ key: 'tokens', dir: 'desc' }} onSort={() => {}} />,
  )
  assert.match(sorted, /aria-sort="descending"><button type="button" class="aiui-tpl-sort">Tokens/)
  const empty = renderToStaticMarkup(<ListDetail label="Sessions" columns={columns} rows={[]} empty="No sessions match" />)
  assert.match(empty, /<div class="aiui-tpl-empty">No sessions match<\/div>/)
  assert.doesNotMatch(empty, /<table/)
})

test('ListPagination: range, hints and labelled page buttons', () => {
  const html = renderToStaticMarkup(<ListPagination page={1} pageSize={8} total={42} />)
  assert.match(html, /<nav aria-label="Pagination"/)
  assert.match(html, /1–8 of 42/)
  assert.match(html, /aria-label="Previous page" disabled=""/)
  assert.match(html, /aria-label="Next page"/)
})

test('list_detail block: columns, rows and a search past one page', () => {
  const node = {
    type: 'list_detail',
    props: {
      title: 'Agents',
      columns: [{ key: 'name', label: 'Name' }, { key: 'runs', label: 'Runs', align: 'right' }],
      rows: Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}`, runs: i })),
      page_size: 10,
    },
  }
  const html = renderToStaticMarkup(<ListDetailBlock node={node} />)
  assert.match(html, /aria-label="Agents"/)
  assert.match(html, /<th scope="col" data-align="end">Runs<\/th>/)
  assert.equal((html.match(/data-row-id=/g) ?? []).length, 10, 'one page of rows')
  assert.match(html, /Search agents/)
  assert.match(html, /1–10 of 30/)
})

test('Board: columns with counts, a WIP limit, cards and keyboard hints', () => {
  const html = renderToStaticMarkup(
    <Board
      label="Task board"
      onMove={() => {}}
      columns={[
        { id: 'backlog', title: 'Backlog', cards: [{ id: 'T-148', ref: 'T-148', title: 'Translate the emails', meta: 'Medium', footer: 'No run yet' }] },
        { id: 'doing', title: 'In progress', limit: 1, cards: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', href: '/tasks/b' }] },
      ]}
    />,
  )
  assert.match(html, /data-aiui-template="board"/)
  assert.match(html, /role="group" aria-label="Task board"/)
  assert.match(html, /<h2 id="[^"]+">Backlog<\/h2><span class="aiui-tpl-count">1<\/span>/)
  assert.match(html, /data-over="true"[^>]*>.*2 \/ 1 limit/)
  assert.match(html, /aria-roledescription="draggable card" aria-label="Translate the emails"/)
  assert.match(html, /<h3><a href="\/tasks\/b">B<\/a><\/h3>/)
  assert.match(html, /role="status" aria-live="assertive"/)
})

test('board block: aiui.board() columns and card dicts', () => {
  const node = {
    type: 'board',
    props: {
      columns: [
        { id: 'todo', title: 'Todo', cards: [{ type: 'card', title: 'Task', value: 3, footer: 'agent-a' }] },
        { id: 'done', title: 'Done', cards: [{ name: 'Shipped', assignee: 'bob' }] },
      ],
    },
  }
  const html = renderToStaticMarkup(<BoardBlock node={node} />)
  assert.match(html, /<h2 id="[^"]+">Todo<\/h2>/)
  assert.match(html, /<h3>Task<\/h3><p class="aiui-tpl-card-body">3<\/p><div class="aiui-tpl-card-foot">agent-a<\/div>/)
  assert.match(html, /<h3>Shipped<\/h3><div class="aiui-tpl-card-foot">bob<\/div>/)
  assert.doesNotMatch(html, /draggable/, 'a block board is read-only')
})

const entries = [
  { id: '1', ts: '15:20:31.204', level: 'INFO', source: 'uvicorn.access', message: 'GET /api/sessions 200' },
  { id: '2', ts: '15:20:34.477', level: 'WARNING', source: 'knowledge', message: 'Embedding failed', detail: '{"model":"x"}' },
  { id: '3', ts: '15:20:38.219', level: 'ERROR', source: 'knowledge', message: 'Embedding failed again' },
]

test('LogViewer: level toggles with counts, the grid and expandable rows', () => {
  const html = renderToStaticMarkup(<LogViewer label="Log lines" entries={entries} />)
  assert.match(html, /data-aiui-template="log"/)
  assert.match(html, /role="group" aria-label="Levels"/)
  assert.match(html, /data-level="warn" aria-pressed="true"[^>]*>Warn<span class="aiui-tpl-count">1<\/span>/)
  assert.match(html, /data-level="debug" aria-pressed="true"[^>]*>Debug<span class="aiui-tpl-count">0<\/span>/)
  assert.match(html, /role="log" aria-live="off"/)
  assert.match(html, /<span class="aiui-tpl-lvl" data-level="error">ERROR<\/span>/)
  assert.match(html, /aria-expanded="false"/, 'a row with detail is a disclosure')
  assert.match(html, /aria-label="Search log messages"|>Search log messages</)
  assert.match(html, /Only matching lines/)
})

test('LogViewer: initial levels hide the others; nothing left shows the empty state', () => {
  const html = renderToStaticMarkup(<LogViewer label="Log lines" entries={entries} initialLevels={['debug']} />)
  assert.match(html, /data-level="info" aria-pressed="false"/)
  assert.match(html, /No lines match these filters\./)
})

test('log_viewer block: logger spellings and dict detail', () => {
  const node = {
    type: 'log_viewer',
    props: { entries: [{ time: '10:00', level: 'critical', logger: 'app', message: 'boom', detail: { code: 1 } }] },
  }
  const html = renderToStaticMarkup(<LogViewerBlock node={node} />)
  assert.match(html, /data-level="error">ERROR</)
  assert.match(html, /<span class="aiui-tpl-log-src" title="app">app<\/span>/)
})

test('Editor: tabs, run bar, panel, aside and status; CodeView marks diagnostics', () => {
  const html = renderToStaticMarkup(
    <Editor
      label="Code Studio"
      files={<FileTree label="sorting" nodes={[{ path: 'src', name: 'src', children: [{ path: 'src/bench.py', name: 'bench.py' }] }]} selected="src/bench.py" />}
      tabs={[{ id: 'bench.py', title: 'bench.py', dirty: true, problems: 1 }, { id: 'sorts.py', title: 'sorts.py' }]}
      activeTab="bench.py"
      onCloseTab={() => {}}
      toolbar={<span>Run</span>}
      panel={<pre>exit 0</pre>}
      panelTitle="Terminal"
      aside={<p>Ask Coder</p>}
      asideTitle="Ask Coder"
      status={<span>Ln 24, Col 31</span>}
    >
      <CodeView code={'import random\nprint(statistics.median([1]))\n'} label="Editor, bench.py, Python" diagnostics={[{ line: 2, severity: 'error', message: '“statistics” is not defined.' }]} />
    </Editor>,
  )
  assert.match(html, /data-aiui-template="editor" aria-label="Code Studio" role="region"/)
  assert.match(html, /role="tree" aria-label="sorting"/)
  assert.match(html, /role="treeitem" aria-expanded="true" aria-level="1"/)
  assert.match(html, /role="treeitem" aria-selected="true" aria-level="2" data-path="src\/bench.py" tabindex="0"/)
  assert.match(html, /role="tab" aria-selected="true" tabindex="0" data-tab-id="bench.py"/)
  assert.match(html, /aria-label="Unsaved"/)
  assert.match(html, /aria-label="1 error"/)
  assert.match(html, /aria-label="Close bench.py"/)
  assert.match(html, /role="toolbar" aria-label="Run"/)
  assert.match(html, /aria-label="Editor, bench.py, Python"/)
  assert.match(html, /data-severity="error" aria-invalid="true"><span class="aiui-tpl-gutter" aria-hidden="true">2<\/span>/)
  assert.match(html, /role="note" class="aiui-tpl-diag" data-severity="error"/)
  assert.match(html, /<aside class="aiui-tpl-aside" aria-label="Ask Coder">/)
  assert.match(html, /Ln 24, Col 31/)
})

test('code_editor block: one tab per file and the output panel', () => {
  const node = {
    type: 'code_editor',
    props: { files: [{ name: 'a.py', content: 'x = 1' }, { name: 'b.py', content: 'y = 2' }], output: 'ok' },
  }
  const html = renderToStaticMarkup(<CodeEditorBlock node={node} />)
  assert.match(html, /data-tab-id="a.py"/)
  assert.match(html, /data-tab-id="b.py"/)
  assert.match(html, /<pre>ok<\/pre>/)
  assert.equal(renderToStaticMarkup(<CodeEditorBlock node={{ type: 'code_editor', props: {} }} />), '')
})

test('Gallery: tabs, featured, tiles with monograms, the drawer', () => {
  const html = renderToStaticMarkup(
    <Gallery
      label="Marketplace"
      heading="Most installed"
      tabs={[{ id: 'all', label: 'All', count: 214 }, { id: 'agents', label: 'Agents', count: 48 }]}
      activeTab="all"
      featured={<p>GitHub Toolkit</p>}
      items={[
        { id: 'cr', title: 'Code Reviewer', subtitle: 'Kestrel', tag: 'Agent', description: 'Reads the diff', action: <button type="button">Install</button> },
        { id: 'sl', title: 'Slack', tag: 'Tool', error: 'Install failed: timeout' },
      ]}
      selectedId="cr"
      onSelect={() => {}}
      detail={<p>Details</p>}
      detailTitle="Agent details"
    />,
  )
  assert.match(html, /data-aiui-template="gallery"/)
  assert.match(html, /role="tab" aria-selected="true" tabindex="0" data-tab-id="all" class="aiui-tpl-gtab">All<span>214<\/span>/)
  assert.match(html, /<section class="aiui-tpl-featured">/)
  assert.match(html, /<h2 id="[^"]+" class="aiui-tpl-gallery-h">Most installed<\/h2>/)
  assert.match(html, /<span class="aiui-tpl-mono" aria-hidden="true">CR<\/span>/)
  assert.match(html, /<button type="button" aria-pressed="true">Code Reviewer<\/button>/)
  assert.match(html, /<span class="aiui-tpl-tag">Agent<\/span>/)
  assert.match(html, /role="alert">Install failed: timeout</)
  assert.match(html, /<aside class="aiui-tpl-drawer" aria-label="Agent details">/)
})

test('gallery block: aiui.gallery() images keep only safe URLs', () => {
  const node = {
    type: 'gallery',
    props: {
      items: [
        { src: '/img/a.png', alt: 'A chart', caption: 'Chart' },
        { src: 'javascript:alert(1)', caption: 'Bad' },
      ],
    },
  }
  const html = renderToStaticMarkup(<GalleryBlock node={node} />)
  assert.match(html, /<img class="aiui-tpl-tile-media" src="\/img\/a.png" alt="A chart" loading="lazy"\/>/)
  assert.doesNotMatch(html, /javascript:/)
  assert.match(html, /<span class="aiui-tpl-mono" aria-hidden="true">BA<\/span>/, 'an unsafe image falls back to a monogram')
})

test('the core block set renders the template types (lazily)', async () => {
  const { CORE_BLOCK_TYPES, getCoreBlock } = await import('@/blocks/coreBlocks')
  for (const type of ['board', 'gallery', 'list_detail', 'log_viewer', 'code_editor']) {
    assert.ok(CORE_BLOCK_TYPES.includes(type), `${type} is a core block`)
    assert.equal(typeof getCoreBlock(type), 'function', `${type} has a renderer`)
  }
})
