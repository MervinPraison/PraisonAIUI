/**
 * Layout component options on a built docs page (fixtures/docs-site/docs/layout.md):
 * Columns, card options, step options, accordion deep links, tabs that sync by
 * title (and are remembered), defaultTabIndex, tab deep links, the TOC
 * following the shown tab, and the dropdown code group. docs/DocsBlocks.tsx,
 * docs/DocsTabs.tsx and docs/hashScroll.ts draw them.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

const cols = (el: import('@playwright/test').Locator) => el.evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)

for (const mode of ['light', 'dark'] as const) {
  test(`layout components (${mode}): columns, cards, steps, synced tabs, TOC, dropdown`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.goto('/docs/layout')
    const article = page.locator('#main-content article')
    await expect(page.getByRole('heading', { name: 'Layout components', level: 1 })).toBeVisible()

    // Columns: two cells side by side on a wide screen.
    const columns = article.locator('.aiui-cards').filter({ hasText: 'Left column text.' })
    expect(await cols(columns)).toBe(2)
    await expect(columns.locator('.aiui-column')).toHaveCount(2)

    // Cards: horizontal (icon beside the title, accent colour), image with a call to action.
    const wide = article.getByRole('link', { name: /Horizontal card/ })
    await expect(wide).toHaveAttribute('data-horizontal', '')
    const [icon, title] = await Promise.all([wide.locator('.aiui-card-icon').boundingBox(), wide.locator('.aiui-card-title').boundingBox()])
    expect(icon!.x + icon!.width).toBeLessThanOrEqual(title!.x)
    expect(await wide.locator('.aiui-card-icon').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(15, 118, 110)')
    const pic = article.getByRole('link', { name: /Image card/ })
    await expect(pic.locator('img.aiui-card-img')).toHaveAttribute('src', /images\/sample\.png$/)
    await expect(pic.locator('.aiui-card-cta')).toHaveText('Open the guide')

    // Steps: titleSize h3 headings in "On this page"; the count starts at 3; an icon replaces the number.
    const steps = article.locator('li.aiui-step')
    await expect(steps.first().getByRole('heading', { level: 3, name: 'Install the package' })).toHaveAttribute('id', 'install-the-package')
    await expect(steps.first().locator('.aiui-step-icon svg')).toBeVisible()
    expect(await steps.first().evaluate((e) => getComputedStyle(e).counterSet)).toBe('aiui-step 3')
    expect(await steps.nth(1).evaluate((e) => getComputedStyle(e, '::before').content)).toBe('counter(aiui-step)')
    const toc = page.locator('.aiui-docs-toc nav[aria-label="On this page"]')
    await expect(toc.getByRole('link', { name: 'Install the package' })).toBeVisible()

    // Accordion: icon and description in the summary.
    const acc = article.locator('details#deep-answer')
    await expect(acc.locator('summary .aiui-admonition-desc')).toHaveText('Opens from the address bar')

    // Tabs: picking Windows in the first set switches the second (synced by title) but not the unsynced one.
    const sets = article.locator('[data-aiui-tabs]')
    await expect(sets.nth(1).getByRole('tab', { selected: true })).toHaveText('macOS') // defaultTabIndex={1}
    await expect(sets.nth(1)).toHaveClass(/aiui-tabs-rule/)
    await expect(toc.getByRole('link', { name: 'Mac setup' })).toBeVisible()
    await expect(toc.getByRole('link', { name: 'Windows setup' })).toHaveCount(0)
    await sets.nth(0).getByRole('tab', { name: 'Windows' }).click()
    await expect(sets.nth(1).getByRole('tab', { selected: true })).toHaveText('Windows')
    await expect(sets.nth(2).getByRole('tab', { selected: true })).toHaveText('macOS')
    await expect(sets.nth(0).getByRole('tab', { name: 'Windows' }).locator('.aiui-tab-icon')).toBeVisible()
    // "On this page" lists the headings of the tab now shown.
    await expect(toc.getByRole('link', { name: 'Windows setup' })).toBeVisible()
    await expect(toc.getByRole('link', { name: 'Mac setup' })).toHaveCount(0)
    // Remembered: a reload opens on Windows.
    await page.reload()
    await expect(article.locator('[data-aiui-tabs]').nth(0).getByRole('tab', { selected: true })).toHaveText('Windows')

    // Dropdown code group: a menu instead of tabs.
    const dropdown = article.locator('[data-variant="dropdown"]')
    await dropdown.scrollIntoViewIfNeeded()
    await expect(dropdown.getByRole('tab')).toHaveCount(0)
    await expect(dropdown.locator('.aiui-tabs-panel:visible')).toContainText('pip install aiui')
    await dropdown.getByRole('combobox', { name: 'Choose a code sample' }).click()
    await page.getByRole('option', { name: 'uv' }).click()
    await expect(dropdown.locator('.aiui-tabs-panel:visible')).toContainText('uv pip install aiui')
    expect(errors.pageErrors).toEqual([])
  })
}

test('deep links open the accordion and the tab they name', async ({ page }) => {
  await page.goto('/docs/layout#deep-answer')
  const acc = page.locator('details#deep-answer')
  await expect(acc).toHaveAttribute('open', '')
  await expect(acc).toContainText('The answer inside the accordion.')
  await page.goto('/docs/layout#windows-tab')
  const first = page.locator('#main-content [data-aiui-tabs]').first()
  await expect(first.getByRole('tab', { selected: true })).toHaveText('Windows')
  await expect(first.getByRole('tabpanel')).toContainText('Windows text in the first set.')
})

test('layout components at 390 px: columns and cards stack, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/layout')
  const columns = page.locator('#main-content .aiui-cards').filter({ hasText: 'Left column text.' })
  await expect(columns).toBeVisible()
  expect(await cols(columns)).toBe(1)
  expect(await cols(page.locator('#main-content .aiui-cards').filter({ hasText: 'Horizontal card' }))).toBe(1)
  await page.locator('[data-variant="dropdown"]').scrollIntoViewIfNeeded()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})
