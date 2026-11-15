// The layout thread's stylesheets (loaded with the presentation host only):
// the scrolled-under fade at the top of the viewport and the composer rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(process.cwd(), 'src/chat-engine/presentation')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8')

test('the host loads the viewport stylesheet: a 20px top fade and room above the first message', () => {
  assert.match(read('host.tsx'), /import '\.\/viewport\.css'/)
  const css = read('viewport.css')
  assert.match(css, /\[data-variant\] \[data-aiui-thread\]/, 'scoped to a layout thread')
  assert.match(css, /mask-image: linear-gradient\(to bottom, transparent 0, #000 20px\)/)
  assert.match(css, /padding-top: 12px/)
})

test('composer.css: muted disabled Send, the key hint only while focused and empty, off after the sends', () => {
  const css = read('composer.css')
  assert.match(css, /\[aria-label='Send'\]:disabled \{\s*background: var\(--muted\);\s*color: var\(--muted-foreground\);/)
  assert.match(css, /textarea\[aria-label='Message'\]:focus:placeholder-shown\) \+ p \{\s*display: flex;/)
  assert.match(css, /\[data-composer-hint='off'\] form/)
  for (const rule of css.split('}')) {
    if (rule.trim()) assert.match(rule, /\[data-variant\]|\[data-composer-model\]|@media/, 'every rule is layout-scoped')
  }
})
