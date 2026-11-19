// Content languages (languages.ts): which language a path is in (also inside a version), the open
// language's sidebar entries, the switcher keeping the page, and the first-visit language pick.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NavDivision, NavItem, NavLanguage } from '../types'
import { autoRoute, languageAt, languageItems, languageLinks, languageName, preferredLanguage } from './languages'
import { mergeTags } from './seoMeta'

const LANGS: NavLanguage[] = [
    { language: 'en', folder: '', prefix: '/docs', default: true },
    { language: 'fr', name: 'Français', folder: 'fr', prefix: '/docs/fr' },
    { language: 'pt-BR', folder: 'pt-BR', prefix: '/docs/pt-BR' },
    { language: 'de', folder: 'de', prefix: '/docs/de', hidden: true },
]
const VERSIONS: NavDivision[] = [
    { version: 'v2', default: true, prefix: '/docs' },
    { version: 'v1', prefix: '/docs/v1' },
]
const ITEMS: NavItem[] = [
    { title: 'Home', path: '/docs/index' },
    { title: 'Guide', children: [{ title: 'Setup', path: '/docs/guide/setup' }] },
    { title: 'Only English', path: '/docs/only-en' },
    { title: 'Accueil', path: '/docs/fr' },
    { title: 'Guide', children: [{ title: 'Installation', path: '/docs/fr/guide/setup' }] },
    { title: 'Início', path: '/docs/pt-BR' },
]
const BROWSER = { languages: ['fr-CA', 'en'], webdriver: false, userAgent: 'Mozilla/5.0' }

test('languageAt: the folder after the version root, else the default; -1 with no languages', () => {
    assert.equal(languageAt(LANGS, [], '/'), 0)
    assert.equal(languageAt(LANGS, [], '/docs/guide/setup'), 0)
    assert.equal(languageAt(LANGS, [], '/docs/fr'), 1)
    assert.equal(languageAt(LANGS, [], '/docs/french'), 0)
    assert.equal(languageAt(LANGS, VERSIONS, '/docs/v1/fr/guide'), 1)
    assert.equal(languageAt(LANGS, VERSIONS, '/docs/v1/guide'), 0)
    assert.equal(languageAt([], [], '/docs/fr'), -1)
})

test('languageItems: the open language only (a group goes by its first page)', () => {
    assert.deepEqual(languageItems(ITEMS, LANGS, [], 1).map((i) => i.title), ['Accueil', 'Guide'])
    assert.deepEqual(languageItems(ITEMS, LANGS, [], 0).map((i) => i.title), ['Home', 'Guide', 'Only English'])
    assert.equal(languageItems(ITEMS, LANGS, [], -1), ITEMS)
})

test('languageLinks: the same page in each language, else its first page; a hidden one is left out', () => {
    const links = languageLinks(LANGS, [], ITEMS, '/docs/guide/setup')
    assert.deepEqual(links.map((l) => [l.name, l.lang, l.page?.path, l.active]), [
        ['English', 'en', '/docs/guide/setup', true],
        ['Français', 'fr', '/docs/fr/guide/setup', false],
        ['Português (Brasil)', 'pt-BR', '/docs/pt-BR', false],
    ])
    // The home page by either name, and back from a translation.
    assert.equal(languageLinks(LANGS, [], ITEMS, '/')[1].page?.path, '/docs/fr')
    assert.equal(languageLinks(LANGS, [], ITEMS, '/docs/fr')[0].page?.path, '/docs/index')
    assert.equal(languageLinks(LANGS, [], ITEMS, '/docs/only-en')[1].page?.path, '/docs/fr')
})

test('languageName: the configured name, else the language in its own words', () => {
    assert.equal(languageName({ language: 'fr', folder: 'fr', prefix: '', name: 'FR' }), 'FR')
    assert.equal(languageName({ language: 'de', folder: 'de', prefix: '' }), 'Deutsch')
    assert.equal(languageName({ language: 'zz', folder: 'zz', prefix: '' }), 'zz')
})

test('preferredLanguage: the reader pick, else the first browser language the docs have; never for crawlers', () => {
    assert.equal(preferredLanguage(LANGS, BROWSER, null), 1)
    assert.equal(preferredLanguage(LANGS, { ...BROWSER, languages: ['pt'] }, null), 2)
    assert.equal(preferredLanguage(LANGS, { ...BROWSER, languages: ['de-DE', 'en-US'] }, null), 0)
    assert.equal(preferredLanguage(LANGS, { ...BROWSER, languages: ['ja'] }, null), -1)
    assert.equal(preferredLanguage(LANGS, BROWSER, 'en'), 0)
    assert.equal(preferredLanguage(LANGS, { ...BROWSER, webdriver: true }, null), -1)
    assert.equal(preferredLanguage(LANGS, { ...BROWSER, userAgent: 'Googlebot/2.1' }, null), -1)
})

test('autoRoute: only from the default language home of the default version', () => {
    assert.equal(autoRoute(LANGS, [], ITEMS, '/', BROWSER, null)?.path, '/docs/fr')
    assert.equal(autoRoute(LANGS, [], ITEMS, '/docs/guide/setup', BROWSER, null), undefined)
    assert.equal(autoRoute(LANGS, [], ITEMS, '/docs/fr', { ...BROWSER, languages: ['pt-BR'] }, null), undefined)
    assert.equal(autoRoute(LANGS, [], ITEMS, '/', BROWSER, 'en'), undefined)
    assert.equal(autoRoute(LANGS, VERSIONS, ITEMS, '/docs/v1', BROWSER, null), undefined)
})

test('a translation link is made absolute like the canonical', () => {
    const tags = mergeTags({ canonical: 'https://ex.com/docs/a' }, { 'hreflang:fr': '/docs/fr/a' }, (p) => `https://ex.com${p}`)
    assert.equal(tags['hreflang:fr'], 'https://ex.com/docs/fr/a')
})
