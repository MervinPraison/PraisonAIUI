// SidebarBrand (shell/Sidebar.tsx): the classic frame's brand. No logo (the
// default) is the PraisonAI glyph on the accent tile; a configured logo wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ShellManifest } from '@/sdk/manifest'
import { SidebarBrand } from '@/shell/Sidebar'

const brand = (site: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(SidebarBrand, { manifest: { sdk: 1, site, pages: [] } as unknown as ShellManifest }))

test('no logo draws the PraisonAI glyph on the accent tile, not an emoji', () => {
  for (const site of [{ title: 'PraisonAI' }, { title: 'PraisonAI', logo: '' }]) {
    const out = brand(site)
    assert.match(out, /<span aria-hidden="true" class="[^"]*bg-primary text-primary-foreground"><svg viewBox="0 0 24 24"[^>]*><path d="M8 19V5h5/)
    assert.doesNotMatch(out, /\p{Extended_Pictographic}/u)
    assert.match(out, />PraisonAI</)
  }
})

test('a configured logo replaces the glyph: an image path, or a short text mark', () => {
  const img = brand({ title: 'Acme', logo: '/static/logo.svg' })
  assert.match(img, /<img src="\/static\/logo.svg" alt=""/)
  assert.doesNotMatch(img, /bg-primary/)
  const text = brand({ title: 'Acme', logo: 'AC' })
  assert.match(text, />AC</)
  assert.doesNotMatch(text, /bg-primary/)
})
