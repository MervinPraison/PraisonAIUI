// Layout isolation, static import rules (ADR 0003 R17). Reads the sources of
// src/app-layouts (one folder per layout, plus the shared kit) and
// src/layout-features (one folder per layout-specific feature) and fails when
//   1. a layout imports another layout (statically or lazily);
//   2. a layout or the kit imports the shell;
//   3. a layout imports a layout feature other than with import();
//   4. a layout feature imports a layout (the kit is fine);
//   5. the kit imports a layout or a feature;
//   6. a frame or the kit imports anything outside the allowed set:
//      @/sdk/*, @/components/ui/*, @/lib/*, @/app-layouts/kit, its own folder,
//      the light chat-engine modules (store, api, protocol, sessionList,
//      feeds) and npm packages other than the heavy renderers.
// The build-level twin is scripts/check-layout-isolation.mjs.
//
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const LAYOUTS = path.join(SRC, 'app-layouts')
const FEATURES = path.join(SRC, 'layout-features')
const KIT = 'kit'

const ALLOWED_PREFIXES = ['@/sdk/', '@/components/ui/', '@/lib/']
const ALLOWED_EXACT = new Set(['@/app-layouts/kit'])
const LIGHT_CHAT_ENGINE = ['store', 'api', 'protocol', 'sessionList', 'feeds'].map((m) => `@/chat-engine/${m}`)
/** npm packages a frame or the kit must never pull in (they belong to lazy page chunks). */
const HEAVY_PACKAGES = /^(@assistant-ui\/|streamdown|@streamdown\/|shiki|@shikijs\/|mermaid|katex)/

interface Source {
  rel: string
  full: string
  code: string
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const read = (full: string): Source => ({
  rel: path.relative(SRC, full).split(path.sep).join('/'),
  full,
  code: stripComments(readFileSync(full, 'utf8')),
})

const layoutFiles = sourceFiles(LAYOUTS).map(read)
const featureFiles = sourceFiles(FEATURES).map(read)

interface Import {
  spec: string
  lazy: boolean
  typeOnly: boolean
}

/** Every module specifier: `import … from`, `export … from`, `import '…'` and `import('…')`. */
export function importsOf(code: string): Import[] {
  const out: Import[] = []
  const staticRe = /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?(['"`])([^'"`]+)\3/g
  for (let m = staticRe.exec(code); m; m = staticRe.exec(code)) out.push({ spec: m[4], lazy: false, typeOnly: !!m[2] })
  const lazyRe = /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g
  for (let m = lazyRe.exec(code); m; m = lazyRe.exec(code)) out.push({ spec: m[2], lazy: true, typeOnly: false })
  return out
}

/** `{ area: 'app-layouts' | 'layout-features' | other top dir, folder }` of a specifier, or null for packages. */
function target(spec: string, from: string): { top: string; folder?: string; rel: string } | null {
  let abs: string
  if (spec.startsWith('@/')) abs = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) abs = path.resolve(path.dirname(from), spec)
  else return null
  const rel = path.relative(SRC, abs).split(path.sep).join('/')
  const [top, folder] = rel.split('/')
  return { top, folder, rel }
}

/** The layout or feature folder a source file belongs to. */
const folderOf = (s: Source) => s.rel.split('/')[1]

test('the layout folders exist and are scanned', () => {
  for (const id of ['kit', 'workbench', 'command', 'chat-canvas', 'guided', 'mission']) {
    assert.ok(layoutFiles.some((f) => folderOf(f) === id), `app-layouts/${id} has sources`)
  }
})

test('a layout never imports another layout, the shell, or a feature statically', () => {
  const bad: string[] = []
  for (const f of layoutFiles) {
    const own = folderOf(f)
    for (const imp of importsOf(f.code)) {
      const t = target(imp.spec, f.full)
      if (!t) continue
      if (t.top === 'shell') bad.push(`${f.rel} imports '${imp.spec}' (the shell hands a frame everything as LayoutProps)`)
      if (t.top === 'app-layouts' && t.folder && t.folder !== own && t.folder !== KIT) {
        bad.push(`${f.rel} imports '${imp.spec}' (layouts never import each other; share it through the kit)`)
      }
      if (t.top === 'layout-features' && !imp.lazy && !imp.typeOnly) {
        bad.push(`${f.rel} imports '${imp.spec}' statically (load features with import(), e.g. a RegionLoader)`)
      }
      if (own === KIT && (t.top === 'layout-features' || (t.top === 'app-layouts' && t.folder !== KIT))) {
        bad.push(`${f.rel} imports '${imp.spec}' (the kit knows no layout or feature)`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('frames and the kit import only the SDK, components/ui, lib, the kit and light chat-engine modules', () => {
  const bad: string[] = []
  for (const f of layoutFiles) {
    const own = folderOf(f)
    for (const imp of importsOf(f.code)) {
      const t = target(imp.spec, f.full)
      if (!t) {
        if (HEAVY_PACKAGES.test(imp.spec)) bad.push(`${f.rel} imports '${imp.spec}' (a heavy renderer: never in a frame)`)
        continue
      }
      if (t.top === 'app-layouts' && (t.folder === own || t.folder === KIT)) continue
      if (t.top === 'layout-features' && (imp.lazy || imp.typeOnly)) continue
      const alias = `@/${t.rel}`
      if (ALLOWED_EXACT.has(alias) || ALLOWED_PREFIXES.some((p) => alias.startsWith(p))) continue
      if (LIGHT_CHAT_ENGINE.includes(alias)) continue
      bad.push(`${f.rel} imports '${imp.spec}'`)
    }
  }
  assert.deepEqual(bad, [], 'a frame gets the page, nav and data through LayoutProps and useLayoutData()')
})

test('a layout feature never imports a layout (the kit is shared)', () => {
  const bad: string[] = []
  for (const f of featureFiles) {
    for (const imp of importsOf(f.code)) {
      const t = target(imp.spec, f.full)
      if (t?.top === 'app-layouts' && t.folder !== KIT) bad.push(`${f.rel} imports '${imp.spec}'`)
      if (t?.top === 'shell') bad.push(`${f.rel} imports '${imp.spec}' (features never import the shell)`)
    }
  }
  assert.deepEqual(bad, [])
})

test('the scanner sees static, re-export, type-only and lazy imports', () => {
  const found = importsOf(
    [
      "import { a } from '@/sdk/layouts'",
      "import type { B } from '@/layout-features/x/types'",
      "export { c } from './c'",
      "import './side.css'",
      "const P = () => import('@/layout-features/panel/Panel')",
      "import {\n  d,\n  e,\n} from '@/app-layouts/kit'",
    ].join('\n'),
  )
  assert.deepEqual(
    found.map((i) => `${i.spec}${i.lazy ? ' lazy' : ''}${i.typeOnly ? ' type' : ''}`),
    ['@/sdk/layouts', '@/layout-features/x/types type', './c', './side.css', '@/app-layouts/kit', '@/layout-features/panel/Panel lazy'],
  )
  const from = path.join(LAYOUTS, 'alpha', 'Frame.tsx')
  assert.deepEqual(target('../beta/Frame', from), { top: 'app-layouts', folder: 'beta', rel: 'app-layouts/beta/Frame' })
  assert.equal(target('react', from), null)
})
