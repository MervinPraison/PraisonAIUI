/**
 * Code block options on a built docs page (fixtures/docs-site/docs/markdown.md,
 * "Code options"): a multi-word title, line numbers, wrap, highlight and
 * focus, diff notation, expandable + nocopy, and the <CodeBlock> form.
 * docs/DocsPre.tsx and docs/codeMeta.ts draw them.
 */
import { expect, test, type Locator } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

const lines = (frame: Locator) => frame.locator('[data-streamdown="code-block-body"] code > span')
const style = (el: Locator, prop: string, pseudo?: string) =>
  el.evaluate((e, [p, ps]) => getComputedStyle(e, ps || null).getPropertyValue(p), [prop, pseudo ?? ''] as const)

for (const mode of ['light', 'dark'] as const) {
  test(`code options (${mode}): title, lines, wrap, highlight, focus, diff, expandable, <CodeBlock>`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.goto('/docs/markdown')
    await expect(page.getByRole('heading', { name: 'Code options', level: 2 })).toBeVisible()
    const frames = page.locator('#main-content .aiui-code-frame')

    // ```javascript Example title lines wrap
    const titled = frames.filter({ hasText: 'const greeting' })
    await titled.scrollIntoViewIfNeeded()
    await expect(titled.locator('.aiui-code-title')).toHaveText('Example title')
    expect(await style(lines(titled).nth(1), 'content', '::before')).toBe('counter(aiui-line)')
    expect(await style(titled.locator('pre'), 'white-space')).toBe('pre-wrap')

    // ```ts highlight={1-2,4} focus={2}: 1, 2, 4 tinted; all but 2 dimmed until hover.
    const marked = frames.filter({ hasText: 'const d = 4' })
    await marked.scrollIntoViewIfNeeded()
    const ml = lines(marked)
    await expect(ml).toHaveCount(4)
    const bg = (i: number) => style(ml.nth(i), 'background-color')
    expect(await bg(0)).not.toBe(await bg(2))
    expect(await bg(3)).toBe(await bg(0))
    expect(Number(await style(ml.nth(0), 'opacity'))).toBeLessThan(1)
    expect(Number(await style(ml.nth(1), 'opacity'))).toBe(1)
    await marked.hover()
    await expect.poll(async () => Number(await style(ml.nth(0), 'opacity'))).toBe(1)

    // // [!code --] / [!code ++]: markers gone, red and green lines with a sign.
    const diff = frames.filter({ hasText: 'listen(port)' })
    await diff.scrollIntoViewIfNeeded()
    await expect(diff).not.toContainText('[!code')
    const dl = lines(diff)
    expect(await style(dl.nth(0), 'content', '::after')).toBe('"-"')
    expect(await style(dl.nth(1), 'content', '::after')).toBe('"+"')
    const [removed, added, plain] = await Promise.all([0, 1, 2].map((i) => style(dl.nth(i), 'background-color')))
    expect(new Set([removed, added, plain]).size).toBe(3)

    // ```python expandable nocopy: collapsed with a toggle, no copy button.
    const long = frames.filter({ hasText: 'line_1 = 1' })
    await long.scrollIntoViewIfNeeded()
    await expect(long.getByRole('button', { name: 'Copy Code' })).toHaveCount(0)
    const body = long.locator('[data-streamdown="code-block-body"]')
    const collapsed = (await body.boundingBox())!.height
    await long.getByRole('button', { name: 'Show all 15 lines' }).click()
    await expect(long.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    expect((await body.boundingBox())!.height).toBeGreaterThan(collapsed + 40)

    // <CodeBlock>: the same frame, with its icon and line 2 tinted.
    const block = frames.filter({ hasText: 'aiui run app.py' })
    await block.scrollIntoViewIfNeeded()
    await expect(block.locator('.aiui-code-title')).toHaveText('install.sh')
    await expect(block.locator('.aiui-code-title svg')).toBeVisible()
    expect(await style(lines(block).nth(1), 'background-color')).not.toBe(await style(lines(block).nth(0), 'background-color'))
    expect(errors.pageErrors).toEqual([])
  })
}

test('code options at 390 px: the wrapped block and the page do not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/markdown')
  const titled = page.locator('#main-content .aiui-code-frame').filter({ hasText: 'const greeting' })
  await titled.scrollIntoViewIfNeeded()
  const body = titled.locator('[data-streamdown="code-block-body"]')
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})
