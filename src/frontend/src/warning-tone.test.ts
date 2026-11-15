// Approval and warning surfaces in the layouts use the soft warning tokens
// (DESIGN.md "PraisonAI Pro tokens"): --ui-warning-soft for the fill,
// --ui-warning-line for the outline and --warning for the text. In dark mode
// those are amber-300 text on amber-500 at 10% / 35%; the light amber at an
// alpha (`border-warning/40`) or a solid amber label (`bg-warning
// text-warning-foreground`) turns olive-brown on the dark page.
//
// A tiny count badge (a notification number on the bell or a tab) may stay
// a solid fill; a label with words may not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'src')
const DIRS = ['app-layouts', 'layout-features', 'app-pages', 'chat-engine/presentation']

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n)
    if (statSync(full).isDirectory()) return files(full)
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [full] : []
  })
}

/** A warning colour used at an alpha (`border-warning/40`, `bg-warning/10`). */
const ALPHA_WARNING = /\b(?:border|bg|ring|text)-warning\/\d+/
/** A solid amber label: the fill and its on-colour on one element, with text in it. */
const SOLID_LABEL = /bg-warning\b[^'"`]*text-warning-foreground|text-warning-foreground[^'"`]*bg-warning\b/

test('approval and warning surfaces use the soft warning tokens', () => {
  const scanned = DIRS.flatMap((d) => files(path.join(ROOT, d)))
  assert.ok(scanned.length > 50, 'the folders were scanned')
  const hits = scanned.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .flatMap((line, i) => {
        const where = `${path.relative(ROOT, f)}:${i + 1}`
        if (ALPHA_WARNING.test(line)) return [`${where}: alpha warning ${line.trim().slice(0, 90)}`]
        // The count badge (CountBadge) is the one solid fill: a number, no words.
        if (SOLID_LABEL.test(line) && !/text-\[10px\]/.test(line)) return [`${where}: solid label ${line.trim().slice(0, 90)}`]
        return []
      }),
  )
  assert.deepEqual(hits, [])
})

test('the check catches both patterns', () => {
  assert.ok(ALPHA_WARNING.test("'rounded-xl border border-warning/40 bg-card'"))
  assert.ok(SOLID_LABEL.test("'rounded-xs bg-warning px-1.5 text-xs text-warning-foreground'"))
  assert.ok(!ALPHA_WARNING.test("'border-[var(--ui-warning-line)] bg-warning-soft text-warning'"))
  assert.ok(!SOLID_LABEL.test("'bg-warning-soft text-warning'"))
})
