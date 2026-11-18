/**
 * API reference components on a built docs page (fixtures/docs-site/docs/api-fields.md):
 * <ParamField> / <ResponseField> rows with anchors, nested <Expandable>, and
 * <RequestExample> / <ResponseExample> in a sticky side column that takes the
 * place of "On this page" on wide screens and follows the article on phones.
 * docs/ApiFields.tsx, docs/panels.ts and Content.tsx draw them.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

for (const mode of ['light', 'dark'] as const) {
  test(`API fields (${mode}): rows, nested properties, sticky examples column`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/docs/api-fields')
    const article = page.locator('#main-content article').first()
    await expect(page.getByRole('heading', { name: 'API fields', level: 1 })).toBeVisible()

    // A parameter row: name, type, location and required pills; the name links to its anchor.
    const userId = article.locator('#param-user_id')
    await expect(userId.locator('.aiui-field-name')).toHaveText('user_id')
    await expect(userId.locator('.aiui-field-name')).toHaveAttribute('href', '#param-user_id')
    await expect(userId.locator('.aiui-field-head')).toContainText('string')
    await expect(userId.locator('.aiui-field-pill')).toHaveText(['path', 'required'])
    const required = userId.locator('[data-tone="required"]')
    const [pill, page_] = await Promise.all([
      required.evaluate((e) => getComputedStyle(e).backgroundColor),
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ])
    expect(pill).not.toBe(page_) // a tinted pill, from the theme's danger token
    await expect(article.locator('#param-tags .aiui-field-pill')).toHaveText(['beta', 'query', 'v2'])
    await expect(article.locator('#param-tags .aiui-field-default')).toHaveText('default: all')
    await expect(article.locator('#param-x-legacy-key [data-tone="deprecated"]')).toBeVisible()

    // Nested properties: closed until asked, then the nested rows show.
    const nested = article.locator('#response-user > .aiui-field-body > details.aiui-expandable')
    const summary = nested.locator('> summary')
    await expect(summary).toHaveText('Show user properties', { useInnerText: true })
    await expect(article.locator('#response-user-name')).toBeHidden()
    await summary.click()
    await expect(summary).toHaveText('Hide user properties', { useInnerText: true })
    await expect(article.locator('#response-user-name')).toBeVisible()

    // Examples: one side column where "On this page" sat, to the right of the article, sticky.
    const side = page.locator('aside.aiui-docs-panel')
    await expect(page.locator('.aiui-docs-toc')).toBeHidden()
    const [main, panel] = await Promise.all([article.boundingBox(), side.boundingBox()])
    expect(panel!.x).toBeGreaterThanOrEqual(main!.x + main!.width)
    await expect(side.getByRole('region', { name: 'Request example' }).getByRole('tab')).toHaveText(['cURL', 'Python'])
    await expect(article).not.toContainText('curl https://api.example.com')
    const top = panel!.y
    await page.mouse.wheel(0, 900)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
    expect(Math.abs((await side.boundingBox())!.y - top)).toBeLessThan(80) // stays in view

    // The response example picks its status from a menu (dropdown).
    const response = side.getByRole('region', { name: 'Response example' })
    await expect(response.locator('.aiui-tabs-panel:visible')).toContainText('"Ada"')
    await response.getByRole('combobox', { name: 'Choose a code sample' }).click()
    await page.getByRole('option', { name: '404' }).click()
    await expect(response.locator('.aiui-tabs-panel:visible')).toContainText('not_found')
    expect(errors.pageErrors).toEqual([])
  })
}

test('a deep link to a nested field opens its Expandable and scrolls to it', async ({ page }) => {
  await page.goto('/docs/api-fields#response-user-address-city')
  const city = page.locator('#response-user-address-city')
  await expect(city).toBeVisible()
  await expect(city).toContainText('City name in the nested address.')
  await expect(city).toBeInViewport()
})

test('API fields at 390 px: examples follow the article, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/api-fields')
  const article = page.locator('#main-content article').first()
  await expect(article.locator('#param-user_id')).toBeVisible()
  const side = page.locator('aside.aiui-docs-panel')
  await side.scrollIntoViewIfNeeded()
  const [main, panel] = await Promise.all([article.boundingBox(), side.boundingBox()])
  expect(panel!.y).toBeGreaterThanOrEqual(main!.y + main!.height)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})
