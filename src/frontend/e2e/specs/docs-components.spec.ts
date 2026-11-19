/**
 * The site's own React components as page tags (site.components, fixtures/docs-site/components/index.js):
 * the module loads only on a page that uses one of its tags, under the site's CSP; a component
 * registered with registerBlock and one exported under the tag's name both render with typed props,
 * Markdown children and the site's React (hooks work); one that throws shows the tag's body.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

for (const mode of ['light', 'dark'] as const) {
  test(`site components render on the page that uses them (${mode}, 390 px)`, async ({ page }) => {
    const errors = collectPageErrors(page)
    const violations: string[] = []
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()) })
    const modules: string[] = []
    page.on('request', (r) => { if (/\/components\/index\.js/.test(r.url())) modules.push(r.url()) })
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 390, height: 844 })

    // A page without a site tag never downloads the module.
    await page.goto('/docs/widgets')
    await expect(page.getByRole('heading', { name: 'Widgets', level: 1 })).toBeVisible()
    expect(modules).toEqual([])

    await page.goto('/docs/components')
    const article = page.locator('#main-content article').first()
    const counter = article.getByTestId('counter')
    await expect(counter.getByRole('button')).toHaveText('Clicks 2') // start={2} is a number
    await counter.getByRole('button').click()
    await expect(counter.getByRole('button')).toHaveText('Clicks 3')
    await expect(counter.getByTestId('counter-body').locator('strong, [data-streamdown="strong"]')).toHaveText('fallback')

    // Inline, in its sentence, props as values; the named export was registered for the tag.
    await expect(article.getByTestId('price')).toHaveText('$9 (pro, team)')
    await expect(article.locator('p', { has: page.getByTestId('price') })).toContainText('Plans from $9 (pro, team) a month.')

    // A component that throws falls back to the tag's own body; the rest of the page lives on.
    await expect(article.getByText('Shown when the component throws.')).toBeVisible()
    expect(modules).toHaveLength(1)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(violations).toEqual([])
    expect(errors.pageErrors).toEqual([])
  })
}
