// Docs versions (docs/features/navigation.md#versions) on the built fixture site:
// docs/v1/ is the older version (`navigation.versions` in fixtures/docs-site/aiui.yaml).
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const sidebar = (page: Page) => page.locator('.aiui-docs-sidebar')
const switcher = (page: Page) => sidebar(page).getByRole('button', { name: /^Version / })

test('the switcher keeps the page across versions; sidebar, head and search follow the version', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/docs/guide/first')
  await expect(switcher(page)).toHaveAccessibleName('Version v2 Latest')
  await expect(sidebar(page).getByRole('link', { name: 'Second page' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Retired page' })).toHaveCount(0)

  // The same page in v1.
  await switcher(page).click()
  await expect(page.getByRole('menuitem', { name: /v1/ })).toContainText('Legacy')
  await page.getByRole('menuitem', { name: /v1/ }).click()
  await expect(page).toHaveURL(/\/docs\/v1\/guide\/first$/)
  await expect(page.locator('#main-content article h1')).toHaveText('First page (v1)')
  await expect(switcher(page)).toHaveAccessibleName('Version v1 Legacy')
  await expect(sidebar(page).getByRole('link', { name: 'Retired page' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Second page' })).toHaveCount(0)
  // Its canonical is the default version's page, and crawlers skip it.
  await page.reload()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/docs\/guide\/first$/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

  // Search finds v1's pages in v1 only.
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').fill('zephyrine')
  await expect(dialog.getByRole('option').first()).toContainText('First page (v1)')
  await page.keyboard.press('Escape')

  // A page v2 does not have: the switcher opens v2's first page.
  await sidebar(page).getByRole('link', { name: 'Retired page' }).click()
  await switcher(page).click()
  await page.getByRole('menuitem', { name: /v2/ }).click()
  await expect(page).not.toHaveURL(/\/v1\//)
  await expect(switcher(page)).toHaveAccessibleName('Version v2 Latest')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog').getByRole('combobox').fill('zephyrine')
  await expect(page.getByRole('dialog').getByRole('option', { name: /First page \(v1\)/ })).toHaveCount(0)
  expect(errors.pageErrors).toEqual([])
})

test('at 390 px the drawer holds the version switcher', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/v1/guide/first')
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Version v1 Legacy' }).click()
  await page.getByRole('menuitem', { name: /v2/ }).click()
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
