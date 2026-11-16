// The self-hosted Pro fonts (styles/fonts.css, DESIGN.md "Type, spacing, radius").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

test('fonts.css serves Geist and Geist Mono from the packages: latin woff2, swap, no remote URL', () => {
  const css = read('styles/fonts.css')
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? []
  assert.equal(faces.length, 2)
  const families = faces.map((f) => f.match(/font-family:\s*'([^']+)'/)?.[1])
  assert.deepEqual(families, ['Geist', 'Geist Mono'])
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/)
    const urls = [...face.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1])
    assert.equal(urls.length, 1)
    assert.match(urls[0], /^@fontsource-variable\/geist(-mono)?\/files\/geist(-mono)?-latin-wght-normal\.woff2$/)
  }
  assert.doesNotMatch(css, /https?:\/\//)
})

test('only the Pro token system names the families, and index.css never loads them', () => {
  const pro = read('styles/pro.css')
  assert.match(pro, /--aiui-font-sans: "Geist",/)
  assert.match(pro, /--aiui-font-mono: "Geist Mono",/)
  assert.doesNotMatch(read('index.css'), /fonts\.css|Geist/)
  assert.doesNotMatch(read('styles/theme.css'), /Geist/)
  assert.match(read('shell/LayoutHost.tsx'), /import '@\/styles\/fonts\.css'/)
  assert.match(read('docs/docs.css'), /@import '\.\.\/styles\/fonts\.css';/)
})
