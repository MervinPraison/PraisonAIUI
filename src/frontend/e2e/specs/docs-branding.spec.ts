/**
 * Docs branding CSS on a built site (fixtures/docs-site): a logo per mode
 * swaps live with the theme toggle, and the `site.theme.background`
 * decorations paint behind the page without covering it, at 390 px too.
 * The build side (ui-config, theme.css, <html data-aiui-bg>) is covered by
 * tests/unit/test_branding.py; the header markup by docs/branding.test.tsx.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

test('logo.light / logo.dark: the theme toggle swaps them with no reload', async ({ page }) => {
  const errors = collectPageErrors(page)
  await setColorMode(page, 'light')
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  // The markup BrandMark renders for a configured pair.
  await page.locator('.aiui-docs-header .aiui-docs-brand').evaluate((brand) => {
    const svg = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`)}`
    brand.querySelector('.aiui-docs-mark')?.replaceWith(
      Object.assign(document.createElement('img'), { className: 'aiui-docs-mark', src: svg('black') }),
      Object.assign(document.createElement('img'), { className: 'aiui-docs-mark', src: svg('white') }),
    )
    const [light, dark] = brand.querySelectorAll('img.aiui-docs-mark')
    light.setAttribute('data-mode', 'light')
    dark.setAttribute('data-mode', 'dark')
  })
  const light = page.locator('.aiui-docs-header img[data-mode="light"]')
  const dark = page.locator('.aiui-docs-header img[data-mode="dark"]')
  await expect(light).toBeVisible()
  await expect(dark).toBeHidden()

  await page.getByRole('button', { name: 'Toggle theme' }).first().click()
  const choice = page.getByRole('menuitem', { name: /dark/i })
  if (await choice.count()) await choice.first().click()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
  await expect(dark).toBeVisible()
  await expect(light).toBeHidden()
  expect(errors.pageErrors).toEqual([])
})

for (const decoration of ['gradient', 'grid'] as const) {
  test(`background ${decoration}: painted behind the page, links stay clickable, fits 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/docs/guide/first')
    await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
    await page.evaluate((d) => document.documentElement.setAttribute('data-aiui-bg', d), decoration)
    const paint = await page.locator('.aiui-docs').evaluate((el) => {
      const s = getComputedStyle(el, '::before')
      return { image: s.backgroundImage, position: s.position, events: s.pointerEvents, z: s.zIndex }
    })
    expect(paint.image).toContain('gradient')
    expect(paint).toMatchObject({ position: 'fixed', events: 'none', z: '-1' })
    // The page background still shows (the decoration sits on it, not under it).
    const bg = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(await hasHorizontalOverflow(page)).toBe(false)
    const heading = page.getByRole('heading', { name: 'First page', level: 1 })
    const box = (await heading.boundingBox())!
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('h1')?.textContent ?? '', [box.x + 4, box.y + box.height / 2])
    expect(hit).toContain('First page')
  })
}
