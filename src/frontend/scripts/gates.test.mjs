/**
 * Tests for the build gates (`npm run test:scripts`). Each gate runs against a
 * small fake build in a temp directory, so a gate that stops detecting what it
 * is for fails here, not silently in CI.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { carryForward, previousAssets } from './carry-forward-assets.mjs'
import { ManifestError, filesOf, findKey, loadManifest, namedChunks, staticClosure } from './lib/build-manifest.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const temp = []
after(() => temp.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function tmpdir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aiui-gates-'))
  temp.push(dir)
  return dir
}

function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

/** A manifest shaped like the real one: entry -> {mount, legacy app}, mount -> ChatPage, lazy markdown. */
function fakeManifest() {
  return {
    'index.html': {
      file: 'assets/index.js',
      isEntry: true,
      imports: ['_preload-1.js'],
      dynamicImports: ['_mount-1.js', 'src/legacy-app-entry.tsx'],
      css: ['assets/index.css'],
    },
    '_preload-1.js': { file: 'assets/preload-1.js' },
    '_vendor-1.js': { file: 'assets/vendor-1.js' },
    '_shared-1.js': { file: 'assets/shared-1.js', imports: ['_vendor-1.js'], dynamicImports: ['_md-1.js'] },
    '_mount-1.js': {
      file: 'assets/mount-1.js',
      name: 'mount',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_shared-1.js'],
      dynamicImports: ['_ChatPage-1.js'],
      css: ['assets/mount-1.css'],
    },
    '_ChatPage-1.js': {
      file: 'assets/ChatPage-1.js',
      name: 'ChatPage',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_mount-1.js', '_chatonly-1.js'],
    },
    '_chatonly-1.js': { file: 'assets/chatonly-1.js' },
    'src/legacy-app-entry.tsx': {
      file: 'assets/legacy-1.js',
      name: 'legacy-app-entry',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_shared-1.js'],
    },
    '_md-1.js': {
      file: 'assets/md-1.js',
      isDynamicEntry: true,
      imports: ['_vendor-1.js'],
      dynamicImports: ['node_modules/streamdown/dist/highlighted-body-ABC.js', 'src/markdown/shikiPlugin.ts'],
    },
    'node_modules/streamdown/dist/highlighted-body-ABC.js': { file: 'assets/hb-1.js', isDynamicEntry: true, imports: ['_md-1.js'] },
    'src/markdown/shikiPlugin.ts': { file: 'assets/shiki-1.js', isDynamicEntry: true },
  }
}

/** Sources for fakeManifest(): the heavy libraries live only in lazy chunks. */
function fakeDist(manifest = fakeManifest(), overrides = {}) {
  const files = {
    'aiui-manifest.json': JSON.stringify(manifest),
    'index.html': '<script src="/assets/index.js"></script>',
    'assets/index.css': 'body{}',
    'assets/mount-1.css': '.a{}',
    'assets/md-1.js': 'x="data-streamdown";y="mermaidAPI";z="KaTeX parse error"',
    'assets/shiki-1.js': 'throw new ShikiError()',
    'assets/ChatPage-1.js': 'import "@assistant-ui/react"',
  }
  for (const chunk of Object.values(manifest)) files[chunk.file] ??= '/* app code */'
  return write(tmpdir(), { ...files, ...overrides })
}

test('staticClosure follows static imports only', () => {
  const m = fakeManifest()
  assert.deepEqual([...staticClosure(m, ['index.html'])].sort(), ['_preload-1.js', 'index.html'])
  assert.deepEqual(
    [...staticClosure(m, ['index.html', '_mount-1.js'])].sort(),
    ['_mount-1.js', '_preload-1.js', '_shared-1.js', '_vendor-1.js', 'index.html'],
  )
  assert.equal(staticClosure(m, ['_mount-1.js']).has('_md-1.js'), false, 'lazy imports are not part of a closure')
  assert.throws(() => staticClosure(m, ['_missing.js']), ManifestError)
})

test('filesOf returns JS, and CSS only on request', () => {
  const m = fakeManifest()
  const closure = staticClosure(m, ['index.html', '_mount-1.js'])
  assert.deepEqual(filesOf(m, closure), ['assets/index.js', 'assets/mount-1.js', 'assets/preload-1.js', 'assets/shared-1.js', 'assets/vendor-1.js'])
  const withCss = filesOf(m, closure, { css: true })
  assert.ok(withCss.includes('assets/index.css') && withCss.includes('assets/mount-1.css'))
})

test('namedChunks finds the gate chunks by what they are, not by hashed name', () => {
  assert.deepEqual(namedChunks(fakeManifest()), {
    entry: 'index.html',
    shellMount: '_mount-1.js',
    legacyApp: 'src/legacy-app-entry.tsx',
    chatPage: '_ChatPage-1.js',
    streamdown: '_md-1.js',
    shikiPlugin: 'src/markdown/shikiPlugin.ts',
  })
})

test('namedChunks fails loudly when a chunk it measures is gone', () => {
  const noChat = fakeManifest()
  delete noChat['_ChatPage-1.js']
  noChat['_mount-1.js'].dynamicImports = []
  assert.throws(() => namedChunks(noChat), /exactly one ChatPage chunk/)

  const noShell = fakeManifest()
  noShell['index.html'].dynamicImports = ['src/legacy-app-entry.tsx']
  assert.throws(() => namedChunks(noShell), ManifestError)

  assert.throws(() => findKey(fakeManifest(), 'vendor', (key) => key.startsWith('_')), /found \d+/)
})

test('loadManifest explains a missing build', () => {
  assert.throws(() => loadManifest(tmpdir()), /npm run build/)
})

test('check-entry-closure passes when heavy libraries are lazy', () => {
  const { code, out } = run('check-entry-closure.mjs', ['--dist', fakeDist()])
  assert.equal(code, 0, out)
  assert.match(out, /check-entry-closure: OK/)
})

test('check-entry-closure fails when a heavy library is merged into a boot chunk', () => {
  const dist = fakeDist(undefined, { 'assets/shared-1.js': 'el.setAttribute("data-streamdown","x")' })
  const { code, out } = run('check-entry-closure.mjs', ['--dist', dist])
  assert.equal(code, 1, out)
  assert.match(out, /shell mount: assets\/shared-1\.js contains streamdown/)
  assert.match(out, /legacy app: assets\/shared-1\.js contains streamdown/)
})

test('check-entry-closure fails when a boot chunk statically imports a library module', () => {
  const m = fakeManifest()
  m['node_modules/katex/dist/katex.mjs'] = { file: 'assets/katex-1.js' }
  m['src/legacy-app-entry.tsx'].imports.push('node_modules/katex/dist/katex.mjs')
  const { code, out } = run('check-entry-closure.mjs', ['--dist', fakeDist(m)])
  assert.equal(code, 1, out)
  assert.match(out, /legacy app: statically loads katex/)
})

test('check-entry-closure fails when a chunk imports the entry', () => {
  const m = fakeManifest()
  m['_chatonly-1.js'].imports = ['index.html']
  const { code, out } = run('check-entry-closure.mjs', ['--dist', fakeDist(m)])
  assert.equal(code, 1, out)
  assert.match(out, /imports the entry/)
})

test('check-entry-closure fails when a fingerprint no longer matches anything', () => {
  const dist = fakeDist(undefined, { 'assets/shiki-1.js': '/* renamed error class */' })
  const { code, out } = run('check-entry-closure.mjs', ['--dist', dist])
  assert.equal(code, 1, out)
  assert.match(out, /fingerprint "ShikiError" for shiki is in no chunk/)
})

function bundle(extra = {}) {
  return write(tmpdir(), {
    'index.html': '<html>',
    'icon.svg': '<svg/>',
    'aiui-manifest.json': '{}',
    'aiui-externals.json': '{}',
    'assets/index.js': 'entry',
    'assets/chunk-abc.js': 'chunk',
    ...extra,
  })
}

test('check-bundle-sync passes for an identical copy and ignores hand-written files', () => {
  const copy = bundle({ 'plugins/dashboard.js': 'hand-written', 'chat.css': 'hand-written' })
  const { code, out } = run('check-bundle-sync.mjs', ['--dist', bundle(), '--against', copy])
  assert.equal(code, 0, out)
  assert.match(out, /OK \(6 files match/)
})

test('check-bundle-sync reports missing, stale and changed files', () => {
  const dist = bundle({ 'assets/new-123.js': 'new' })
  const copy = bundle({ 'assets/old-999.js': 'stale', 'assets/index.js': 'older entry' })
  const { code, out } = run('check-bundle-sync.mjs', ['--dist', dist, '--against', copy])
  assert.equal(code, 1, out)
  assert.match(out, /missing from the copy \(1\):\s+assets\/new-123\.js/)
  assert.match(out, /stale in the copy \(not in this build\) \(1\):\s+assets\/old-999\.js/)
  assert.match(out, /different content \(1\):\s+assets\/index\.js/)
  assert.match(out, /npm run build && npm run sync/)
})

test('check-bundle-sync refuses to compare without a build', () => {
  const { code, out } = run('check-bundle-sync.mjs', ['--dist', tmpdir(), '--against', bundle()])
  assert.equal(code, 2, out)
  assert.match(out, /npm run build/)
})

test('prune-katex-fonts keeps woff2 only and leaves other fonts alone', () => {
  const css =
    '@font-face{font-family:KaTeX_AMS;src:url(/assets/KaTeX_AMS-Regular-a.woff2) format("woff2"),url(/assets/KaTeX_AMS-Regular-b.woff) format("woff"),url(/assets/KaTeX_AMS-Regular-c.ttf) format("truetype")}' +
    '@font-face{font-family:KaTeX_Size3;src:url(data:font/woff2;base64,AA,BB;CC) format("woff2"),url(/assets/KaTeX_Size3-Regular-d.woff) format("woff")}' +
    '@font-face{font-family:Other;src:url(/assets/Other-e.woff2) format("woff2"),url(/assets/Other-f.woff) format("woff")}' +
    '@font-face{font-family:KaTeX_Old;src:url(/assets/KaTeX_Old-g.ttf) format("truetype")}'
  const dist = write(tmpdir(), {
    'index.html': '<html>',
    'assets/katex-1.css': css,
    'assets/KaTeX_AMS-Regular-a.woff2': 'w2',
    'assets/KaTeX_AMS-Regular-b.woff': 'w',
    'assets/KaTeX_AMS-Regular-c.ttf': 't',
    'assets/KaTeX_Size3-Regular-d.woff': 'w',
    'assets/Other-e.woff2': 'w2',
    'assets/Other-f.woff': 'w',
    'assets/KaTeX_Old-g.ttf': 't',
    'aiui-manifest.json': JSON.stringify({
      'katex.css': { file: 'assets/katex-1.css', assets: ['assets/KaTeX_AMS-Regular-b.woff', 'assets/KaTeX_AMS-Regular-a.woff2'] },
      'fonts/KaTeX_AMS-Regular.ttf': { file: 'assets/KaTeX_AMS-Regular-c.ttf' },
    }),
  })
  const first = run('prune-katex-fonts.mjs', ['--dist', dist])
  assert.equal(first.code, 0, first.out)

  const out = readFileSync(path.join(dist, 'assets/katex-1.css'), 'utf8')
  assert.match(out, /KaTeX_AMS;src:url\(\/assets\/KaTeX_AMS-Regular-a\.woff2\) format\("woff2"\)}/)
  assert.match(out, /KaTeX_Size3;src:url\(data:font\/woff2;base64,AA,BB;CC\) format\("woff2"\)}/)
  assert.match(out, /Other-f\.woff/, 'non-KaTeX fonts keep every source')
  assert.match(out, /KaTeX_Old-g\.ttf/, 'a font without a woff2 source keeps what it has')

  const left = (name) => existsSync(path.join(dist, 'assets', name))
  assert.equal(left('KaTeX_AMS-Regular-a.woff2'), true)
  assert.equal(left('KaTeX_AMS-Regular-b.woff'), false)
  assert.equal(left('KaTeX_AMS-Regular-c.ttf'), false)
  assert.equal(left('KaTeX_Size3-Regular-d.woff'), false)
  assert.equal(left('Other-f.woff'), true)
  assert.equal(left('KaTeX_Old-g.ttf'), true, 'still referenced, so kept')

  const manifest = JSON.parse(readFileSync(path.join(dist, 'aiui-manifest.json'), 'utf8'))
  assert.deepEqual(manifest, { 'katex.css': { file: 'assets/katex-1.css', assets: ['assets/KaTeX_AMS-Regular-a.woff2'] } })

  const second = run('prune-katex-fonts.mjs', ['--dist', dist])
  assert.match(second.out, /0 stylesheet\(s\) rewritten, 0 woff\/ttf file\(s\) removed/, 'idempotent')
})

test('carry-forward keeps exactly the previous build when it has a manifest', () => {
  const prev = write(tmpdir(), {
    'aiui-manifest.json': JSON.stringify({
      a: { file: 'assets/a-old.js', css: ['assets/a-old.css'], assets: ['assets/font-old.woff2'] },
      entry: { file: 'assets/index.js' },
      evil: { file: 'assets/../../escape.js' },
    }),
    'assets/a-old.js': 'old a',
    'assets/a-old.css': 'old css',
    'assets/font-old.woff2': 'font',
    'assets/index.js': 'old entry',
    'assets/carried-from-two-releases-ago.js': 'ancient',
    'escape.js': 'x',
  })
  const site = write(tmpdir(), { 'assets/index.js': 'new entry', 'assets/a-new.js': 'new a' })
  assert.deepEqual(carryForward(prev, site).sort(), ['a-old.css', 'a-old.js', 'font-old.woff2'])
  assert.equal(readFileSync(path.join(site, 'assets/index.js'), 'utf8'), 'new entry', 'new files are never overwritten')
  assert.equal(existsSync(path.join(site, 'assets/carried-from-two-releases-ago.js')), false)
  assert.equal(existsSync(path.join(site, 'escape.js')), false)
})

test('carry-forward keeps every asset of a site built before chunks were hashed', () => {
  const prev = write(tmpdir(), { 'assets/index.js': 'old', 'assets/mermaid.core.js': 'm', 'assets/sub/x.js': 'x' })
  assert.deepEqual(previousAssets(prev), ['index.js', 'mermaid.core.js', 'sub/x.js'])
  const site = write(tmpdir(), { 'assets/index.js': 'new' })
  assert.deepEqual(carryForward(prev, site).sort(), ['mermaid.core.js', 'sub/x.js'])
})

test('carry-forward is a no-op on the first deploy', () => {
  const site = write(tmpdir(), { 'assets/index.js': 'new' })
  const { code, out } = run('carry-forward-assets.mjs', [path.join(tmpdir(), 'nothing-here'), site])
  assert.equal(code, 0, out)
  assert.match(out, /no previous site/)
})
