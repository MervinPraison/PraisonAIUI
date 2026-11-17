// Docs home page layout (frontmatter `layout: home`): hero, actions, light/dark image, features.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocsHome } from './DocsHome'

const home = {
    hero: {
        name: 'Acme',
        text: 'Ship faster',
        tagline: 'The tagline.',
        image: 'images/shot.webp',
        imageDark: 'images/shot-dark.webp',
        imageAlt: 'The app',
        actions: [
            { text: 'Start', link: 'guide/start.md', theme: 'brand' as const },
            { text: 'GitHub', link: 'https://github.com/acme', theme: 'alt' as const },
        ],
    },
    features: [
        { title: 'Fast', details: 'Very.', icon: 'zap', link: 'guide/fast.md', linkText: 'Read' },
        { title: 'Plain', icon: 'not-an-icon' },
    ],
}

test('the hero, actions and features render; unknown icons are left out', () => {
    const html = renderToStaticMarkup(<DocsHome home={home} homePath="/docs/index" onNavigate={() => {}} />)
    assert.match(html, /<h1 class="aiui-docs-hero-name">Acme<\/h1>/)
    assert.match(html, /Ship faster/)
    assert.match(html, /href="\/docs\/guide\/start"/)
    assert.match(html, /href="https:\/\/github.com\/acme" target="_blank" rel="noopener noreferrer"/)
    assert.match(html, /src="\/docs\/images\/shot.webp"[^>]*data-theme="light"|data-theme="light"[^>]*src="\/docs\/images\/shot.webp"/)
    assert.match(html, /data-theme="dark"/)
    assert.match(html, /href="\/docs\/guide\/fast"[^>]*>Read/)
    assert.equal((html.match(/aiui-docs-feature-icon/g) ?? []).length, 1)
})

test('the hero image for the mode on screen loads first; the hidden one waits', () => {
    // Server render: no document, so the light image is the one on screen.
    const html = renderToStaticMarkup(<DocsHome home={home} homePath="/docs/index" onNavigate={() => {}} />)
    const light = html.match(/<img[^>]*data-theme="light"[^>]*>/)?.[0] ?? ''
    const dark = html.match(/<img[^>]*data-theme="dark"[^>]*>/)?.[0] ?? ''
    assert.match(light, /fetchpriority="high"/i)
    assert.doesNotMatch(light, /loading="lazy"/)
    assert.match(dark, /loading="lazy"/)
})

test('an empty home renders no hero parts', () => {
    const html = renderToStaticMarkup(<DocsHome home={{}} homePath="/docs/index" onNavigate={() => {}} />)
    assert.doesNotMatch(html, /<h1|<img|aiui-docs-features/)
})
