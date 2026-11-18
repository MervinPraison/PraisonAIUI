// Page front matter on the built fixture site (docs/features/writing-docs.md "Front matter"),
// with docs-nav.json replaced per test: the description under the title, badges, an
// external sidebar link, `mode` and `hideFooterPagination`.
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const FIRST = { title: 'First page', path: '/docs/guide/first', description: 'The first guide page.', lede: true }

async function withNav(page: Page, first: Record<string, unknown>) {
  const items = [
    { title: 'Home', path: '/docs/index' },
    { ...FIRST, ...first },
    { title: 'Second page', path: '/docs/guide/second', deprecated: true },
    { title: 'GitHub', href: 'https://github.com/acme/site', tag: 'OSS' },
  ]
  await page.route('**/docs-nav.json', (route) => route.fulfill({ json: { items } }))
}

test('the description shows under the title; badges and an external link in the sidebar', async ({ page }) => {
  const errors = collectPageErrors(page)
  await withNav(page, { tag: 'NEW' })
  await page.goto('/docs/guide/first')
  const article = page.locator('article.aiui-doc')
  await expect(article.locator('h1 + p')).toHaveText('The first guide page.')
  const sidebar = page.locator('.aiui-docs-sidebar')
  await expect(sidebar.getByRole('link', { name: /First page/ }).locator('.aiui-docs-navtag')).toHaveText('NEW')
  await expect(sidebar.getByRole('link', { name: /Second page/ })).toContainText('Deprecated')
  const github = sidebar.getByRole('link', { name: /GitHub/ })
  await expect(github).toHaveAttribute('href', 'https://github.com/acme/site')
  await expect(github).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: /Next/ })).toBeVisible()
  await page.goto('/docs/guide/second')
  await expect(page.locator('.aiui-docs-deprecated')).toContainText('deprecated')
  expect(errors.pageErrors).toEqual([])
})

test('mode and hideFooterPagination drop the TOC, the sidebar and the pager', async ({ page }) => {
  await withNav(page, { mode: 'wide', hidePager: true })
  await page.goto('/docs/guide/first')
  await expect(page.locator('article.aiui-doc h2').first()).toBeVisible()
  await expect(page.locator('.aiui-docs-toc')).toHaveCount(0)
  await expect(page.locator('.aiui-docs-sidebar')).toBeVisible()
  await expect(page.getByRole('link', { name: /Next/ })).toHaveCount(0)

  await withNav(page, { mode: 'center' })
  await page.reload()
  await expect(page.locator('article.aiui-doc h2').first()).toBeVisible()
  await expect(page.locator('.aiui-docs-sidebar')).toBeHidden()
})

test('head tags: the page seo map wins, and the next page drops what it does not set', async ({ page }) => {
  await withNav(page, { seo: { canonical: 'https://other.test/first', 'og:image': '/card.png', 'og:locale': 'de_DE' } })
  await page.goto('/docs/guide/first')
  const head = (selector: string) => page.locator(`head ${selector}`)
  await expect(head('link[rel="canonical"]')).toHaveAttribute('href', 'https://other.test/first')
  await expect(head('meta[property="og:url"]')).toHaveAttribute('content', 'https://other.test/first')
  await expect(head('meta[property="og:image"]')).toHaveAttribute('content', /\/card\.png$/)
  await expect(head('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
  await expect(head('meta[property="og:type"]')).toHaveCount(1)
  await expect(head('script[type="application/ld+json"]')).toHaveCount(1)

  await page.locator('.aiui-docs-sidebar').getByRole('link', { name: /Second page/ }).click()
  await expect(head('link[rel="canonical"]')).toHaveAttribute('href', /\/docs\/guide\/second$/)
  await expect(head('meta[property="og:locale"]')).toHaveCount(0)
  await expect(head('meta[property="og:type"]')).toHaveCount(1)
  await expect(head('script[type="application/ld+json"]')).toHaveCount(1)
})
