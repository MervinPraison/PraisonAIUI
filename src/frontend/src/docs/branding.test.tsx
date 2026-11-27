// Docs header branding: a logo per mode (both rendered, CSS shows one), a logo
// link to another site, and site.theme.strict (no theme toggle).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Header } from '../Header'
import { LocaleProvider } from '../i18n'
import { isAppPath } from './chrome'
import type { UIConfig } from '../types'

const render = (config: Partial<UIConfig>) =>
    renderToStaticMarkup(<LocaleProvider><Header config={{ site: { title: 'Acme' }, ...config } as UIConfig} /></LocaleProvider>)

test('logo.light and logo.dark both render, marked by mode, so a theme switch swaps them', () => {
    const html = render({ logo: { light: '/l.svg', dark: '/d.svg', href: '/' } })
    assert.match(html, /<img src="\/l.svg"[^>]*data-mode="light"/)
    assert.match(html, /<img src="\/d.svg"[^>]*data-mode="dark"/)
})

test('one logo renders once', () => {
    const html = render({ logo: { light: '/l.svg', dark: '/l.svg', href: '/' } })
    assert.equal(html.match(/<img /g)?.length, 1)
    assert.doesNotMatch(html, /data-mode=/)
})

test('a logo href on another site is a plain link, not in-app navigation', () => {
    assert.equal(isAppPath('/docs'), true)
    for (const href of ['https://acme.dev', '//acme.dev', 'mailto:a@acme.dev']) assert.equal(isAppPath(href), false)
    const html = render({ logo: { light: '/l.svg', href: 'https://acme.dev' } })
    assert.match(html, /class="aiui-docs-brand" href="https:\/\/acme.dev"|href="https:\/\/acme.dev"[^>]*class="aiui-docs-brand"/)
})

test('site.theme.strict hides the theme toggle', () => {
    assert.match(render({}), /aria-label="Toggle theme"/)
    assert.doesNotMatch(render({ site: { title: 'Acme', theme: { strict: true } } }), /aria-label="Toggle theme"/)
})

test('site.theme.toggle defaults to 1-click switch and supports 3-option menu', () => {
    const def = render({})
    assert.match(def, /data-aiui-theme-toggle="switch"/)
    assert.doesNotMatch(def, /aria-haspopup="menu"/)

    const menu = render({ site: { title: 'Acme', theme: { toggle: 'menu' } } })
    assert.match(menu, /data-aiui-theme-toggle="menu"/)
    assert.match(menu, /aria-haspopup="menu"/)
})
