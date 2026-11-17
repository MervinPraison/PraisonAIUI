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

test('the docs site draws in self-hosted Geist (latin woff2, same origin)', async ({ page, baseURL }) => {
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  const family = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toMatch(/^"?Geist"?,/)
  const mono = await page.locator('#main-content [data-streamdown="inline-code"]').first().evaluate((el) => getComputedStyle(el).fontFamily)
  expect(mono).toMatch(/^"?Geist Mono"?,/)
  expect(await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('16px Geist') && document.fonts.check('13px "Geist Mono"')
  })).toBe(true)
  const geist = fonts.filter((url) => /geist/i.test(url))
  expect(geist.length).toBeGreaterThan(0)
  for (const url of geist) {
    expect(url.startsWith(baseURL!)).toBe(true)
    expect(url).toMatch(/\/assets\/geist(-mono)?-latin-wght-normal-[\w-]+\.woff2$/)
  }
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
  // ../index.md is the docs home page, whose one URL is the site root.
  await expect(article.getByRole('link', { name: 'home page' })).toHaveAttribute('href', '/')
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

test('the docs home has one URL: /docs and /docs/index move to /', async ({ page }) => {
  const errors = collectPageErrors(page)
  for (const path of ['/', '/docs', '/docs/', '/docs/index']) {
    await page.goto(path)
    await expect(page.locator('#main-content article').getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.locator('#main-content')).not.toContainText('Theme Configuration')
    // The sidebar's home entry links to the root.
    await expect(page.locator('.aiui-docs-sidebar a[aria-current="page"]')).toHaveAttribute('href', '/')
  }
  expect(errors.pageErrors).toEqual([])
})

test('a URL with no page shows "Page not found", never the config dump', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/no/such/page')
  const main = page.locator('#main-content')
  await expect(main.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible()
  await expect(main).toContainText('/docs/no/such/page')
  await expect(main).not.toContainText('Theme Configuration')
  await expect(main).not.toContainText('Available Presets')
  await expect(main.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  await expect(page).toHaveTitle(/Page not found/)
  await main.getByRole('button', { name: 'Search the docs' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('preset paper: the Paper look, serif titles, self-hosted Paper fonts', async ({ page, baseURL }) => {
  const errors = collectPageErrors(page)
  // The fixture site is zinc; the reader's ui-config.json says paper.
  await page.route('**/ui-config.json', async (route) => {
    const res = await route.fetch()
    const json = await res.json()
    json.site.theme = { ...(json.site.theme ?? {}), preset: 'paper' }
    await route.fulfill({ response: res, json })
  })
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await setColorMode(page, 'light')
  await page.goto('/docs/markdown')
  const h1 = page.getByRole('heading', { name: 'Markdown sample', level: 1 })
  await expect(h1).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-aiui-look', 'paper')

  expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Newsreader"?,/)
  const body = page.locator('.aiui-docs')
  expect(await body.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Source Sans 3"?,/)
  const article = page.locator('#main-content article.aiui-doc > .aiui-markdown')
  const type = await article.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight])
  expect(type[0]).toBe('17px')
  expect(parseFloat(type[1]) / 17).toBeCloseTo(1.7, 1)
  // Paper's page and navy accent, light then dark.
  const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, bg)).toBe(await toRgb(page, '#f6f3ec'))
  const tile = await page.locator('.aiui-docs-header .aiui-docs-mark').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, tile)).toBe(await toRgb(page, '#1f1c17'))
  const primary = await body.evaluate((el) => getComputedStyle(el).getPropertyValue('--primary').trim())
  expect(await toRgb(page, primary)).toBe(await toRgb(page, '#2d4f86'))
  await setColorMode(page, 'dark')
  await page.reload()
  await expect(h1).toBeVisible()
  const darkBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, darkBg)).toBe(await toRgb(page, '#1a1814'))

  expect(await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('17px "Source Sans 3"') && document.fonts.check('40px Newsreader')
  })).toBe(true)
  const paper = fonts.filter((url) => /newsreader|source-sans|jetbrains/i.test(url))
  expect(paper.length).toBeGreaterThan(0)
  for (const url of paper) expect(url.startsWith(baseURL!)).toBe(true)
  expect(fonts.some((url) => /googleapis|gstatic/.test(url))).toBe(false)
  expect(errors.pageErrors).toEqual([])
})
