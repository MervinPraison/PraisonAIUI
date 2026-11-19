/**
 * Utility classes on a built docs page (fixtures/docs-site/docs/layout.md, docs/docsClasses.ts,
 * docs/utilities.css): allowed classes on raw HTML and component tags draw in light and dark
 * mode, with the site's tokens; an unknown class does nothing.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow } from './support'

/** A token's colour as the page computes it. */
const tokenColor = (page: import('@playwright/test').Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${t})`
    document.querySelector('#main-content article')!.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, token)

for (const mode of ['light', 'dark'] as const) {
  test(`utility classes draw with the site's tokens in ${mode} mode`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.addInitScript((m) => localStorage.setItem('aiui-theme-preference', m), mode)
    await page.goto('/docs/layout')
    const article = page.locator('#main-content article').first()
    const box = article.getByText('Styled box', { exact: true })
    await expect(box).toHaveClass('aiui:rounded-lg aiui:border aiui:border-primary aiui:bg-muted aiui:p-4 aiui:text-muted-foreground')
    const look = await box.evaluate((e) => {
      const s = getComputedStyle(e)
      return { pad: s.paddingTop, color: s.color, bg: s.backgroundColor, border: s.borderTopWidth, borderColor: s.borderTopColor }
    })
    expect(parseFloat(look.pad)).toBeGreaterThan(12)
    expect(look.border).toBe('1px')
    expect(look.color).toBe(await tokenColor(page, '--muted-foreground'))
    expect(look.borderColor).toBe(await tokenColor(page, '--primary'))
    expect(look.bg).not.toBe('rgba(0, 0, 0, 0)')

    // dark: shows one line per mode; the grid has two columns on a wide screen.
    await expect(article.getByText('Light mode text')).toBeVisible({ visible: mode === 'light' })
    await expect(article.getByText('Dark mode text')).toBeVisible({ visible: mode === 'dark' })
    const grid = box.locator('..')
    expect(await grid.evaluate((e) => [getComputedStyle(e).display, getComputedStyle(e).gridTemplateColumns.split(' ').length, getComputedStyle(e).position]))
      .toEqual(['grid', 2, 'static']) // `fixed` is not allowed: dropped
    // A component's own look gives way to the page's class.
    const note = article.getByRole('note').filter({ hasText: 'A spaced note.' })
    expect(parseFloat(await note.evaluate((e) => getComputedStyle(e).marginTop))).toBeGreaterThan(40)
    expect(errors.pageErrors).toEqual([])
  })
}

test('on a phone the grid is one column and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/layout')
  const grid = page.locator('#main-content article').first().getByText('Styled box', { exact: true }).locator('..')
  expect(await grid.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(1)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})
