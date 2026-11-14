// Core purity: the shell (src/shell) and the SDK (src/sdk) are the small core.
// Every page and feature, first-party included, is contributed from outside
// it (src/builtin, plugin modules). This test reads the sources and fails when
// the core
//   1. imports a feature module (chat-engine and friends), or
//   2. names a built-in page id in a string literal.
//
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const CORE_DIRS = ['shell', 'sdk']

/** Feature code the core must never import (statically or lazily). */
const FEATURE_DIRS = ['chat-engine', 'chat', 'agent-ui', 'views', 'pages', 'surfaces']

/**
 * Ids of the server's built-in pages (server.py `_builtin_pages`) plus
 * `explorer`. A new built-in page belongs in this list too.
 */
const BUILTIN_PAGE_IDS = [
  'overview', 'chat', 'chat-canvas', 'canvas', 'channels', 'inbox', 'sessions', 'runs', 'replay',
  'usage', 'feedback', 'cron', 'jobs', 'work', 'jobs-board', 'kanban', 'approvals', 'api', 'agents',
  'skills', 'marketplace', 'memory', 'knowledge', 'nodes', 'mcp', 'config', 'auth', 'logs', 'debug',
  'guardrails', 'eval', 'training', 'code-studio', 'telemetry', 'traces', 'security', 'inspector',
  'theme-picker', 'explorer',
]

/** The same word used for something that is not a page (file → literals). */
const NOT_A_PAGE_ID: Record<string, readonly string[]> = {
  // Boot state "the server asked for a token".
  'shell/ShellApp.tsx': ['auth'],
  'shell/BootScreen.tsx': ['auth'],
}

/**
 * Known debt, modularity gap G5 (staged): these files still name pages. Each
 * entry lists exactly the ids the file may still contain; `'*'` exempts the
 * whole file. Shrink this table as G5 lands. An entry that no longer matches
 * anything fails the test, so the table cannot go stale, and nothing may be
 * added to it.
 */
const KNOWN_DEBT: Record<string, readonly string[]> = {
  'shell/nav.ts': ['chat', 'chat-canvas', 'code-studio', 'explorer'], // FULL_BLEED_IDS → page.layout
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Drop block and line comments (a `//` after `:` is a URL, keep it). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const files = CORE_DIRS.flatMap((d) => sourceFiles(path.join(SRC, d))).map((full) => ({
  rel: path.relative(SRC, full).split(path.sep).join('/'),
  full,
  code: stripComments(readFileSync(full, 'utf8')),
}))

/** Every module specifier in `from '…'`, `import('…')` and `import '…'`. */
function specifiers(code: string): string[] {
  const out: string[] = []
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[2])
  return out
}

/** Top-level directory under src/ a specifier points at, or null for packages. */
function targetDir(spec: string, fromFile: string): string | null {
  let abs: string
  if (spec.startsWith('@/')) abs = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) abs = path.resolve(path.dirname(fromFile), spec)
  else return null
  const rel = path.relative(SRC, abs)
  return rel.startsWith('..') ? null : rel.split(path.sep)[0]
}

/** String literals in `code` that are exactly a built-in page id. */
function pageIdLiterals(code: string): string[] {
  const ids = new Set(BUILTIN_PAGE_IDS)
  const found = new Set<string>()
  const re = /(['"`])([A-Za-z][A-Za-z-]*)\1/g
  for (let m = re.exec(code); m; m = re.exec(code)) if (ids.has(m[2])) found.add(m[2])
  return [...found].sort()
}

test('the core has sources to check', () => {
  assert.ok(files.some((f) => f.rel === 'shell/mount.tsx'), 'shell/mount.tsx was scanned')
  assert.ok(files.some((f) => f.rel === 'sdk/registry.ts'), 'sdk/registry.ts was scanned')
  assert.ok(!files.some((f) => f.rel === 'shell/ported.ts'), 'shell/ported.ts is gone: pages register from src/builtin')
})

test('shell/ and sdk/ never import a feature module (@/chat-engine, …)', () => {
  const bad: string[] = []
  for (const f of files) {
    for (const spec of specifiers(f.code)) {
      const dir = targetDir(spec, f.full)
      if (dir && FEATURE_DIRS.includes(dir)) bad.push(`${f.rel} imports '${spec}'`)
    }
  }
  assert.deepEqual(bad, [], 'register first-party pages in src/builtin instead')
})

test('sdk/ never imports the shell (the shell provides its services to the SDK, not the reverse)', () => {
  const bad: string[] = []
  for (const f of files) {
    if (!f.rel.startsWith('sdk/')) continue
    for (const spec of specifiers(f.code)) {
      if (targetDir(spec, f.full) === 'shell') bad.push(`${f.rel} imports '${spec}'`)
    }
  }
  assert.deepEqual(bad, [], 'use provideShellHost()/activateShell() in sdk/services.ts')
  assert.ok(files.some((f) => f.rel === 'sdk/notify.ts'), 'notify lives under sdk/')
  assert.ok(!files.some((f) => f.rel === 'shell/notify.ts'), 'shell/notify.ts moved to sdk/notify.ts')
})

test('only the shell may import src/builtin, and only its index', () => {
  const bad: string[] = []
  for (const f of files) {
    for (const spec of specifiers(f.code)) {
      if (targetDir(spec, f.full) !== 'builtin') continue
      if (f.rel.startsWith('sdk/')) bad.push(`${f.rel} imports '${spec}' (the SDK must not know the built-ins)`)
      else if (spec !== '@/builtin') bad.push(`${f.rel} imports '${spec}' (import '@/builtin' only)`)
    }
  }
  assert.deepEqual(bad, [])
})

test('shell/ and sdk/ contain no built-in page id literal', () => {
  const bad: string[] = []
  const stale: string[] = []
  for (const f of files) {
    const found = pageIdLiterals(f.code).filter((id) => !(NOT_A_PAGE_ID[f.rel] ?? []).includes(id))
    const debt = KNOWN_DEBT[f.rel] ?? []
    if (debt.includes('*')) {
      if (found.length === 0) stale.push(`${f.rel}: '*'`)
      continue
    }
    for (const id of found) if (!debt.includes(id)) bad.push(`${f.rel} names page '${id}'`)
    for (const id of debt) if (!found.includes(id)) stale.push(`${f.rel}: '${id}'`)
  }
  for (const rel of Object.keys(KNOWN_DEBT)) {
    if (!files.some((f) => f.rel === rel)) stale.push(`${rel}: file not found`)
  }
  assert.deepEqual(bad, [], 'page-specific behaviour belongs in a plugin (src/builtin), not in the core')
  assert.deepEqual(stale, [], 'KNOWN_DEBT lists debt that is already paid: delete these entries')
})

test('the scanners catch what they are meant to catch', () => {
  assert.deepEqual(specifiers("import { a } from '@/chat-engine/register'\nconst b = import('./x')\nimport './y.css'"), [
    '@/chat-engine/register',
    './x',
    './y.css',
  ])
  assert.equal(targetDir('@/chat-engine/register', path.join(SRC, 'shell', 'a.ts')), 'chat-engine')
  assert.equal(targetDir('../chat-engine/ChatPage', path.join(SRC, 'shell', 'a.ts')), 'chat-engine')
  assert.equal(targetDir('./router', path.join(SRC, 'shell', 'a.ts')), 'shell')
  assert.equal(targetDir('react', path.join(SRC, 'shell', 'a.ts')), null)
  assert.deepEqual(pageIdLiterals("navigate('chat'); x = \"code-studio\"; y = `logs`; z = 'chatty'"), [
    'chat',
    'code-studio',
    'logs',
  ])
  assert.deepEqual(pageIdLiterals(stripComments("// go to 'chat'\n/* 'logs' */ const u = 'http://x/y'")), [])
})
