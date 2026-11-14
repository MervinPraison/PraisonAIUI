/**
 * The markdown renderer on a built docs site (`aiui build` + `aiui serve`,
 * fixtures/docs-site): code highlighting, tables, math, diagrams and MkDocs
 * blocks, in light, dark and at phone width.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, setColorMode, toRgb } from './support'

const VARIANTS = [
  { name: 'light', mode: 'light', viewport: { width: 1280, height: 800 } },
  { name: 'dark', mode: 'dark', viewport: { width: 1280, height: 800 } },
  { name: 'phone', mode: 'dark', viewport: { width: 390, height: 844 } },
] as const

for (const variant of VARIANTS) {
  test(`docs markdown renders (${variant.name})`, async ({ page }, testInfo) => {
    const errors = collectPageErrors(page)
    await page.setViewportSize(variant.viewport)
    await setColorMode(page, variant.mode)
    await page.goto('/docs/markdown')

    const article = page.locator('#main-content')
    await expect(article.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(variant.mode === 'dark')

    // Code: Shiki tokens carry the light colour inline and the dark one as a
    // variable; the theme decides which one paints.
    const token = article.locator('[data-streamdown="code-block"] span[style*="--shiki-dark"]', { hasText: 'def' }).first()
    await expect(token).toBeVisible()
    const colours = await token.evaluate((el) => ({
      painted: getComputedStyle(el).color,
      dark: (el as HTMLElement).style.getPropertyValue('--shiki-dark'),
    }))
    const painted = await toRgb(page, colours.painted)
    const darkColour = await toRgb(page, colours.dark)
    if (variant.mode === 'dark') expect(painted, `dark token colour ${JSON.stringify(colours)}`).toBe(darkColour)
    else expect(painted, `light token colour ${JSON.stringify(colours)}`).not.toBe(darkColour)

    // Table, math, diagram, MkDocs admonition.
    await expect(article.getByRole('table')).toContainText('alpha-large-preview')
    await expect(article.locator('.katex').first()).toBeVisible()
    // Diagrams render when they scroll into view.
    await article.getByRole('heading', { name: 'Diagram' }).scrollIntoViewIfNeeded()
    const diagram = article.locator('svg[aria-roledescription^="flowchart"]')
    await expect(diagram).toBeVisible({ timeout: 30_000 })
    await expect(diagram).toContainText('Start')
    await expect(article.getByRole('note', { name: 'Heads up' })).toContainText('MkDocs admonitions are rendered too.')
    // Markdown source must not leak through.
    await expect(article).not.toContainText('```')
    await expect(article).not.toContainText('!!! note')

    // Wide code and tables scroll inside their own box, never the page.
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(widths.scroll, `page width at ${variant.viewport.width}px`).toBe(widths.client)
    expect(widths.client).toBe(variant.viewport.width)

    await testInfo.attach(`docs-markdown-${variant.name}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    expect(errors.pageErrors).toEqual([])
  })
}

test('the built site cache-busts its fixed-name entry files', async ({ request }) => {
  // index.js and index.css keep their names between releases; `aiui build`
  // must give them a content hash in the URL (their chunks are hashed already).
  const html = await (await request.get('/docs/markdown')).text()
  const js = html.match(/src="(\/assets\/index\.js\?v=[0-9a-f]{10})"/)
  const css = html.match(/href="(\/assets\/index\.css\?v=[0-9a-f]{10})"/)
  expect(js, 'index.js?v=<hash> in the page').not.toBeNull()
  expect(css, 'index.css?v=<hash> in the page').not.toBeNull()
  expect((await request.get(js![1])).ok()).toBe(true)
  expect((await request.get(css![1])).ok()).toBe(true)
})

test('navigating between docs pages keeps the app loaded once', async ({ page }) => {
  const errors = collectPageErrors(page)
  const entryLoads: string[] = []
  page.on('request', (r) => {
    if (/\/assets\/index\.js(\?|$)/.test(r.url())) entryLoads.push(r.url())
  })
  await page.goto('/docs')
  await page.getByRole('link', { name: 'Markdown sample' }).first().click()
  await expect(page).toHaveURL(/\/docs\/markdown$/)
  await expect(page.locator('#main-content svg[aria-roledescription^="flowchart"]')).toBeVisible({ timeout: 30_000 })
  // The entry is one module URL: a chunk importing "./index.js" would run it twice.
  expect(entryLoads).toHaveLength(1)
  expect(errors.pageErrors).toEqual([])
})
