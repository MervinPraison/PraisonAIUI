// legacy/page-types.css: the page templates for legacy views. It is keyed by
// template (data-aiui-page-type), never by page id (R1), applies only under
// the Pro layouts, and uses tokens only (R14).
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CSS = readFileSync(path.resolve(process.cwd(), 'src/legacy/page-types.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const PRO = "html[data-aiui-shell='react'][data-aiui-tokens='pro']"

/** The templates the server names (praisonaiui/builtin/page_types.py PAGE_TYPES). */
const PAGE_TYPES = (() => {
  const py = readFileSync(path.resolve(process.cwd(), '../praisonaiui/builtin/page_types.py'), 'utf8')
  const body = py.match(/PAGE_TYPES: tuple\[str, \.\.\.\] = \(([\s\S]*?)\)/)?.[1] ?? ''
  return [...body.matchAll(/"([a-z-]+)"/g)].map((m) => m[1])
})()

/** Built-in page ids: the pinned page table plus the layout-owned pages. */
const PAGE_IDS = (() => {
  const snap = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../tests/unit/fixtures/builtin_pages_snapshot.json'), 'utf8'))
  return [...snap.insertion_order, 'explorer', 'start', 'templates', 'ops-overview', 'artifacts'] as string[]
})()

/** A selector list split on its top-level commas (not inside (), [] or quotes). */
function splitList(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  return [...parts, cur].map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

/** Every style rule's selector list (at-rule preludes skipped). */
function selectors(css: string): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of css) {
    if (ch === '{') {
      const prelude = buf.trim()
      if (prelude && !prelude.startsWith('@')) out.push(...splitList(prelude))
      buf = ''
    } else if (ch === '}' || ch === ';') {
      buf = ''
    } else {
      buf += ch
    }
  }
  return out
}

const SELECTORS = selectors(CSS)

test('the stylesheet was parsed', () => {
  assert.ok(PAGE_TYPES.includes('list') && PAGE_TYPES.length >= 7, `PAGE_TYPES read from page_types.py: ${PAGE_TYPES}`)
  assert.ok(SELECTORS.length > 50, `found ${SELECTORS.length} selectors`)
})

test('every rule is scoped to the Pro layouts and to a page template', () => {
  const bad = SELECTORS.filter((s) => !s.startsWith(PRO) || !s.includes('[data-aiui-page-type'))
  assert.deepEqual(bad, [])
})

test('templates are named from page_types.py; every styled one is used', () => {
  const used = new Set([...CSS.matchAll(/\[data-aiui-page-type='([^']+)'\]/g)].map((m) => m[1]))
  assert.deepEqual([...used].filter((t) => !PAGE_TYPES.includes(t)), [], 'unknown template')
  // chat pages belong to the chat engine; every other template is dressed here.
  assert.deepEqual(PAGE_TYPES.filter((t) => t !== 'chat' && !used.has(t)), [], 'template without rules')
})

test('no page id and no id selector: keyed by template, never by page (R1)', () => {
  const ids = SELECTORS.filter((s) => /#[\w-]/.test(s.replace(/\[[^\]]*\]/g, '')))
  assert.deepEqual(ids, [], 'id selector')
  const named = SELECTORS.flatMap((s) =>
    [...s.matchAll(/\.([\w-]+)/g)]
      .map((m) => m[1])
      .filter((cls) => PAGE_IDS.some((id) => cls === id || cls === `${id}-page` || cls === `${id}-root`))
      .map((cls) => `${cls} in ${s}`),
  )
  assert.deepEqual(named, [], 'a class named after a page')
  const attrs = SELECTORS.flatMap((s) =>
    [...s.matchAll(/\[(data-(?:legacy-)?page|data-aiui-page)=/g)].map(() => s),
  )
  assert.deepEqual(attrs, [], 'a page id attribute')
})

test('tokens only: no hex or rgb() colour in declarations', () => {
  const decls = CSS.replace(/[^{}]*\{/g, '{') // drop selectors (inline-style matches name hex without '#')
  assert.doesNotMatch(decls, /#[0-9a-f]{3,8}\b/i)
  assert.doesNotMatch(decls, /\brgba?\(/i)
  assert.doesNotMatch(CSS, /'#[0-9a-f]{3,8}/i, 'match inline colours without the #')
})
