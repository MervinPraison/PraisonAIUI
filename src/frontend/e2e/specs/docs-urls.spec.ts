/**
 * URLs that name a docs page another way still show it, under its own URL
 * (src/docs/docSource.ts canonicalDocPath, src/docs/navMatch.ts, the legacy
 * nav-intercept plugin): the home page's sidebar link, `.html` file URLs and
 * wrong-case URLs.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors } from './support'

const heading = (name: string) => ({ name, level: 1 } as const)

test('the sidebar link to the home page goes to the site root, not /docs/index', async ({ page }) => {
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', heading('First page'))).toBeVisible()
  await page.locator('aside a[data-nav-path="/docs/index"]').first().click()
  await expect(page.getByRole('heading', heading('Home'))).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(new URL(page.url()).pathname).toBe('/')
})

for (const url of ['/docs/guide/first.html', '/docs/guide/first/index.html']) {
  test(`${url} shows the page and moves to its own URL`, async ({ page }) => {
    const errors = collectPageErrors(page)
    const sources: string[] = []
    page.on('request', (r) => { if (r.url().includes('.source.md')) sources.push(new URL(r.url()).pathname) })
    await page.goto(url)
    await expect(page.getByRole('heading', heading('First page'))).toBeVisible()
    await expect(page.getByText(/not found/i)).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).pathname).toBe('/docs/guide/first')
    expect(sources.filter((s) => s.includes('.html'))).toEqual([])
    // A replace, not a push: Back leaves the site instead of showing the .html URL again.
    expect(await page.evaluate(() => history.length)).toBe(2)
    expect(errors.pageErrors).toEqual([])
  })
}

test('a wrong-case URL shows the page and moves to its own URL', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/Guide/FIRST')
  await expect(page.getByRole('heading', heading('First page'))).toBeVisible()
  await expect(page.getByText(/not found/i)).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/docs/guide/first')
  expect(errors.pageErrors).toEqual([])
})
