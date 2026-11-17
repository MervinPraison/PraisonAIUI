// The Paper look (styles/paper.css): scoped to the look, self-hosted fonts, and the
// palette's text pairs at WCAG AA in light and dark.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')
const css = read('styles/paper.css')

/** The custom properties of the first rule whose selector list starts with `head`. */
function palette(head: string): Record<string, string> {
  const at = css.indexOf(head)
  assert.ok(at >= 0, `no rule ${head}`)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const LOOK = 'html:is([data-aiui-shell="react"], [data-aiui-docs])[data-aiui-tokens="pro"][data-aiui-look="paper"]'
const light = palette(`${LOOK} {`)
const dark = { ...light, ...palette(`${LOOK}.dark,`) }

function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('every rule is scoped to the Paper look under the Pro tokens; no remote URL', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...bare.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((sel) => !sel.startsWith('@'))
  assert.ok(selectors.length >= 5)
  for (const sel of selectors) {
    for (const part of sel.split(/,(?![^(]*\))/)) assert.match(part, /\[data-aiui-tokens="pro"\]\[data-aiui-look="paper"\]/, part)
  }
  assert.doesNotMatch(css, /https?:\/\//)
})

test('the three faces come from @fontsource-variable, latin woff2, swap; only the layout host loads them', () => {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? []
  assert.deepEqual(
    faces.map((f) => f.match(/font-family:\s*'([^']+)'/)?.[1]),
    ['Newsreader', 'Source Sans 3', 'JetBrains Mono'],
  )
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/)
    assert.match(face, /url\('@fontsource-variable\/[\w-]+\/files\/[\w-]+-latin-wght-normal\.woff2'\)/)
  }
  assert.match(read('shell/LayoutHost.tsx'), /import '@\/styles\/paper\.css'/)
  for (const shared of ['index.css', 'styles/theme.css', 'styles/pro.css', 'styles/fonts.css']) {
    assert.doesNotMatch(read(shared), /paper\.css|Newsreader|Source Sans 3/, shared)
  }
  assert.match(read('builtin/layouts/chat-canvas.ts'), /look: 'paper'/)
})

test('text tiers, accent, link and status colours reach WCAG AA (4.5:1) on the surfaces they sit on', () => {
  for (const [mode, p] of [['light', light], ['dark', dark]] as const) {
    const surfaces = ['--pro-background', '--pro-card', '--pro-sidebar', '--pro-muted', '--pro-code-bg', '--paper-bubble', '--paper-panel-head']
    const pairs: [string, string][] = []
    for (const text of ['--pro-foreground', '--pro-muted-fg', '--pro-subtle']) for (const s of surfaces) pairs.push([text, s])
    // The row-active fill carries the ink and the second tier (text3 there is 4.31:1 in light mode, so nothing uses it).
    pairs.push(['--pro-foreground', '--pro-sidebar-accent'], ['--pro-sidebar-fg', '--pro-sidebar-accent'], ['--pro-sidebar-fg', '--pro-sidebar'])
    pairs.push(['--pro-success', '--pro-success-soft'], ['--pro-warning', '--pro-warning-soft'], ['--pro-danger', '--pro-danger-soft'])
    pairs.push(['--pro-danger', '--pro-background'], ['--pro-danger', '--pro-card'])
    const seed = (role: string) => `--seed-pro-${role}-${mode}`
    pairs.push([seed('accent-fg'), seed('accent')], [seed('link'), '--pro-background'], [seed('link'), '--pro-card'], [seed('link'), seed('soft')])
    for (const [fg, bg] of pairs) {
      const ratio = contrast(p[fg], p[bg])
      assert.ok(ratio >= 4.5, `${mode}: ${fg} ${p[fg]} on ${bg} ${p[bg]} is ${ratio.toFixed(2)}:1`)
    }
  }
})
