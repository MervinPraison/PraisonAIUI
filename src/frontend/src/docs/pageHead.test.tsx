// Page frontmatter in the browser: title and lede, modes, meta attributes, icons, sidebar links and badges, pager.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { metaAttributes, modeHidesToc, modeIsBare, withPageHead } from './pageHead'
import { docsIcon } from './docsHomeIcons'
import { docNeighbours } from './docNav'
import { NavTree } from '../Sidebar'

test('withPageHead adds the frontmatter title when the body has no # title', () => {
    assert.equal(withPageHead('Body.\n', { title: 'Start', pageTitle: 'Getting started' }), '# Getting started\n\nBody.\n')
})

test('withPageHead puts the description under the title as plain text', () => {
    const item = { title: 'T', description: 'Use *this* <b>now</b>', lede: true }
    assert.equal(withPageHead('Body.', item), '# T\n\nUse \\*this\\* \\<b\\>now\\</b\\>\n\nBody.')
    assert.equal(
        withPageHead('```\n# not a title\n```\n# Real\n\nText', item),
        '```\n# not a title\n```\n# Real\n\nUse \\*this\\* \\<b\\>now\\</b\\>\n\nText',
    )
})

test('withPageHead leaves a page that has its title, or already opens with the description', () => {
    assert.equal(withPageHead('# T\n\nIntro', { title: 'T', description: 'auto', lede: false }), '# T\n\nIntro')
    const md = '# T\n\nInstall it and run it. More here.'
    assert.equal(withPageHead(md, { title: 'T', description: 'Install it and run it.', lede: true }), md)
})

test('modes: which drop the TOC and which the chrome', () => {
    assert.deepEqual([undefined, 'wide', 'center', 'custom', 'frame'].map((m) => modeHidesToc(m)), [false, true, true, true, true])
    assert.deepEqual(['wide', 'center', 'custom', 'frame'].map(modeIsBare), [false, false, true, true])
})

test('custom keys become data attributes', () => {
    assert.deepEqual(metaAttributes({ product: 'cloud', productVersion: 2, beta_flag: true }), {
        'data-fm-product': 'cloud',
        'data-fm-product-version': '2',
        'data-fm-beta-flag': 'true',
    })
    assert.deepEqual(metaAttributes(undefined), {})
})

test('docsIcon draws a lucide name, an emoji or an image URL; nothing for an unknown name', () => {
    assert.ok(isValidElement(docsIcon('rocket')))
    assert.equal(docsIcon('no-such-icon'), null)
    const img = docsIcon('https://cdn.example.com/a.svg')
    assert.equal(img?.type, 'img')
    assert.equal((img?.props as { src: string }).src, 'https://cdn.example.com/a.svg')
    assert.equal(docsIcon('🚀')?.type, 'span')
})

const nav = {
    items: [
        { title: 'A', path: '/docs/a', tag: 'NEW', icon: '⚡' },
        { title: 'GitHub', href: 'https://github.com/acme' },
        { title: 'Secret', path: '/docs/s', hidden: true },
        { title: 'Old', path: '/docs/old', deprecated: true },
        { title: 'B', path: '/docs/b' },
    ],
}

test('the sidebar opens an external link in a new tab and shows badges', () => {
    const html = renderToStaticMarkup(<NavTree nav={nav} activeItem="/docs/a" onItemClick={() => {}} />)
    assert.match(html, /<a href="https:\/\/github.com\/acme" class="aiui-docs-navitem"[^>]*target="_blank" rel="noopener noreferrer">/)
    assert.match(html, /opens in a new tab/)
    assert.match(html, /<span class="aiui-docs-navtag">NEW<\/span>/)
    assert.match(html, /data-deprecated=""[^>]*>.*?Old<\/span><span class="aiui-docs-navtag">Deprecated<\/span>/)
    assert.match(html, /<span class="aiui-docs-navicon"><span aria-hidden="true">⚡<\/span><\/span>/)
    assert.doesNotMatch(html, /Secret/)
})

test('the pager skips hidden pages and links that are not pages', () => {
    assert.equal(docNeighbours(nav, '/docs/a').next?.path, '/docs/old')
    assert.equal(docNeighbours(nav, '/docs/old').prev?.path, '/docs/a')
})
