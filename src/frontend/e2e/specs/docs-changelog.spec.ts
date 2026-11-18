/**
 * Changelog page (fixtures/docs-site/docs/changelog.md): <Update> entries with anchors in
 * "On this page", the tag filter kept in ?tags=, and the RSS feed (front matter `rss: true`).
 * docs/DocsUpdate.tsx draws them; compiler/changelog.py writes the feed.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

for (const mode of ['light', 'dark'] as const) {
  test(`changelog entries, tag filter and feed (${mode}, 390 px)`, async ({ page, request }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/docs/changelog')
    const article = page.locator('#main-content article').first()
    await expect(article.getByRole('heading', { name: '2026-11-18', level: 2 })).toHaveAttribute('id', '2026-11-18')
    await expect(article.locator('.aiui-update')).toHaveCount(2)

    // A tag hides the entries without it and lands in the address; All shows them again.
    const filter = page.getByRole('group', { name: 'Filter updates by tag' })
    await filter.getByRole('button', { name: 'Docs' }).click()
    await expect(filter.getByRole('button', { name: 'Docs' })).toHaveAttribute('aria-pressed', 'true')
    await expect(article.locator('.aiui-update:visible')).toHaveCount(1)
    await expect(article.getByRole('heading', { name: '2026-11-18' })).toBeHidden()
    expect(new URL(page.url()).searchParams.get('tags')).toBe('Docs')
    await filter.getByRole('button', { name: 'All' }).click()
    await expect(article.locator('.aiui-update:visible')).toHaveCount(2)
    expect(page.url()).not.toContain('tags=')

    // ?tags= in a shared link applies on load.
    await page.goto('/docs/changelog?tags=API')
    await expect(article.locator('.aiui-update:visible')).toHaveCount(1)
    await expect(article.getByRole('heading', { name: '2026-11-18' })).toBeVisible()

    // The feed: linked from the filter row and the static head, served as XML.
    const feed = filter.getByRole('link', { name: 'RSS feed' })
    await expect(feed).toHaveAttribute('href', '/docs/changelog/rss.xml')
    const html = await (await request.get('/docs/changelog')).text()
    expect(html).toMatch(/<link rel="alternate" type="application\/rss\+xml" title="Changelog \| AIUI e2e docs" href="[^"]*\/docs\/changelog\/rss\.xml" \/>/)
    const xml = await (await request.get('/docs/changelog/rss.xml')).text()
    expect(xml).toContain('<title>2026-11-18: v1.2</title>')
    expect(xml).toContain('<category>Docs</category>')

    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors).toEqual({ pageErrors: [], consoleErrors: [] })
  })
}
