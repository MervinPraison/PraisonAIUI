// A URL with no page: "Page not found" with a way home and to search; never the config dump.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocsNotFound } from './DocsNotFound'

const config = { site: { title: 'Acme', description: 'Docs for Acme.' } }

test('an unknown path: Page not found, home link, search when offered', () => {
    const html = renderToStaticMarkup(<DocsNotFound config={config} path="/docs/nope" onSearch={() => {}} />)
    assert.match(html, /<h1[^>]*>Page not found<\/h1>/)
    assert.match(html, /\/docs\/nope/)
    assert.match(html, /<a[^>]*href="\/"[^>]*>Go to the home page<\/a>/)
    assert.match(html, /Search the docs/)
    assert.doesNotMatch(html, /Theme Configuration|Available Presets/)
})

test('no search button without search', () => {
    const html = renderToStaticMarkup(<DocsNotFound config={config} path="/docs/nope" />)
    assert.doesNotMatch(html, /Search the docs/)
})

test('the root of a site without a home page shows its name, not a 404', () => {
    const html = renderToStaticMarkup(<DocsNotFound config={config} path="/" />)
    assert.match(html, /<h1[^>]*>Acme<\/h1>/)
    assert.match(html, /Docs for Acme\./)
    assert.doesNotMatch(html, /Page not found/)
})
