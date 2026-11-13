// WP7: browser SDK (install.ts, loadPlugins.ts) and the block renderer.
// Runs under node (scripts/run-tests.mjs bundles it with esbuild); there is no
// DOM, so `window` is stubbed with globalThis and React renders to strings.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockList, BlockRenderer } from '@/blocks/BlockRenderer'
import { actionEndpoint, dataEndpoint } from '@/blocks/BlockPage'
import { CORE_BLOCK_TYPES, getCoreBlock } from '@/blocks/coreBlocks'
import { hasBlockTree, safeUrl, toBlockNode, toBlockTree, toLegacyComponent } from '@/blocks/normalize'
import { getInstalledSdk, installSdk, registerView, sdkApi, toModuleObject } from '@/sdk/install'
import {
  getLastPluginLoadReport,
  loadManifestPlugins,
  loadPluginModules,
  resetPluginLoaderForTests,
  resolveModuleUrl,
  type PluginLoadFailure,
  type PluginLoadReport,
} from '@/sdk/loadPlugins'
import { normalizeManifest, SDK_EXPORTS, SHELL_EXTERNALS, type ShellManifest, type ShellPage } from '@/sdk/manifest'
import {
  getBlock,
  getPage,
  getToolRenderers,
  registerBlock,
  registerToolRenderer,
  subscribe,
  type BlockNode,
} from '@/sdk/registry'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
const win = window as unknown as Record<string, unknown>

const require = createRequire(import.meta.url)

beforeEach(() => {
  delete win.aiui
})

function render(node: BlockNode | BlockNode[]): string {
  const nodes = Array.isArray(node) ? node : [node]
  return renderToStaticMarkup(createElement(BlockList, { nodes }))
}

function tree(raw: unknown): BlockNode[] {
  return toBlockTree(raw).nodes
}

// ── @aiui/sdk export contract ────────────────────────────────────────

test('sdkApi keys equal the frozen SDK_EXPORTS list (what the server shim re-exports)', () => {
  assert.deepEqual(Object.keys(sdkApi), [...SDK_EXPORTS])
  for (const name of SDK_EXPORTS) assert.notEqual(sdkApi[name], undefined, `${name} is undefined`)
  assert.equal(sdkApi.SDK_VERSION, 1)
  assert.ok(Object.isFrozen(sdkApi))
})

test('installSdk publishes window.__AIUI_SDK__ once (idempotent)', () => {
  installSdk()
  const sdk = win.__AIUI_SDK__ as Record<string, unknown> & { modules: Record<string, Record<string, unknown>> }
  assert.ok(sdk, 'window.__AIUI_SDK__ is set')
  assert.equal(sdk.version, 1)
  assert.deepEqual(Object.keys(sdk.modules).sort(), [...SHELL_EXTERNALS].sort())
  for (const fn of ['registerPage', 'registerBlock', 'registerSlot', 'registerToolRenderer', 'registerView']) {
    assert.equal(typeof sdk[fn], 'function', fn)
  }
  assert.equal(sdk.modules['@aiui/sdk'], sdkApi)
  assert.equal(sdk.modules.react.useState, React.useState, 'the shell React instance is shared')
  installSdk()
  assert.equal(win.__AIUI_SDK__, sdk, 'a second install keeps the first object')
  assert.equal(getInstalledSdk(), sdk)
})

test('every runtime export of react, react-dom and jsx-runtime is on the module objects', () => {
  installSdk()
  const modules = (win.__AIUI_SDK__ as { modules: Record<string, Record<string, unknown>> }).modules
  for (const spec of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']) {
    const expected = Object.keys(require(spec)).filter((k) => k !== 'default' && k !== '__esModule')
    assert.ok(expected.length > 0, spec)
    const missing = expected.filter((k) => !(k in modules[spec]))
    assert.deepEqual(missing, [], `${spec} is missing ${missing.join(', ')}`)
  }
})

test('toModuleObject merges a CommonJS default with named bindings and drops default', () => {
  const ns = { default: { a: 1, b: 2 }, b: 3, c: 4 }
  assert.deepEqual({ ...toModuleObject(ns) }, { a: 1, b: 3, c: 4 })
})

test('registerView queues until the legacy runtime exists, then forwards', () => {
  const render = () => undefined
  registerView('custom-page', render)
  const aiui = win.aiui as { __queue: [string, unknown[]][] }
  assert.deepEqual(aiui.__queue, [['registerView', ['custom-page', render]]])

  const calls: unknown[][] = []
  win.aiui = { registerView: (...args: unknown[]) => calls.push(args) }
  const cleanup = () => undefined
  registerView('other', render, cleanup)
  assert.deepEqual(calls, [['other', render, cleanup]])
  assert.throws(() => registerView('', render), TypeError)
})

// ── registry ─────────────────────────────────────────────────────────

test('registry subscribe fires when a block is registered', () => {
  let calls = 0
  const off = subscribe(() => {
    calls += 1
  })
  const Widget = () => createElement('span', null, 'widget')
  registerBlock('sdk-test-subscribe', Widget)
  assert.equal(calls, 1)
  assert.equal(getBlock('sdk-test-subscribe'), Widget)
  off()
})

// ── normalisation ────────────────────────────────────────────────────

test('toBlockTree reads _components, components, blocks, bare arrays and {type, props}', () => {
  assert.equal(tree({ _components: [{ type: 'text', content: 'a' }] })[0].type, 'text')
  assert.equal(tree({ components: [{ type: 'text', content: 'a' }] }).length, 1)
  assert.equal(tree({ blocks: [{ type: 'text' }, { nope: true }, 'x'] }).length, 1)
  assert.equal(tree([{ type: 'badge', text: 'b' }])[0].type, 'badge')

  const node = toBlockNode({ type: 'card', props: { title: 'T' }, children: [{ type: 'text', content: 'c' }] })!
  assert.deepEqual(node.props, { title: 'T' })
  assert.equal((node.children as BlockNode[])[0].type, 'text')

  const flat = toBlockNode({ type: 'columns', children: [{ type: 'card', title: 'x' }], gap: 2 })!
  assert.deepEqual(flat.props, { gap: 2 })
  assert.deepEqual((flat.children as BlockNode[])[0].props, { title: 'x' })

  const raw = toBlockTree({ hello: 'world' })
  assert.equal(raw.raw, true)
  assert.equal(raw.nodes[0].type, 'json_view')

  const surface = tree({ _surface: { id: 's1', messages: [{ a: 1 }] } })[0]
  assert.equal(surface.type, 'a2ui_surface')
  assert.equal(surface.props?.surface_id, 's1')

  assert.equal(hasBlockTree({ _components: [] }), true)
  assert.equal(hasBlockTree({ message: 'ok' }), false)
})

test('toLegacyComponent returns the exact dict the server sent', () => {
  const raw = { type: 'chart', title: 'Sales', data: [{ x: 1 }], children: [{ type: 'text', content: 'n' }] }
  const node = toBlockNode(raw)!
  assert.equal(toLegacyComponent(node), raw)
  const built: BlockNode = { type: 'board', props: { columns: [] }, children: [{ type: 'text', props: { content: 'x' } }] }
  assert.deepEqual(toLegacyComponent(built), { columns: [], type: 'board', children: [{ content: 'x', type: 'text' }] })
})

// ── BlockRenderer ────────────────────────────────────────────────────

test('BlockRenderer renders a core tree', () => {
  const html = render(
    tree({
      _components: [
        { type: 'header', text: 'Overview', level: 1 },
        { type: 'text', content: 'Plain <script>alert(1)</script> text' },
        {
          type: 'columns',
          children: [
            { type: 'card', title: 'Users', value: 42, footer: '+3 today' },
            { type: 'metric', label: 'Latency', value: '120 ms', delta: '-5%' },
          ],
        },
        { type: 'stat_group', stats: [{ label: 'Runs', value: 7, delta: '+1' }] },
        { type: 'table', headers: ['Name', 'Score'], rows: [['ada', 1], ['bob', 2]] },
        { type: 'progress_bar', label: 'Upload', value: 30, max_value: 60 },
        { type: 'alert', message: 'Heads up', title: 'Note', variant: 'warning' },
        { type: 'badge', text: 'beta', variant: 'secondary' },
        { type: 'key_value_list', items: [{ label: 'Region', value: 'eu' }] },
        { type: 'list', items: ['one', 'two'] },
        { type: 'divider', text: 'or' },
        { type: 'json_view', data: { k: 'v' } },
        { type: 'button_group', buttons: [{ label: 'Go', variant: 'primary', action: 'go' }] },
        { type: 'image_display', src: '/x.png', alt: 'pic', caption: 'A picture' },
        { type: 'link', text: 'Docs', href: 'https://example.com', external: true },
      ],
    }),
  )
  assert.match(html, /<h1[^>]*>Overview<\/h1>/)
  assert.ok(html.includes('Plain &lt;script&gt;alert(1)&lt;/script&gt; text'), 'text is escaped, never HTML')
  assert.ok(html.includes('>Users<') && html.includes('>42<') && html.includes('+3 today'))
  assert.ok(html.includes('>Latency<') && html.includes('-5%'))
  assert.match(html, /<table[^>]*>.*<th[^>]*>Name<\/th>.*<td[^>]*>ada<\/td>/s)
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="50"/)
  assert.match(html, /role="alert"[^>]*data-tone="warning"/)
  assert.ok(html.includes('>beta<'))
  assert.ok(html.includes('>Region<') && html.includes('>eu<'))
  assert.match(html, /<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/)
  assert.ok(html.includes('&quot;k&quot;: &quot;v&quot;'))
  assert.match(html, /<button[^>]*data-action="go"[^>]*>Go<\/button>/)
  assert.match(html, /<img[^>]*src="\/x.png"[^>]*alt="pic"/)
  assert.match(html, /<a[^>]*href="https:\/\/example.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/)
  assert.ok(!html.includes('data-aiui-block-fallback'), 'every type above is a core block')
})

test('framed blocks nested in a card render flat (no card-in-card)', () => {
  const html = render(
    tree([
      {
        type: 'card',
        title: 'Outer',
        children: [
          { type: 'card', title: 'Inner', value: 1 },
          { type: 'metric', label: 'M', value: 2 },
          { type: 'table', headers: ['a'], rows: [['b']] },
          { type: 'stat_group', stats: [{ label: 'S', value: 3 }] },
        ],
      },
      { type: 'metric', label: 'Top', value: 4 },
    ]),
  )
  // Exactly two frames: the outer card and the top-level metric.
  assert.equal(html.match(/rounded-xl border border-border/g)?.length, 2, html)
  assert.equal(html.match(/data-nested="true"/g)?.length, 4)
  assert.ok(html.includes('>Inner<') && html.includes('>S<') && html.includes('>Top<'))
})

test('an unknown block type renders the legacy fallback container', () => {
  const html = render(tree({ _components: [{ type: 'mystery_widget', foo: 1 }, { type: 'chart', title: 'C' }] }))
  assert.match(html, /data-aiui-block-fallback="mystery_widget"/)
  assert.match(html, /data-aiui-block-fallback="chart"/)
  assert.match(html, /data-status="loading"/)
})

test('prototype keys are not block types', () => {
  assert.equal(getCoreBlock('constructor'), undefined)
  assert.equal(getCoreBlock('toString'), undefined)
  assert.match(render(tree([{ type: 'constructor' }])), /data-aiui-block-fallback="constructor"/)
})

test('a registered block wins over the core set; custom.js registerComponent routes to legacy', () => {
  const Mine = ({ node }: { node: BlockNode }) => createElement('em', { 'data-mine': '' }, String(node.props?.title))
  registerBlock('sdk-test-override', Mine)
  assert.match(render(tree([{ type: 'sdk-test-override', title: 'hey' }])), /<em data-mine="">hey<\/em>/)

  win.aiui = { __queue: [['registerComponent', ['card', () => null]]] }
  assert.match(render(tree([{ type: 'card', title: 'x' }])), /data-aiui-block-fallback="card"/)
  win.aiui = { components: { badge: () => null } }
  assert.match(render(tree([{ type: 'badge', text: 'x' }])), /data-aiui-block-fallback="badge"/)
})

test('CORE_BLOCK_TYPES covers the spec list', () => {
  for (const t of [
    'text', 'header', 'heading', 'markdown_text', 'markdown', 'card', 'metric', 'stat_group', 'table', 'list',
    'key_value_list', 'badge', 'alert', 'callout', 'button', 'action', 'button_group', 'columns', 'grid', 'row',
    'progress_bar', 'progress', 'code_block', 'code', 'image_display', 'image', 'divider', 'separator', 'json_view', 'json',
  ]) {
    assert.ok(CORE_BLOCK_TYPES.includes(t), t)
  }
})

test('BlockPage endpoints', () => {
  const page = (p: Partial<ShellPage>): ShellPage => ({ id: 'rep ort', title: 'R', kind: 'blocks', ...p })
  assert.equal(dataEndpoint(page({})), '/api/pages/rep%20ort/data')
  assert.equal(dataEndpoint(page({ apiEndpoint: '/x' })), '/x')
  assert.equal(actionEndpoint(page({ actionEndpoint: '/a' })), '/a')
  assert.equal(actionEndpoint(page({ apiEndpoint: '/api/plugins/hello/pages/hb' })), '/api/plugins/hello/pages/hb/action')
  assert.equal(actionEndpoint(page({ apiEndpoint: '/api/pages/rep ort/data' })), '/api/pages/rep%20ort/action')
})

test('BlockRenderer renders a single node', () => {
  const html = renderToStaticMarkup(createElement(BlockRenderer, { node: { type: 'text', props: { content: 'solo' } } }))
  assert.match(html, />solo</)
})

// ── loadManifestPlugins ──────────────────────────────────────────────

function manifest(partial: Partial<ShellManifest>): ShellManifest {
  return normalizeManifest({ pages: [], ...partial })!
}

test('loadManifestPlugins imports react pages, blocks and tool renderers once each', async () => {
  resetPluginLoaderForTests()
  const imported: string[] = []
  // Page components are declared with `function`: the registry treats a
  // zero-argument arrow as a lazy loader (registry.ts looksLikeLoader).
  function HelloPage() {
    return createElement('div', null, 'hello')
  }
  const Weather = () => createElement('div', null, 'weather')
  const Gantt = () => createElement('div', null, 'gantt')
  const modules: Record<string, () => unknown> = {
    'http://localhost/_plugins/hello/hello.js': () => {
      // self-registers its tool renderer, default-exports the page
      registerToolRenderer('sdk_get_weather', Weather)
      return { default: HelloPage }
    },
    'http://localhost/_plugins/hello/gantt.js': () => ({ GanttBlock: Gantt }),
  }
  const failures: PluginLoadFailure[] = []
  const m = manifest({
    pages: [
      { id: 'sdk-hello', title: 'Hello', kind: 'react', module: '/_plugins/hello/hello.js', source: 'plugin:hello' },
      { id: 'sdk-legacy', title: 'L', kind: 'legacy', module: '/dashboard-plugins/x/index.js' },
      { id: 'sdk-blocks', title: 'B', kind: 'blocks', apiEndpoint: '/api/plugins/hello/pages/b' },
    ],
    blocks: [{ type: 'sdk-gantt', module: '/_plugins/hello/gantt.js', source: 'plugin:hello', export: 'GanttBlock' } as never],
    toolRenderers: [{ toolName: 'sdk_get_weather', module: '/_plugins/hello/hello.js', source: 'plugin:hello' }],
  })
  const report = await loadPluginModules(m, {
    importModule: async (url) => {
      imported.push(url)
      const mod = modules[url]
      if (!mod) throw new Error(`unexpected import ${url}`)
      return mod()
    },
    onError: (f) => failures.push(f),
  })
  assert.equal(failures.length, 0, JSON.stringify(failures))
  assert.deepEqual(imported.sort(), Object.keys(modules).sort(), 'deduped; legacy and blocks pages are not imported')
  assert.equal(getPage('sdk-hello'), HelloPage, 'default export registered under the page id')
  assert.equal(getToolRenderers().sdk_get_weather, Weather, 'self-registration is not overwritten by the default export')
  assert.equal(getBlock('sdk-gantt'), Gantt, 'named export via spec.export')
  assert.equal(report.loaded.length, 2)

  // A second load (manifest refetch) does not re-import or re-register.
  await loadPluginModules(m, {
    importModule: async (url) => {
      imported.push(url)
      return {}
    },
    onError: (f) => failures.push(f),
  })
  assert.equal(imported.length, 2)
  assert.equal(getToolRenderers().sdk_get_weather, Weather)
  assert.equal(failures.length, 0, JSON.stringify(failures))
})

test('a module that throws on import is isolated and reported; the rest still load', async () => {
  resetPluginLoaderForTests()
  function OkPage() {
    return createElement('div', null, 'ok')
  }
  const failures: PluginLoadFailure[] = []
  const warn = console.warn
  console.warn = () => {}
  let report: PluginLoadReport | undefined
  try {
    report = await loadPluginModules(
      manifest({
        pages: [
          { id: 'sdk-broken', title: 'Broken', kind: 'react', module: '/_plugins/broken/broken.js', source: 'plugin:broken' },
          { id: 'sdk-ok', title: 'Ok', kind: 'react', module: '/_plugins/ok/ok.js', source: 'plugin:ok' },
          { id: 'sdk-nodefault', title: 'N', kind: 'react', module: '/_plugins/ok/none.js', source: 'plugin:ok' },
          { id: 'sdk-evil', title: 'E', kind: 'react', module: 'javascript:alert(1)', source: 'plugin:evil' },
        ],
      }),
      {
        importModule: async (url) => {
          if (url.endsWith('broken.js')) throw new SyntaxError('boom at import')
          if (url.endsWith('none.js')) return { notAComponent: 1 }
          if (url.startsWith('javascript:')) throw new Error('must never be imported')
          return { default: OkPage }
        },
        onError: (f) => failures.push(f),
      },
    )
  } finally {
    console.warn = warn
  }
  assert.equal(getPage('sdk-ok'), OkPage)
  assert.equal(getPage('sdk-broken'), undefined)
  const byPlugin = Object.fromEntries(failures.map((f) => [f.plugin, f.message]))
  assert.match(byPlugin.broken, /boom at import/)
  assert.match(byPlugin.ok, /page 'sdk-nodefault' was not registered/)
  assert.match(byPlugin.evil, /no loadable module URL/)
  assert.equal(report?.failed.length, 3)
})

test('resolveModuleUrl accepts http(s) and relative paths only', () => {
  assert.equal(resolveModuleUrl('/_plugins/a/a.js'), 'http://localhost/_plugins/a/a.js')
  assert.equal(resolveModuleUrl('https://cdn.example/x.js'), 'https://cdn.example/x.js')
  assert.equal(resolveModuleUrl('data:text/javascript,1'), null)
  assert.equal(resolveModuleUrl('javascript:1'), null)
  assert.equal(resolveModuleUrl(''), null)
  assert.equal(resolveModuleUrl(undefined), null)
})

test('block URLs: only relative, http(s), mailto and tel (and data:image for images)', () => {
  assert.equal(safeUrl('/x'), '/x')
  assert.equal(safeUrl('https://a.example/p?q=1'), 'https://a.example/p?q=1')
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c')
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
  assert.equal(safeUrl(' JaVa\tScRiPt:alert(1)'), undefined)
  assert.equal(safeUrl('data:text/html,<b>x</b>'), undefined)
  assert.equal(safeUrl('data:image/png;base64,AAAA'), undefined, 'data: is image-only')
  assert.equal(safeUrl('data:image/png;base64,AAAA', 'image'), 'data:image/png;base64,AAAA')
  assert.equal(safeUrl({ href: '/x' }), undefined)

  const html = render(
    tree([
      { type: 'link', text: 'bad', href: 'javascript:alert(1)' },
      { type: 'image_display', src: 'javascript:alert(1)', alt: 'x', caption: 'cap' },
      { type: 'button', label: 'Go', href: 'vbscript:msgbox(1)' },
    ]),
  )
  assert.ok(!/javascript:|vbscript:/i.test(html), html)
  assert.ok(html.includes('>bad<') && html.includes('>cap<') && html.includes('>Go<'))
})

test('loadManifestPlugins keeps the frozen Promise<void> contract and records a report', async () => {
  resetPluginLoaderForTests()
  assert.equal(getLastPluginLoadReport(), null)
  const result = await loadManifestPlugins(
    manifest({ pages: [{ id: 'sdk-only-blocks', title: 'B', kind: 'blocks', apiEndpoint: '/api/x' }] }),
  )
  assert.equal(result, undefined)
  assert.deepEqual(getLastPluginLoadReport(), { loaded: [], failed: [], registered: [] })
})
