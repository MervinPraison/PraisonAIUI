/**
 * A docs site built with `aiui build --base-path /sub` (a GitHub project site,
 * example.com/docs behind a proxy), served by `aiui serve` under /sub. Every
 * request stays under the base, and links, history and search keep it
 * (src/lib/url.ts, compiler/base_path.py).
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const BASE = '/sub'

/** Paths of every request the page makes to the site's own server. */
function sameOriginPaths(page: Page, origin: string): string[] {
  const paths: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.origin === origin) paths.push(url.pathname)
  })
  return paths
}

test('a deep link loads with every request under the base path', async ({ page, baseURL }) => {
  const errors = collectPageErrors(page)
  const paths = sameOriginPaths(page, new URL(baseURL!).origin)
  await page.goto(`${BASE}/docs/guide/first`)
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.locator('aside a[data-nav-path="/docs/guide/second"]').first()).toHaveAttribute(
    'href',
    `${BASE}/docs/guide/second`,
  )
  await page.waitForLoadState('networkidle')
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter((p) => p !== BASE && !p.startsWith(`${BASE}/`))).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

test('sidebar, in-article links and Back keep the base path', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto(`${BASE}/docs/guide/first`)
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  const article = page.locator('#main-content article')
  await expect(article.getByRole('link', { name: 'second page' })).toHaveAttribute('href', `${BASE}/docs/guide/second`)
  await article.getByRole('link', { name: 'second page' }).click()
  await expect(page).toHaveURL(new RegExp(`${BASE}/docs/guide/second$`))
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()

  await page.locator('aside a[data-nav-path="/docs/markdown"]').first().click()
  await expect(page).toHaveURL(new RegExp(`${BASE}/docs/markdown$`))
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  // A relative image resolves under the base too.
  await expect(page.locator('#main-content article img[alt="A blue box with a diagonal line"]')).toHaveAttribute(
    'src',
    `${BASE}/docs/images/sample.png`,
  )

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${BASE}/docs/guide/second$`))
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('the root redirects to the base, and search opens pages under it', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`${BASE}/?$`))
  await expect(page.locator('aside a[data-nav-path]').first()).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await dialog.getByRole('combobox').fill('second')
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName(/^Second page/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${BASE}/docs/guide/second$`))
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})
