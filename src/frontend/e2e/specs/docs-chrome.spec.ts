/**
 * The docs style's chrome on a built site (`aiui build` + `aiui serve`,
 * fixtures/docs-site): Pro tokens, sidebar, page source fixes, "On this
 * page", previous / next, search, focus ring and the phone drawer.
 * DESIGN.md "Docs style" is the contract.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, toRgb } from './support'

const PRO_INDIGO_LIGHT = '#4f46e5'

test('the docs site draws in the Pro tokens, light and dark', async ({ page }) => {
  const errors = collectPageErrors(page)
  await setColorMode(page, 'light')
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-aiui-tokens', 'pro')
  await expect(html).toHaveAttribute('data-aiui-docs', '')
  // The brand tile is the Pro accent (zinc, the default preset, maps to indigo).
  const tile = page.locator('.aiui-docs-header .aiui-docs-mark')
  const tileBg = await tile.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, tileBg)).toBe(await toRgb(page, PRO_INDIGO_LIGHT))
  const lightBg = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).backgroundColor)

  await setColorMode(page, 'dark')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
  const darkBg = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(darkBg).not.toBe(lightBg)
  expect(errors.pageErrors).toEqual([])
})

test('sidebar, section, frontmatter, relative links and previous / next', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  const article = page.locator('#main-content article')
  await expect(article.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  // The active page is marked in the sidebar, and its section heads the article.
  const sidebar = page.locator('.aiui-docs-sidebar')
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText('First page')
  await expect(page.locator('.aiui-docs-eyebrow')).toHaveText(/guide/i)

  // Frontmatter is metadata, never text; relative links resolve against the page folder.
  await expect(article).not.toContainText('description:')
  await expect(article.getByRole('link', { name: 'second page' })).toHaveAttribute('href', '/docs/guide/second')
  await expect(article.getByRole('link', { name: 'home page' })).toHaveAttribute('href', '/docs/index')
  await expect(article).not.toContainText('[blocked]')

  // Callouts carry their tone and a title.
  await expect(article.getByRole('note', { name: 'Good to know' })).toHaveAttribute('data-type', 'tip')

  // Previous / next, in sidebar order.
  const pager = page.getByRole('navigation', { name: 'Previous and next page' })
  await pager.getByRole('link', { name: /Next.*Second page/ }).click()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText('Second page')
  await expect(pager.getByRole('link', { name: /Previous.*First page/ })).toHaveAttribute('href', '/docs/guide/first')
  expect(errors.pageErrors).toEqual([])
})

test('"On this page" follows the reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await page.goto('/docs/guide/first')
  const toc = page.locator('.aiui-docs-toc nav[aria-label="On this page"]')
  await expect(toc.getByRole('link', { name: 'Setup' })).toHaveAttribute('aria-current', 'location')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(toc.getByRole('link', { name: 'Reference' })).toHaveAttribute('aria-current', 'location')
  await expect(toc.locator('[aria-current="location"]')).toHaveCount(1)
})

test('search finds a page by title (Ctrl+K)', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('button', { name: 'Search documentation' }).first()).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill('second')
  await expect(dialog.getByRole('option', { name: 'Second page' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  expect(errors.pageErrors).toEqual([])
})

test('links and buttons show a 2px focus ring', async ({ page }) => {
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  const brand = page.locator('.aiui-docs-brand')
  await brand.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const ring = await brand.evaluate((el) => {
    const s = getComputedStyle(el)
    return { matches: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth }
  })
  expect(ring).toEqual({ matches: true, style: 'solid', width: '2px' })
})

test('phone: the drawer holds the nav and the page never scrolls sideways', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.locator('.aiui-docs-sidebar')).toBeHidden()
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[aria-current="page"]')).toHaveText('First page')
  await drawer.getByRole('link', { name: 'Second page' }).click()
  await expect(drawer).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  expect(errors.pageErrors).toEqual([])
})
