/**
 * Docs components on a built page (fixtures/docs-site/docs/widgets.md): <Callout color>, inline
 * <Badge> and <Tooltip>, <Frame hint caption> in Markdown, a <Tree> from a Markdown list with
 * arrow keys, <Prompt> actions, <Color> swatches and <col width>. docs/DocsWidgets.tsx draws them.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

for (const mode of ['light', 'dark'] as const) {
  test(`docs widgets (${mode}, 390 px)`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/docs/widgets')
    const article = page.locator('#main-content article').first()
    await expect(page.getByRole('heading', { name: 'Widgets', level: 1 })).toBeVisible()

    // The callout takes the author's colour as its tone.
    const callout = article.locator('[data-type="callout"]')
    expect(await callout.evaluate((e) => getComputedStyle(e).getPropertyValue('--tone').trim())).toBe('#0f766e')
    await expect(article.locator('.aiui-badge')).toHaveText('New')

    // The tooltip shows on keyboard focus, stays on screen, and Escape hides it.
    const term = article.locator('.aiui-tooltip')
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeHidden()
    await term.focus()
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Software Development Kit')
    const box = (await tip.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()

    // Frame: hint above, caption below, both Markdown.
    await expect(article.locator('.aiui-frame-hint strong, .aiui-frame-hint [data-streamdown="strong"]')).toHaveText('Run')
    await expect(article.locator('figure.aiui-frame figcaption a')).toHaveText('the guide')

    // Tree: arrow keys walk the rows; Left closes a folder.
    const rows = article.locator('.aiui-tree-row')
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(rows.nth(1)).toBeFocused()
    await expect(article.locator('.aiui-tree-row[data-hl]')).toHaveText('page.tsx')
    await rows.first().focus()
    await page.keyboard.press('ArrowLeft')
    await expect(article.getByText('layout.tsx')).toBeHidden()

    // Prompt: Copy and Open in Claude with the prompt as written; no ChatGPT (not asked for).
    const prompt = article.locator('.aiui-prompt')
    await expect(prompt.getByRole('link', { name: 'Open in Claude' })).toHaveAttribute('href', /claude\.ai\/new\?q=You%20are%20a%20technical%20writer\./)
    await expect(prompt.getByRole('link', { name: 'Open in ChatGPT' })).toHaveCount(0)

    // Colour swatch: the dark value in dark mode.
    const swatch = article.locator('.aiui-color-swatch')
    const want = mode === 'dark' ? 'rgb(94, 234, 212)' : 'rgb(15, 118, 110)'
    expect(await swatch.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(want)
    await expect(article.locator('col').first()).toHaveAttribute('width', '70%')

    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}
