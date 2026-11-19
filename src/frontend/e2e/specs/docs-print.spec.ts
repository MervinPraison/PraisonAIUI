/**
 * Printing a docs page (fixtures/docs-site): docs.css @media print shows the
 * article alone with everything a click would reveal, and "Download as PDF"
 * in the page actions prints it light whatever the reader's theme
 * (docs/print.ts).
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, setColorMode } from './support'

test('print: the article alone, with accordions, tabs, expandables and long code shown', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  const article = page.locator('#main-content article.aiui-doc')
  // On screen: chrome in place, the click-to-reveal content hidden.
  await expect(page.locator('.aiui-docs-header')).toBeVisible()
  await expect(page.locator('.aiui-docs-sidebar')).toBeVisible()
  await expect(article.getByText('Hidden until opened.')).toBeHidden()
  await expect(article.getByText('uv pip install aiui')).toBeHidden()

  await page.emulateMedia({ media: 'print' })
  for (const chrome of ['.aiui-docs-header', '.aiui-docs-sidebar', '.aiui-docs-toc', '.aiui-docs-footer', '.aiui-docs-pager']) {
    await expect(page.locator(chrome)).toBeHidden()
  }
  await expect(page.getByRole('group', { name: 'Page actions' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  // The accordion is open, both code group tabs print under their own titles.
  await expect(article.getByText('Hidden until opened.')).toBeVisible()
  const group = article.locator('.aiui-tabs').filter({ hasText: 'uv pip install aiui' })
  await expect(group.getByText('pip install aiui', { exact: true })).toBeVisible()
  await expect(group.getByText('uv pip install aiui')).toBeVisible()
  await expect(group.getByRole('tablist')).toBeHidden()
  const titles = await group.locator(':scope > [data-title]').evaluateAll((panels) =>
    panels.map((p) => getComputedStyle(p, '::before').content),
  )
  expect(titles).toEqual(['"pip"', '"uv"'])
  // An `expandable` block prints every line, and nothing scrolls sideways.
  await expect(article.getByText('line_15 = 15')).toBeVisible()
  await expect(article.getByRole('button', { name: /Show all/ })).toBeHidden()
  const pre = article.locator('pre').filter({ hasText: 'aiui serve --output' })
  expect(await pre.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
  expect(await pre.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  // External links print their address.
  const link = article.locator('a[href="https://example.com/docs"]')
  expect(await link.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('https://example.com/docs')
  expect(errors.pageErrors).toEqual([])
})

test('print: nested expandables under an API field open', async ({ page }) => {
  await page.goto('/docs/api-fields')
  const nested = page.getByText('City name in the nested address.')
  await expect(nested).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(nested).toBeVisible()
})

test('Download as PDF prints the page light, then puts the reader\'s dark theme back', async ({ page }) => {
  await setColorMode(page, 'dark')
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
  // The browser's print dialog, stood in for: it fires beforeprint, prints, then afterprint.
  await page.evaluate(() => {
    const w = window as unknown as { printedDark?: boolean[] }
    w.printedDark = []
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'))
      w.printedDark!.push(document.documentElement.classList.contains('dark'))
      window.dispatchEvent(new Event('afterprint'))
    }
  })

  await page.getByRole('group', { name: 'Page actions' }).getByRole('button', { name: 'More page actions' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: /Download as PDF/ }).click()
  await expect(page.getByRole('menu')).toBeHidden()
  await expect.poll(() => page.evaluate(() => (window as unknown as { printedDark: boolean[] }).printedDark)).toEqual([false])
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
})
