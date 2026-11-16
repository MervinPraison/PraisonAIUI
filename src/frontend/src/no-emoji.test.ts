// No emoji in the React shell's chrome (AGENTS.md "Design", DESIGN.md): an
// emoji renders differently on every OS and reads as amateur next to the
// single-weight lucide line icons. Icons are lucide (16px, stroke 1.75,
// currentColor); a page without a lucide icon shows its initial.
//
// Scope: the layouts, layout features, first-party browser plugins, the
// app-shell pages, the page templates, the chat's layout presentation and
// the docs style's chrome.
// The legacy vanilla views (templates/frontend/plugins/views) are the
// default dashboard's own output and stay byte-for-byte (R6); the app shell
// replaces the ones a layout shows first with React pages (src/app-pages).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'src')
const DIRS = ['app-layouts', 'layout-features', 'builtin', 'app-pages', 'components/page', 'chat-engine/presentation', 'docs']
// The docs style's chrome (DESIGN.md "Docs style"), outside those folders.
const FILES = ['App.tsx', 'Header.tsx', 'Sidebar.tsx', 'Toc.tsx', 'Footer.tsx', 'Content.tsx', 'components/theme-toggle.tsx']
const PICTOGRAPH = /\p{Extended_Pictographic}/u

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n)
    if (statSync(full).isDirectory()) return files(full)
    return /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [full] : []
  })
}

test('no pictograph (emoji) in the app shell’s React chrome', () => {
  const scanned = [...DIRS.flatMap((d) => files(path.join(ROOT, d))), ...FILES.map((f) => path.join(ROOT, f))]
  assert.ok(scanned.length > 50, 'the folders were scanned')
  const hits = scanned.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .flatMap((line, i) => (PICTOGRAPH.test(line) ? [`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])),
  )
  assert.deepEqual(hits, [])
})

test('the check catches an emoji and lets the shortcut glyphs through', () => {
  assert.ok(PICTOGRAPH.test('💰 Cost'))
  assert.ok(PICTOGRAPH.test('🗑'))
  assert.ok(!PICTOGRAPH.test('⌘K ↵ ⌃C · — …'))
})
