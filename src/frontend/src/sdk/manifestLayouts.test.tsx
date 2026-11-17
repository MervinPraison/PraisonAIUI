// registerManifestLayouts (sdk/loadPlugins.ts): plugin layouts from the
// manifest are registered lazily and imported only when first rendered.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, Suspense } from 'react'
import { prerenderToNodeStream } from 'react-dom/static'
import {
  getLayoutComponent,
  getLayouts,
  registerLayout,
  resetLayoutsForTests,
  type LayoutComponent,
  type LayoutProps,
} from './layouts'
import { loadPluginModules, registerManifestLayouts, resetPluginLoaderForTests } from './loadPlugins'
import { normalizeManifest, type ShellManifest } from './manifest'

const Frame: LayoutComponent = ({ pageId }: LayoutProps) => createElement('main', null, `plugin frame ${pageId}`)

function manifestWith(available: Record<string, unknown>[]): ShellManifest {
  return normalizeManifest({ pages: [], layouts: { default: '', userChoice: true, available } })!
}

const PLUGIN = { id: 'aurora', title: 'Aurora', description: 'A plugin layout', source: 'plugin:aurora', module: '/_plugins/aurora/layout.js' }

/** Render the layout, waiting for its lazy chunk; an error while loading or rendering rejects. */
async function render(id: string): Promise<string> {
  const C = getLayoutComponent(id)!
  let failure: unknown
  const { prelude } = await prerenderToNodeStream(
    createElement(Suspense, { fallback: 'skeleton' }, createElement(C, { pageId: 'chat' } as LayoutProps)),
    { onError: (err) => void (failure ??= err) },
  )
  let html = ''
  for await (const chunk of prelude) html += String(chunk)
  if (failure) throw failure
  return html
}

function quietly<T>(fn: () => T): T {
  const warn = console.warn
  console.warn = () => {}
  try {
    return fn()
  } finally {
    console.warn = warn
  }
}

beforeEach(() => {
  resetLayoutsForTests()
  resetPluginLoaderForTests()
})

test('a plugin layout is registered with the manifest’s meta and nothing is imported', () => {
  const urls: string[] = []
  const ids = registerManifestLayouts(manifestWith([PLUGIN]), { importModule: async (u) => void urls.push(u) })
  assert.deepEqual(ids, ['aurora'])
  assert.deepEqual(getLayouts(), [{ id: 'aurora', meta: { title: 'Aurora', description: 'A plugin layout' } }])
  assert.deepEqual(urls, [], 'registering downloads nothing')
})

test('the module is imported on first render and its default export is the frame', async () => {
  const urls: string[] = []
  registerManifestLayouts(manifestWith([PLUGIN]), {
    importModule: async (u) => {
      urls.push(u)
      return { default: Frame }
    },
  })
  assert.match(await render('aurora'), /plugin frame chat/)
  assert.equal(urls.length, 1)
  assert.match(urls[0], /\/_plugins\/aurora\/layout\.js$/)
})

test('a module that calls registerLayout itself wins, meta included, without a warning', async () => {
  const warnings: string[] = []
  const warn = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
  try {
    registerManifestLayouts(manifestWith([PLUGIN]), {
      importModule: async () => {
        registerLayout('aurora', { title: 'Aurora (own meta)', chat: { thread: 'dense' } }, Frame)
        return {}
      },
    })
    assert.match(await render('aurora'), /plugin frame chat/)
  } finally {
    console.warn = warn
  }
  assert.equal(getLayouts()[0].meta.title, 'Aurora (own meta)')
  assert.equal(getLayouts()[0].meta.chat?.thread, 'dense')
  assert.deepEqual(warnings, [], 'replacing the manifest placeholder is silent')
})

test('registering over a real layout still warns', () => {
  const warnings: string[] = []
  const warn = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
  try {
    registerManifestLayouts(manifestWith([PLUGIN]), { importModule: async () => ({ default: Frame }) })
    registerLayout('aurora', { title: 'First' }, Frame)
    registerLayout('aurora', { title: 'Second' }, Frame)
  } finally {
    console.warn = warn
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /registerLayout\('aurora'\) replaces an earlier registration/)
})

test('a module that neither registers nor exports a frame, or fails to import, rejects (the host falls back)', async () => {
  registerManifestLayouts(manifestWith([PLUGIN, { ...PLUGIN, id: 'broken', module: '/_plugins/broken.js' }]), {
    importModule: async (u) => {
      if (u.includes('broken')) throw new Error('404')
      return { notAFrame: 1 }
    },
  })
  const errors = console.error
  console.error = () => {}
  try {
    await assert.rejects(render('aurora'), /did not call registerLayout\('aurora'/)
    await assert.rejects(render('broken'), /404/)
  } finally {
    console.error = errors
  }
})

test('built-in layouts (no module) and layouts registered by something else are left alone; repeat calls are no-ops', () => {
  const builtin = { id: 'basic', title: 'Basic', source: 'builtin' }
  quietly(() => registerLayout('aurora', { title: 'Registered earlier' }, Frame))
  assert.deepEqual(registerManifestLayouts(manifestWith([builtin, PLUGIN])), [])
  assert.equal(getLayoutComponent('aurora'), Frame)
  assert.equal(getLayoutComponent('basic'), undefined)

  resetLayoutsForTests()
  resetPluginLoaderForTests()
  assert.deepEqual(registerManifestLayouts(manifestWith([PLUGIN])), ['aurora'])
  assert.deepEqual(registerManifestLayouts(manifestWith([PLUGIN])), [], 'idempotent')
})

test('a module URL that is not http(s) is reported when the layout renders', async () => {
  registerManifestLayouts(manifestWith([{ ...PLUGIN, module: 'javascript:alert(1)' }]), { importModule: async () => ({ default: Frame }) })
  const errors = console.error
  console.error = () => {}
  try {
    await assert.rejects(render('aurora'), /no loadable module URL/)
  } finally {
    console.error = errors
  }
})

test('the eager plugin loader never imports a layout module', async () => {
  const urls: string[] = []
  const m = manifestWith([PLUGIN])
  registerManifestLayouts(m, { importModule: async (u) => void urls.push(u) })
  await loadPluginModules(m, { importModule: async (u) => void urls.push(u), onError: () => {} })
  assert.deepEqual(urls, [])
})

test('a plugin layout stylesheet is added with its SRI when the layout first loads', async () => {
  type FakeLink = { rel: string; href: string; crossOrigin: string; integrity: string; dataset: Record<string, string>; addEventListener: () => void }
  const links: FakeLink[] = []
  const g = globalThis as { document?: unknown }
  const before = g.document
  g.document = {
    querySelectorAll: () => links,
    createElement: (): FakeLink => ({ rel: '', href: '', crossOrigin: '', integrity: '', dataset: {}, addEventListener: () => {} }),
    head: { appendChild: (l: FakeLink) => void links.push(l) },
  }
  try {
    const css = '/_plugins/aurora/layout.css'
    const cssIntegrity = 'sha384-layoutcss'
    registerManifestLayouts(manifestWith([{ ...PLUGIN, css, cssIntegrity }]), { importModule: async () => ({ default: Frame }) })
    assert.equal(normalizeManifest({ pages: [], layouts: { default: '', userChoice: true, available: [{ ...PLUGIN, cssIntegrity }] } })!.layouts!.available[0].cssIntegrity, cssIntegrity)
    assert.equal(links.length, 0, 'nothing is added before the layout loads')
    await render('aurora')
    assert.equal(links.length, 1)
    assert.match(links[0].href, /\/_plugins\/aurora\/layout\.css$/)
    assert.equal(links[0].integrity, cssIntegrity)
    assert.equal(links[0].crossOrigin, 'anonymous')
  } finally {
    g.document = before
  }
})
