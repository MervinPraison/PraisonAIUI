// Docs sidebar groups (docs/features/navigation.md) on the built fixture site, with
// the nav and ui-config replaced per test: a group's own page, folding remembered
// across reloads, drilldown, and breadcrumbs (styling.eyebrows).
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const NAV = {
  items: [
    { title: 'Home', path: '/docs/index' },
    { title: 'Guide', path: '/docs/layout', tag: 'New', children: [
      { title: 'Deep', children: [{ title: 'First page', path: '/docs/guide/first' }, { title: 'Second page', path: '/docs/guide/second' }] },
    ] },
    { title: 'Reference', expanded: false, children: [{ title: 'Markdown', path: '/docs/markdown' }, { title: 'Search', path: '/docs/search' }] },
  ],
}

async function withNav(page: Page, extra: Record<string, unknown> = {}, ui: Record<string, unknown> = {}) {
  await page.route('**/docs-nav.json', (route) => route.fulfill({ json: { ...NAV, ...extra } }))
  await page.route('**/ui-config.json', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), ...ui } })
  })
}

const sidebar = (page: Page) => page.locator('.aiui-docs-sidebar')

test('a group folds and stays folded after a reload; the active page opens its group', async ({ page }) => {
  const errors = collectPageErrors(page)
  await withNav(page)
  await page.goto('/docs/index')
  const nav = sidebar(page)
  // Reference has expanded: false: its pages start hidden.
  await expect(nav.getByRole('button', { name: 'Reference' })).toHaveAttribute('aria-expanded', 'false')
  await expect(nav.getByRole('link', { name: 'Markdown' })).toBeHidden()
  // The Deep group folds; the choice survives a reload.
  await nav.getByRole('button', { name: 'Deep' }).click()
  await expect(nav.getByRole('link', { name: 'First page' })).toBeHidden()
  await page.reload()
  await expect(sidebar(page).getByRole('button', { name: 'Deep' })).toHaveAttribute('aria-expanded', 'false')
  await expect(sidebar(page).getByRole('link', { name: 'First page' })).toBeHidden()
  // Opening a page inside a folded group opens it.
  await page.goto('/docs/search')
  await expect(sidebar(page).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
  expect(errors.pageErrors).toEqual([])
})

test('a group label opens its own page, or with drilldown its first page', async ({ page }) => {
  await withNav(page, { drilldown: true })
  await page.goto('/docs/index')
  const nav = sidebar(page)
  await nav.getByRole('link', { name: /Guide/ }).click()
  await expect(page).toHaveURL(/\/docs\/layout$/)
  await expect(page.getByRole('heading', { name: 'Layout components', level: 1 })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Guide/ })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: 'Reference' }).click()
  await expect(page).toHaveURL(/\/docs\/markdown$/)
  await expect(nav.getByRole('link', { name: 'Markdown' })).toHaveAttribute('aria-current', 'page')
})

test('the eyebrow is the closest group; breadcrumbs show every group, linking those with a page', async ({ page }) => {
  await withNav(page)
  await page.goto('/docs/guide/second')
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs).toContainText('Deep')
  await expect(crumbs).not.toContainText('Guide')
  await page.unrouteAll()
  await withNav(page, {}, { styling: { eyebrows: 'breadcrumbs' } })
  await page.reload()
  await expect(crumbs).toContainText('Guide')
  await crumbs.getByRole('link', { name: 'Guide' }).click()
  await expect(page).toHaveURL(/\/docs\/layout$/)
  await expect(page.getByRole('heading', { name: 'Layout components', level: 1 })).toBeVisible()
})
