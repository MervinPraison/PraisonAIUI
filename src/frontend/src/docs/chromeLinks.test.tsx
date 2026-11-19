// Docs chrome: header links with icons and network types, the GitHub star
// count, footer socials, and the dismissible banner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Header } from '../Header'
import { Footer } from '../Footer'
import { LocaleProvider } from '../i18n'
import type { NavbarLinkConfig, UIConfig } from '../types'
import { socialOf } from './socials'
import { docsChromeModel } from './chrome'
import { cachedStars, formatStars, githubStars, repoOf } from './githubStars'
import { DocsBanner } from './DocsBanner'

/** The Storage calls these modules make (getItem, setItem). */
function memoryStorage(seed: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(seed))
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage
}

test('a social resolves by key, alias, then URL host; anything else is a globe with its key', () => {
    assert.deepEqual(socialOf('bluesky', 'https://bsky.app/profile/acme'), { network: 'bluesky', label: 'Bluesky' })
    assert.deepEqual(socialOf('Twitter', 'https://twitter.com/acme'), { network: 'x', label: 'X' })
    assert.deepEqual(socialOf('community', 'https://discord.gg/acme'), { network: 'discord', label: 'Discord' })
    assert.deepEqual(socialOf('code', 'https://www.github.com/acme'), { network: 'github', label: 'GitHub' })
    assert.deepEqual(socialOf('contact', 'mailto:hi@acme.dev'), { network: 'email', label: 'contact' })
    assert.deepEqual(socialOf('Status', 'https://status.acme.dev'), { network: '', label: 'Status' })
})

test('the footer draws headerless columns and socials, not text labels', () => {
    const socials = { github: 'https://github.com/acme', blog: 'https://acme.dev/blog', empty: '' }
    const links = [{ items: [{ label: 'Status', href: 'https://status.acme.dev' }] }]
    const html = renderToStaticMarkup(<Footer config={{ site: { title: 'Acme' }, footer: { socials, links } }} />)
    assert.match(html, />Status<\/a>/)
    assert.doesNotMatch(html, /<h2>/)
    assert.match(html, /<ul class="aiui-docs-socials" aria-label="Social links"><li><a href="https:\/\/github.com\/acme" aria-label="GitHub" title="GitHub" target="_blank" rel="noopener noreferrer"><svg/)
    assert.match(html, /aria-label="blog"/)
    assert.equal((html.match(/<li>/g) ?? []).length, 3) // the column's link and two socials (an empty URL is skipped)
    assert.doesNotMatch(html, />GitHub</)
})

test('navbar links: icon and label, or a typed link as its mark alone', () => {
    const links: NavbarLinkConfig[] = [
        { label: 'Blog', href: '/blog', icon: 'newspaper' },
        { type: 'discord', href: 'https://discord.gg/acme' },
        { type: 'github', label: 'Source', href: 'https://github.com/acme/app' },
    ]
    const config: UIConfig = { site: { title: 'Acme' }, navbar: { links, primary: { type: 'github', href: 'https://github.com/acme/app' } } }
    const model = docsChromeModel(config)
    assert.deepEqual(
        model.links.map((l) => [l.label, l.network, l.iconOnly]),
        [['Blog', undefined, false], ['Discord', 'discord', true], ['Source', 'github', false]],
    )
    assert.equal(model.primary?.label, 'GitHub')
    assert.equal(model.primary?.stars, 'https://github.com/acme/app')

    const html = renderToStaticMarkup(<LocaleProvider><Header config={config} /></LocaleProvider>)
    assert.match(html, /<a href="https:\/\/discord.gg\/acme" class="aiui-docs-navlink" data-icon-only="true" aria-label="Discord" title="Discord" target="_blank"/)
    assert.match(html, /class="aiui-docs-navlink"><svg[^>]*class="aiui-docs-linkicon"[\s\S]*?<\/svg>Blog<\/a>/)
    assert.match(html, /aiui-docs-cta[\s\S]*?<svg[\s\S]*?GitHub<\/a>/)

    const plain = docsChromeModel({ navbar: { primary: { href: '/start' } } })
    assert.equal(plain.primary?.label, 'Get started')
    assert.equal(plain.primary?.stars, undefined)
})

test('repoOf takes a repository URL only', () => {
    for (const url of ['https://github.com/acme/app', 'https://github.com/acme/app.git', 'https://github.com/acme/app/']) assert.equal(repoOf(url), 'acme/app')
    for (const url of ['https://github.com/acme', 'https://github.com/acme/app/tree/main', 'https://gitlab.com/acme/app']) assert.equal(repoOf(url), null)
})

test('star counts: one request per repo, then the cache for six hours, failures too', async () => {
    const storage = memoryStorage()
    let calls = 0
    const ok = (async () => {
        calls += 1
        return new Response(JSON.stringify({ stargazers_count: 12345 }), { status: 200 })
    }) as typeof fetch
    const now = 1_000_000
    const both = await Promise.all([githubStars('acme/app', storage, ok, now), githubStars('acme/app', storage, ok, now)])
    assert.deepEqual([both, calls], [[12345, 12345], 1])
    assert.equal(await githubStars('acme/app', storage, ok, now + 60_000), 12345)
    assert.equal(calls, 1)
    assert.equal(cachedStars('acme/app', storage, now + 7 * 3600_000), undefined)

    const down = (async () => new Response('', { status: 403 })) as typeof fetch
    assert.equal(await githubStars('acme/other', storage, down, now), null)
    assert.equal(cachedStars('acme/other', storage, now + 1000), null)

    assert.equal(formatStars(950), '950')
    assert.equal(formatStars(1234), '1.2k')
})

test('the banner: Markdown content in its tone, a close button when dismissible', () => {
    const html = renderToStaticMarkup(
        <DocsBanner banner={{ id: 'abc', content: 'Version 2 is out', dismissible: true, type: 'warning' }} />,
    )
    assert.match(html, /class="aiui-docs-banner" data-type="warning" role="region" aria-label="Announcement"/)
    assert.match(html, /Version 2 is out[\s\S]*aria-label="Dismiss announcement"/)
    const plain = renderToStaticMarkup(<DocsBanner banner={{ id: 'abc', content: 'Hello' }} />)
    assert.match(plain, /data-type="info"/)
    assert.doesNotMatch(plain, /Dismiss/)
    assert.equal(renderToStaticMarkup(<DocsBanner />), '')
})

test('a dismissed banner stays hidden for its content only', () => {
    const storage = memoryStorage({ 'aiui-banner-dismissed': 'abc' })
    const g = globalThis as { window?: unknown }
    const before = g.window
    g.window = { localStorage: storage }
    try {
        assert.equal(renderToStaticMarkup(<DocsBanner banner={{ id: 'abc', content: 'Old news', dismissible: true }} />), '')
        assert.match(renderToStaticMarkup(<DocsBanner banner={{ id: 'def', content: 'New news', dismissible: true }} />), /New news/)
        // Not dismissible: always shown, whatever was stored.
        assert.match(renderToStaticMarkup(<DocsBanner banner={{ id: 'abc', content: 'Old news' }} />), /Old news/)
    } finally {
        g.window = before
    }
})
