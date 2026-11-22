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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { carryForward, LEDGER, previousAssets } from './carry-forward-assets.mjs'
import { HASH_FILE, readHash, siteHash } from './site-hash.mjs'
import { BUNDLE_ROOT_FILES } from './lib/bundle-files.mjs'
import { ICON_BUCKETS, ICON_NAMES_FILE, iconBucket, inlineIconsModule, lucideIconNodes, lucideIcons } from './lib/lucide-icons.mjs'
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
    'assets/md-1.js': 'x="data-streamdown";y="mermaidAPI";z="KaTeX parse error";w="recharts-wrapper"',
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

function touches(files) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, 'touches-frontend.mjs')], {
    input: files.join('\n'),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('touches-frontend flags source and every built bundle file, including the SDK typings', () => {
  const copy = 'src/praisonaiui/templates/frontend/'
  assert.equal(touches(['src/frontend/src/main.tsx']), 'frontend=true')
  assert.equal(touches([`${copy}assets/chunk-abc.js`]), 'frontend=true')
  for (const name of BUNDLE_ROOT_FILES) {
    assert.equal(touches(['README.md', `${copy}${name}`]), 'frontend=true', name)
  }
  assert.ok(BUNDLE_ROOT_FILES.includes('aiui-sdk.d.ts'))
})

test('touches-frontend ignores hand-written files next to the bundle and everything else', () => {
  const copy = 'src/praisonaiui/templates/frontend/'
  assert.equal(touches([`${copy}plugins/views/chat.js`, `${copy}chat.css`, `${copy}LICENSE-fonts.txt`]), 'frontend=false')
  assert.equal(touches(['src/praisonaiui/server.py', 'docs/index.md', '']), 'frontend=false')
  assert.equal(touches([]), 'frontend=false')
})

test('sync and check:bundle use the same built-file list as CI', () => {
  for (const script of ['sync-templates.mjs', 'check-bundle-sync.mjs']) {
    const src = readFileSync(path.join(SCRIPTS, script), 'utf8')
    assert.match(src, /from '\.\/lib\/bundle-files\.mjs'/, script)
    assert.doesNotMatch(src, /'aiui-sdk\.d\.ts'/, `${script} keeps its own list`)
  }
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
  assert.equal(existsSync(path.join(site, 'assets/carried-from-two-releases-ago.js')), false, 'not in a ledger')
  assert.equal(existsSync(path.join(site, 'escape.js')), false)
})

test('carry-forward keeps the previous build\'s content-named entry (aiui build lists it in the manifest)', () => {
  // A page cached for 10 minutes before a deploy loads /assets/index-<hash>.js of its own build.
  const prev = write(tmpdir(), {
    'aiui-manifest.json': JSON.stringify({
      'index.html': { file: 'assets/index.js', css: ['assets/index.css'] },
      'aiui-entry-copy:index-0123456789.js': { file: 'assets/index-0123456789.js' },
      'aiui-entry-copy:index-abcdef0123.css': { file: 'assets/index-abcdef0123.css' },
    }),
    'assets/index.js': 'old entry',
    'assets/index.css': 'old css',
    'assets/index-0123456789.js': 'old entry',
    'assets/index-abcdef0123.css': 'old css',
  })
  const site = write(tmpdir(), { 'assets/index.js': 'new entry', 'assets/index.css': 'new css', 'assets/index-fedcba9876.js': 'new entry' })
  assert.deepEqual(carryForward(prev, site).sort(), ['index-0123456789.js', 'index-abcdef0123.css'])
  assert.equal(readFileSync(path.join(site, 'assets/index.js'), 'utf8'), 'new entry')
  const ledger = JSON.parse(readFileSync(path.join(site, LEDGER), 'utf8'))
  assert.deepEqual(Object.keys(ledger.files).sort(), ['index-0123456789.js', 'index-abcdef0123.css'])
})

test('carry-forward keeps older generations for --keep-days through its ledger, then drops them', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString()
  const prev = write(tmpdir(), {
    'aiui-manifest.json': JSON.stringify({ a: { file: 'assets/a-prev.js' } }),
    [LEDGER]: JSON.stringify({ files: { 'b-gen2.js': hoursAgo(5), 'c-gen9.js': hoursAgo(49), '../../escape.js': hoursAgo(1), 'bad.js': 'never' } }),
    'assets/a-prev.js': 'previous build',
    'assets/b-gen2.js': 'two deploys ago',
    'assets/c-gen9.js': 'two days ago',
    'assets/bad.js': 'x',
    'escape.js': 'x',
  })
  const site = write(tmpdir(), { 'assets/index.js': 'new entry' })
  assert.deepEqual(carryForward(prev, site, { now, keepDays: 2 }).sort(), ['a-prev.js', 'b-gen2.js'])
  assert.equal(existsSync(path.join(site, 'assets/c-gen9.js')), false, 'older than --keep-days')
  const ledger = JSON.parse(readFileSync(path.join(site, LEDGER), 'utf8'))
  // Each file keeps the time it first left a build, so the window never restarts.
  assert.deepEqual(ledger.files, { 'a-prev.js': new Date(now).toISOString(), 'b-gen2.js': hoursAgo(5) })
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

// ── site-hash (deploy only a changed site) ──────────────────────────

test('site-hash is stable across copies and changes with any file', () => {
  const files = { 'index.html': '<p>a</p>', 'docs/x.html': 'x', 'assets/index.js': 'js' }
  const a = write(tmpdir(), files)
  const b = write(tmpdir(), { 'assets/index.js': 'js', 'docs/x.html': 'x', 'index.html': '<p>a</p>' })
  assert.equal(siteHash(a), siteHash(b), 'same files, any write order')
  assert.notEqual(siteHash(write(tmpdir(), { ...files, 'docs/x.html': 'y' })), siteHash(a), 'content')
  assert.notEqual(siteHash(write(tmpdir(), { ...files, 'docs/y.html': 'x' })), siteHash(a), 'a new file')
  const moved = write(tmpdir(), { 'index.html': '<p>a</p>', 'docs/z.html': 'x', 'assets/index.js': 'js' })
  assert.notEqual(siteHash(moved), siteHash(a), 'a renamed file')
  write(a, { [HASH_FILE]: 'anything' })
  assert.equal(siteHash(a), siteHash(b), 'the hash file itself is left out')
})

test('site-hash ignores sitemap lastmod dates (file times, not content) but not the URLs', () => {
  const map = (date, loc = 'https://x.dev/a') => `<urlset><url><loc>${loc}</loc><lastmod>${date}</lastmod></url></urlset>`
  const a = write(tmpdir(), { 'sitemap.xml': map('2026-11-01') })
  assert.equal(siteHash(write(tmpdir(), { 'sitemap.xml': map('2026-11-22') })), siteHash(a))
  assert.notEqual(siteHash(write(tmpdir(), { 'sitemap.xml': map('2026-11-01', 'https://x.dev/b') })), siteHash(a))
  const page = (date) => `<p>Last updated <lastmod>${date}</lastmod></p>`
  assert.notEqual(siteHash(write(tmpdir(), { 'p.html': page('1') })), siteHash(write(tmpdir(), { 'p.html': page('2') })),
    'only sitemaps are normalised')
})

test('site-hash CLI writes the hash file and says whether the site changed', () => {
  const site = write(tmpdir(), { 'index.html': 'v1' })
  const first = run('site-hash.mjs', [site, '--previous', path.join(tmpdir(), 'missing.txt')])
  assert.equal(first.code, 0, first.out)
  assert.match(first.out, /^hash=[0-9a-f]{64}\nchanged=true$/m, 'no previous deploy: changed')
  const hash = readHash(path.join(site, HASH_FILE))
  assert.equal(hash, siteHash(site))
  const prev = write(tmpdir(), { 'h.txt': `${hash}\n` })
  assert.match(run('site-hash.mjs', [site, '--previous', path.join(prev, 'h.txt')]).out, /changed=false/)
  write(site, { 'index.html': 'v2' })
  assert.match(run('site-hash.mjs', [site, '--previous', path.join(prev, 'h.txt')]).out, /changed=true/)
  assert.equal(readHash(write(tmpdir(), { 'bad.txt': 'not a hash' }) + '/bad.txt'), null)
  assert.equal(run('site-hash.mjs', []).code, 2)
})

// ── check-layout-isolation (ADR 0003 R17) ────────────────────────────

/** fakeManifest() plus two layouts sharing the kit, and a lazily loaded feature. */
function layoutManifest() {
  const m = fakeManifest()
  m['_mount-1.js'].dynamicImports.push('src/app-layouts/alpha/Frame.tsx', 'src/app-layouts/beta/Frame.tsx')
  Object.assign(m, {
    'src/app-layouts/alpha/Frame.tsx': {
      file: 'assets/layout-alpha-1.js',
      name: 'layout-alpha',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_mount-1.js', '_layout-kit-1.js'],
      dynamicImports: ['src/layout-features/panel/Panel.tsx'],
    },
    'src/app-layouts/beta/Frame.tsx': {
      file: 'assets/layout-beta-1.js',
      name: 'layout-beta',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_layout-kit-1.js'],
    },
    '_layout-kit-1.js': { file: 'assets/layout-kit-1.js', name: 'layout-kit', imports: ['_vendor-1.js'] },
    'src/layout-features/panel/Panel.tsx': {
      file: 'assets/lf-panel-1.js',
      name: 'lf-panel',
      isDynamicEntry: true,
      imports: ['_vendor-1.js', '_layout-kit-1.js'],
    },
  })
  return m
}

const layoutSrc = () =>
  write(tmpdir(), {
    'app-layouts/alpha/Frame.tsx': '',
    'app-layouts/beta/Frame.tsx': '',
    'app-layouts/kit/index.ts': '',
    'app-layouts/isolation.test.ts': '',
    'layout-features/panel/Panel.tsx': '',
  })

const isolation = (m, files = {}) => run('check-layout-isolation.mjs', ['--dist', fakeDist(m, files), '--src', layoutSrc()])

test('check-layout-isolation passes when every layout and feature loads only lazily', () => {
  const { code, out } = isolation(layoutManifest())
  assert.equal(code, 0, out)
  assert.match(out, /4 groups \(layout-alpha, layout-beta, layout-kit, lf-panel\)/)
  assert.match(out, /check-layout-isolation: OK/)
})

test('check-layout-isolation fails when the boot closure loads a layout or the kit', () => {
  const m = layoutManifest()
  m['_mount-1.js'].imports.push('_layout-kit-1.js')
  const { code, out } = isolation(m)
  assert.equal(code, 1, out)
  assert.match(out, /boot \(entry \+ shell mount\) statically loads layout-kit/)
  assert.match(out, /assets\/mount-1\.js \(mount\) statically imports layout-kit/)
})

test('check-layout-isolation fails when a lazy shell chunk imports a layout chunk statically', () => {
  const m = layoutManifest()
  m['_md-1.js'].imports.push('src/app-layouts/beta/Frame.tsx')
  const { code, out } = isolation(m)
  assert.equal(code, 1, out)
  assert.match(out, /assets\/md-1\.js .* statically imports layout-beta/)
})

test('check-layout-isolation fails when a layout brings another layout or a feature with it', () => {
  const m = layoutManifest()
  m['src/app-layouts/alpha/Frame.tsx'].imports.push('src/app-layouts/beta/Frame.tsx', 'src/layout-features/panel/Panel.tsx')
  const { code, out } = isolation(m)
  assert.equal(code, 1, out)
  assert.match(out, /layout-alpha statically loads layout-beta/)
  assert.match(out, /layout-alpha statically loads lf-panel/)
})

test('check-layout-isolation fails when a feature loads a layout, or the kit loads a feature', () => {
  const m = layoutManifest()
  m['src/layout-features/panel/Panel.tsx'].imports.push('src/app-layouts/beta/Frame.tsx')
  m['_layout-kit-1.js'].imports.push('src/layout-features/panel/Panel.tsx')
  const { code, out } = isolation(m)
  assert.equal(code, 1, out)
  assert.match(out, /lf-panel statically loads layout-beta \(features never import a layout\)/)
  assert.match(out, /layout-kit statically loads lf-panel/)
})

test('check-layout-isolation fails when a frame or the kit pulls in a heavy library', () => {
  const m = layoutManifest()
  m['_layout-kit-1.js'].imports.push('_md-1.js')
  const byChunk = isolation(m)
  assert.equal(byChunk.code, 1, byChunk.out)
  assert.match(byChunk.out, /layout-kit: assets\/md-1\.js contains streamdown/)

  const byFingerprint = isolation(layoutManifest(), { 'assets/layout-beta-1.js': 'import "@assistant-ui/react"' })
  assert.equal(byFingerprint.code, 1, byFingerprint.out)
  assert.match(byFingerprint.out, /layout-beta: assets\/layout-beta-1\.js contains @assistant-ui/)
})

test('check-layout-isolation fails when a layout or feature folder was not built under its name', () => {
  const m = layoutManifest()
  m['src/app-layouts/beta/Frame.tsx'].name = 'Frame'
  const { code, out } = isolation(m)
  assert.equal(code, 1, out)
  assert.match(out, /no layout-beta chunk in the build/)
})

test('npm run check:closure runs the layout isolation gate too (CI runs check:closure)', () => {
  const pkg = JSON.parse(readFileSync(path.join(SCRIPTS, '..', 'package.json'), 'utf8'))
  const script = pkg.scripts['check:closure']
  assert.match(script, /node scripts\/check-entry-closure\.mjs/)
  assert.match(script, /node scripts\/check-layout-isolation\.mjs/)
  assert.doesNotMatch(script, /[;|]/, 'chained with && so either failure fails the step')
})

test('lucide-icons: the loader finds any icon (or alias) in its lazy bucket; aiui-icons.json lists every name', async () => {
  const root = path.resolve(SCRIPTS, '..')
  const { nodes, aliases } = await lucideIconNodes(path.join(root, 'node_modules', 'lucide-react', 'dist', 'esm'))
  assert.ok(Object.keys(nodes).length > 1500)
  assert.equal(aliases.home, 'house')
  assert.deepEqual(nodes.flag.map(([tag, attrs]) => [tag, Object.keys(attrs)]), [['path', ['d']]]) // React keys dropped
  const buckets = new Set(Object.keys(nodes).map(iconBucket))
  assert.equal(buckets.size, ICON_BUCKETS)

  const plugin = lucideIcons(root)
  assert.equal(plugin.resolveId('virtual:aiui-icons'), '\0aiui-icons')
  const asModule = (code) => import('data:text/javascript,' + encodeURIComponent(code))
  globalThis.__aiuiBucket = async (n) => asModule(await plugin.load(`\0aiui-icons-${n}`))
  const index = (await plugin.load('\0aiui-icons')).replace(/import\('virtual:aiui-icons\/(\d+)'\)/g, 'globalThis.__aiuiBucket($1)')
  const load = (await asModule(index)).default
  assert.deepEqual(await load('flag'), nodes.flag)
  assert.deepEqual(await load('home'), nodes.house)
  assert.equal(await load('constructor'), undefined)
  assert.equal(await load('no-such-icon'), undefined)
  delete globalThis.__aiuiBucket

  let emitted
  await plugin.generateBundle.call({ emitFile: (file) => (emitted = file) })
  const names = JSON.parse(emitted.source)
  assert.equal(emitted.fileName, ICON_NAMES_FILE)
  assert.ok(BUNDLE_ROOT_FILES.includes(ICON_NAMES_FILE))
  assert.ok(names.includes('flag') && names.includes('home') && names.includes('house'))
  assert.deepEqual(names, [...names].sort())
})

test('lucide-icons: virtual:aiui-icons/inline draws every icon as lucide-react does, under its names', async () => {
  const root = path.resolve(SCRIPTS, '..')
  const plugin = lucideIcons(root)
  assert.equal(plugin.resolveId('virtual:aiui-icons/inline'), '\0aiui-icons-inline')
  const code = await plugin.load('\0aiui-icons-inline')
  assert.equal(code, await inlineIconsModule(path.join(root, 'node_modules', 'lucide-react', 'dist', 'esm')))
  // Every icon is a pure call, so Rollup drops the ones nobody imports.
  assert.ok(!/^const i_\w+ = (?!\/\*#__PURE__\*\/)/m.test(code))
  // Written under node_modules so its `import 'lucide-react'` resolves.
  const file = path.join(root, 'node_modules', '.cache', 'aiui-gates', `inline-${process.pid}.mjs`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, code)
  try {
    const inline = await import(pathToFileURL(file).href)
    const lucide = await import('lucide-react')
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const draw = (Icon) => renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    // Plain names, Icon/Lucide forms and aliases (FileCode2 is file-code-corner).
    for (const name of ['ChevronDown', 'X', 'XIcon', 'LucideCheck', 'FileCode2', 'TextAlignStart', 'Languages']) {
      assert.ok(inline[name], `${name} exported`)
      assert.equal(draw(inline[name]), draw(lucide[name]), name)
    }
    const icons = Object.keys(lucide).filter((name) => /^[A-Z]/.test(name) && lucide[name]?.$$typeof && name !== 'Icon')
    assert.deepEqual(icons.filter((name) => !inline[name]), [], 'every lucide-react icon name is exported')
  } finally {
    rmSync(file, { force: true })
  }
})

// e2e/fixtures/sweep-tmp.mjs: stale e2e work folders are removed, fresh ones and others kept.
test('sweepStaleWorkDirs removes only old aiui-e2e-* folders', async () => {
  const { mkdtempSync, mkdirSync, utimesSync, existsSync, rmSync } = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { sweepStaleWorkDirs } = await import('../e2e/fixtures/sweep-tmp.mjs')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'))
  try {
    const old = path.join(dir, 'aiui-e2e-old')
    const fresh = path.join(dir, 'aiui-e2e-fresh')
    const other = path.join(dir, 'something-else')
    for (const d of [old, fresh, other]) mkdirSync(d)
    const tenHoursAgo = (Date.now() - 10 * 3600 * 1000) / 1000
    utimesSync(old, tenHoursAgo, tenHoursAgo)
    utimesSync(other, tenHoursAgo, tenHoursAgo)
    const removed = sweepStaleWorkDirs({ dir })
    assert.deepEqual(removed, ['aiui-e2e-old'])
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(fresh), true)
    assert.equal(existsSync(other), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
