/**
 * Theme presets on the React chat style (`style: chat`): two servers that
 * differ only in `set_theme(preset=...)`, one neutral (zinc) and one coloured
 * (rose). The preset must reach the page as colours, and those colours must
 * stay readable.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, contrastRatio, setColorMode, toRgb, type ColorMode } from './support'

const ROSE_URL = process.env.AIUI_E2E_ROSE_URL || ''
const AA = 4.5

interface Palette {
  primary: string
  primaryForeground: string
  background: string
  foreground: string
  mutedForeground: string
}

async function readPalette(page: Page): Promise<Palette> {
  // Read the colours as painted: resolve each token on a real element.
  const raw = await page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.appendChild(probe)
    const read = (token: string) => {
      probe.style.color = `var(${token})`
      return getComputedStyle(probe).color
    }
    const out = {
      primary: read('--primary'),
      primaryForeground: read('--primary-foreground'),
      background: read('--background'),
      foreground: read('--foreground'),
      mutedForeground: read('--muted-foreground'),
    }
    probe.remove()
    return out
  })
  const palette = {} as Palette
  for (const key of Object.keys(raw) as (keyof Palette)[]) palette[key] = await toRgb(page, raw[key])
  return palette
}

async function openChatStyle(page: Page, baseUrl: string, mode: ColorMode) {
  await setColorMode(page, mode)
  await page.goto(`${baseUrl}/`)
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(mode === 'dark')
}

for (const mode of ['light', 'dark'] as const) {
  test(`zinc and rose presets paint different, readable colours (${mode})`, async ({ page, baseURL }) => {
    expect(ROSE_URL, 'AIUI_E2E_ROSE_URL (set by playwright.config.ts)').not.toBe('')
    const errors = collectPageErrors(page)

    await openChatStyle(page, baseURL!, mode)
    const zinc = await readPalette(page)
    await openChatStyle(page, ROSE_URL, mode)
    const rose = await readPalette(page)

    expect(rose.primary, 'the rose preset changes --primary').not.toBe(zinc.primary)
    // Rose is a red hue: red is its strongest channel. Zinc is neutral.
    const [r, g, b] = rose.primary.match(/\d+/g)!.map(Number)
    expect(r, `rose --primary ${rose.primary}`).toBeGreaterThan(Math.max(g, b))
    const zincChannels = zinc.primary.match(/\d+/g)!.map(Number)
    expect(Math.max(...zincChannels) - Math.min(...zincChannels), `zinc --primary ${zinc.primary}`).toBeLessThan(24)

    for (const [name, palette] of [
      ['zinc', zinc],
      ['rose', rose],
    ] as const) {
      const where = `${name} ${mode} ${JSON.stringify(palette)}`
      expect(contrastRatio(palette.primary, palette.primaryForeground), `primary button text, ${where}`).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(palette.foreground, palette.background), `body text, ${where}`).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(palette.mutedForeground, palette.background), `muted text, ${where}`).toBeGreaterThanOrEqual(AA)
    }
    expect(errors.pageErrors).toEqual([])
  })
}

test('the chat style renders a stored reply as markdown', async ({ page, request }) => {
  const errors = collectPageErrors(page)
  await openChatStyle(page, '', 'dark')
  const message = `markdown plain ${Date.now()}`
  const input = page.getByPlaceholder('Type a message...')
  await input.fill(message)
  await input.press('Enter')
  await expect(page.getByText(message).first()).toBeVisible()

  // In this style a brand-new conversation does not paint its first reply
  // while it streams (same in v0.3.153); it shows once the conversation is
  // opened again. Wait for the server to store the reply, then reopen it.
  await expect
    .poll(
      async () => {
        const { sessions } = await (await request.get('/sessions')).json()
        const runs = await Promise.all(
          sessions.map(async (s: { id: string }) => (await request.get(`/sessions/${s.id}/runs`)).text()),
        )
        return runs.some((r) => r.includes(message) && r.includes('flowchart LR'))
      },
      { timeout: 30_000, message: 'the reply was never stored' },
    )
    .toBe(true)
  await page.reload()
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible()
  await page.getByRole('button', { name: /markdown plain/i }).first().click()

  await expect(page.getByRole('heading', { name: 'Markdown sample' })).toBeVisible()
  await expect(page.locator('[data-streamdown="code-block"] [style*="--shiki-dark"]').first()).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('svg[aria-roledescription^="flowchart"]')).toBeVisible({ timeout: 30_000 })
  expect(errors.pageErrors).toEqual([])
})
