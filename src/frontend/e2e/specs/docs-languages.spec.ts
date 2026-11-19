// Content languages (docs/features/navigation.md#languages) on the built fixture site:
// docs/fr/ is the French translation (`navigation.languages` in fixtures/docs-site/aiui.yaml).
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const switcher = (page: Page) => page.locator('.aiui-docs-header').getByRole('button', { name: /^Language: / })
const sidebar = (page: Page) => page.locator('.aiui-docs-sidebar')

test('the switcher keeps the page across languages; sidebar, head and search follow the language', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/docs/guide/first')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('link[rel="alternate"][hreflang="fr"]')).toHaveAttribute('href', /\/docs\/fr\/guide\/first$/)
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', /\/docs\/guide\/first$/)
  await expect(switcher(page)).toHaveAccessibleName('Language: English')

  await switcher(page).click()
  await page.getByRole('menuitem', { name: 'Français' }).click()
  await expect(page).toHaveURL(/\/docs\/fr\/guide\/first$/)
  await expect(page.locator('#main-content article h1')).toHaveText('Première page')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(switcher(page)).toHaveAccessibleName('Language: Français')
  await expect(sidebar(page).getByRole('link', { name: 'Accueil' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Second page' })).toHaveCount(0)
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/docs\/guide\/first$/)

  // Search finds the French page in French only.
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog').getByRole('combobox').fill('quetzalcoatl')
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Première page')
  await page.keyboard.press('Escape')
  // Back to English: the pick is remembered.
  await switcher(page).click()
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  expect(await page.evaluate(() => localStorage.getItem('aiui-docs-language'))).toBe('en')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog').getByRole('combobox').fill('quetzalcoatl')
  await expect(page.getByRole('dialog').getByRole('option', { name: /Première page/ })).toHaveCount(0)
  expect(errors.pageErrors).toEqual([])
})

test.describe('a French browser', () => {
  test.use({ locale: 'fr-FR' })
  test.beforeEach(async ({ page }) => {
    // Playwright flags itself as automation, which the redirect skips like a crawler.
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }))
  })

  test('opens the French home on a first visit, unless the reader picked a language', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/docs\/fr$/)
    await expect(page.locator('#main-content article h1')).toHaveText('Accueil')
    // Any other page stays as linked.
    await page.goto('/docs/guide/first')
    await expect(page.locator('#main-content article h1')).toHaveText('First page')
    await page.evaluate(() => localStorage.setItem('aiui-docs-language', 'en'))
    await page.goto('/')
    await expect(switcher(page)).toHaveAccessibleName('Language: English')
    await expect(page).not.toHaveURL(/\/fr/)
  })
})

test('at 390 px the switcher is an icon button that fits the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/fr/guide/first')
  await expect(switcher(page)).toBeVisible()
  await switcher(page).click()
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
