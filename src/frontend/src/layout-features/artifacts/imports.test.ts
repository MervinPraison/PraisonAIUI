// The artifacts feature's budget (lf-artifacts, ADR 0003 §1.4) depends on
// what it imports statically: the chat store, Radix menus and the heavy
// renderers stay out of its chunk and load with import() (or come with the
// chat page). This guards the import lines; the build gate measures bytes.
//
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(process.cwd(), 'src/layout-features/artifacts')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [full] : []
  })
}

/** Static (non type-only) import specifiers of a file. */
function staticImports(code: string): string[] {
  const out: string[] = []
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1])
  return out
}

const LAZY_ONLY = [
  // Shared with the chat route: importing them would split them out of its chunk (viewers/urls.ts, glyphs.tsx).
  /^@\/chat-engine\/(store|util|sessionsStore)$/,
  /^@\/chat-engine\/(protocol|transports|Thread|ChatPage|useAiuiRuntime)$/,
  /^@\/chat-engine\/parts\//,
  /^@\/chat\//,
  /^@\/surfaces\//,
  /^@\/markdown\/(Markdown|shikiPlugin|streamdownPlugins)$/,
  /^@\/components\/ui\/(dropdown-menu|popover|dialog|sheet|select|tooltip)$/,
  /^(@assistant-ui\/|streamdown|@streamdown\/|shiki|@shikijs\/|mermaid|katex|radix-ui)/,
  /^@\/(app-layouts|shell)\//,
]

test('the feature imports heavy or shared-chat modules only with import()', () => {
  const files = sources(DIR)
  assert.ok(files.length > 10, 'sources found')
  const bad: string[] = []
  for (const f of files) {
    for (const spec of staticImports(readFileSync(f, 'utf8'))) {
      if (LAZY_ONLY.some((re) => re.test(spec))) bad.push(`${path.relative(DIR, f)} imports '${spec}'`)
    }
  }
  assert.deepEqual(bad, [])
})

test("lucide's Copy, X, ArrowUp and ArrowDown (also in the chat route) are drawn locally", () => {
  const bad: string[] = []
  for (const f of sources(DIR)) {
    const m = /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/.exec(readFileSync(f, 'utf8'))
    const names = (m?.[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0])
    for (const n of names) if (['Copy', 'X', 'ArrowUp', 'ArrowDown'].includes(n)) bad.push(`${path.relative(DIR, f)}: ${n}`)
  }
  assert.deepEqual(bad, [])
})

test('the scanner sees static imports and skips type-only ones', () => {
  assert.deepEqual(
    staticImports("import type { A } from '@/chat-engine/store'\nimport { b } from './b'\nexport { c } from '@/x'\nimport './s.css'\nconst l = import('@/chat-engine/store')"),
    ['./b', '@/x', './s.css'],
  )
})
