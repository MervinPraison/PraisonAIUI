// Page templates stay standalone: a React page (or a plugin) can use one
// without pulling in the blocks layer, the shell, the chat engine or a layout.
// Block adapters live in components/page/blocks and may import the block layer.
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(process.cwd(), 'src/components/page')
const specifiers = (code: string) => [...code.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
const sources = (dir: string) =>
  readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => path.join(dir, n))

test('templates import no block layer, shell, chat engine or layout', () => {
  const files = sources(DIR)
  assert.ok(files.some((f) => f.endsWith('Board.tsx')), 'the templates were scanned')
  const bad = files.flatMap((f) =>
    specifiers(readFileSync(f, 'utf8'))
      .filter((s) => /^@\/(blocks|shell|chat-engine|app-layouts|layout-features|legacy)(\/|$)/.test(s))
      .map((s) => `${path.basename(f)} → ${s}`),
  )
  assert.deepEqual(bad, [])
})

test('templates draw their chevrons and close glyph (no shared lucide chunks)', () => {
  const bad = sources(DIR).flatMap((f) => {
    const m = readFileSync(f, 'utf8').match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/)
    const names = m ? m[1].split(',').map((n) => n.trim()) : []
    return names.filter((n) => /^(X|XIcon|Chevron\w+|Arrow(Up|Down)\w*)$/.test(n)).map((n) => `${path.basename(f)}: ${n}`)
  })
  assert.deepEqual(bad, [], 'use Glyph from ./parts')
})

test('block adapters import only their own template', () => {
  const dir = path.join(DIR, 'blocks')
  for (const f of sources(dir)) {
    const own = path.basename(f).replace(/Block\.tsx$/, '')
    const template = own === 'CodeEditor' ? 'Editor' : own
    const local = specifiers(readFileSync(f, 'utf8')).filter((s) => s.startsWith('../'))
    const others = local.filter((s) => !['../model', '../parts', `../${template}`].includes(s))
    assert.deepEqual(others, [], `${path.basename(f)} imports another template`)
  }
})
