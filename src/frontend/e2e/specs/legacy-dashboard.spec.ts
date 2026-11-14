/**
 * Behaviour of the default style (the vanilla dashboard) that the parity
 * screenshots do not cover: chat markdown, the order of a streamed turn, and
 * light/dark mode. Runs in the `dashboard-legacy` project (default style,
 * scripted provider: "markdown" replies with a table, "slow" streams for a
 * few seconds, every reply has reasoning and one tool call).
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, toRgb } from './support'

/** Relative luminance of an `rgb()`/`rgba()` colour (0 black, 1 white). */
function luminance(css: string): number {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

async function openChat(page: Page) {
  await page.goto('/chat')
  await expect(page.locator('#chat-input')).toBeVisible()
  await expect(page.locator('#chat-header-status')).toHaveText('connected')
}

async function send(page: Page, text: string) {
  await page.locator('#chat-input').fill(text)
  await page.locator('#chat-input').press('Enter')
}

/** Class names of the transcript rows, top to bottom. */
async function transcript(page: Page): Promise<string[]> {
  return page.locator('#chat-messages > *').evaluateAll((rows) =>
    rows.map((r) => {
      const c = r.className
      if (c.includes('chat-reasoning')) return 'reasoning'
      if (c.includes('chat-tool-call')) return 'tool'
      if (c.includes('chat-msg-user')) return 'user'
      if (c.includes('chat-msg-assistant')) return 'answer'
      return c
    }),
  )
}

test.describe('chat', () => {
  test('a markdown table in a reply renders as a table', async ({ page }) => {
    const errors = collectPageErrors(page)
    await openChat(page)
    await send(page, 'markdown please')
    const answer = page.locator('.chat-msg-assistant .chat-msg-content').last()
    const table = answer.locator('table.chat-table')
    await expect(table).toBeVisible()
    await expect(table.locator('thead th')).toHaveText(['Model', 'Tokens'])
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await expect(answer).not.toContainText('|---')
    // Headings and code still render as before.
    await expect(answer.locator('h2')).toHaveText('Markdown sample')
    await expect(answer.locator('pre.chat-code-block code.language-python')).toBeVisible()
    expect(errors.pageErrors).toEqual([])
  })

  test('reasoning and the tool step stay above the answer while it streams', async ({ page }) => {
    await openChat(page)
    await send(page, 'slow reply')
    await expect(page.locator('#chat-header-status')).toHaveText('streaming…')
    await expect(page.locator('#chat-messages .chat-tool-call')).toHaveCount(1)
    await expect(page.locator('.chat-msg-assistant .chat-msg-content').last()).toContainText('w3')
    const live = await transcript(page)
    expect(live.slice(-4)).toEqual(['reasoning', 'reasoning', 'tool', 'answer'])
    await expect(page.locator('#chat-header-status')).toHaveText('connected', { timeout: 30_000 })
    expect((await transcript(page)).slice(-4)).toEqual(live.slice(-4))
  })
})

test.describe('light and dark', () => {
  test('without a choice the dashboard follows the OS', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/overview')
      await expect(page.locator('.db-sidebar')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-db-mode', scheme)
    }
  })

  test('a light pick on the Theme page survives a reload', async ({ page, request }) => {
    const errors = collectPageErrors(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/theme-picker')
    await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'dark')
    await page.locator('.tp-mode-btn[data-mode="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'light')
    try {
      await page.reload()
      await expect(page.locator('.db-sidebar')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'light')
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(bg).toBe(await toRgb(page, '#fafafa'))
      await expect(page.locator('.tp-mode-btn[data-mode="light"]')).toHaveClass(/active/)
      expect(errors.pageErrors).toEqual([])
    } finally {
      // PUT /api/theme also set the server's mode; leave it as it was.
      await request.put('/api/theme', { data: { mode: 'dark' } })
    }
  })

  test('light mode reaches the log panel and form fields', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/logs')
    const panel = page.locator('.aiui-logs-content')
    await expect(panel).toBeVisible()
    const panelBg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(luminance(panelBg), `log panel ${panelBg}`).toBeGreaterThan(0.8)
    await page.goto('/config')
    const field = page.locator('.aiui-config-field input').first()
    await expect(field).toBeVisible()
    const [fieldBg, fieldText] = await field.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.backgroundColor, s.color]
    })
    expect(luminance(fieldBg), `input ${fieldBg}`).toBeGreaterThan(0.8)
    expect(luminance(fieldText), `input text ${fieldText}`).toBeLessThan(0.1)
  })
})
