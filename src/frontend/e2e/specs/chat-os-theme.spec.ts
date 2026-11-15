/**
 * The React chat style (`style: chat`, the default of `aiui run`) follows the
 * OS colour scheme when neither the app nor the viewer chose a mode, and
 * keeps following it live. An app mode (set_theme / YAML) or the viewer's
 * stored choice wins over the OS.
 *
 * Servers: AIUI_E2E_CHAT_SYSTEM_URL is a chat-style app that never calls
 * set_theme() (it serves `site.theme.mode: system`); the project's own
 * baseURL calls set_theme(preset='zinc'), which is dark.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, contrastRatio, toRgb, type ColorMode } from './support'

const SYSTEM_URL = process.env.AIUI_E2E_CHAT_SYSTEM_URL || ''

async function openChat(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/`)
  await expect(page.getByPlaceholder('Type a message...')).toBeVisible()
}

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'))

/** Whether the painted page background is light (more contrast with black than with white). */
async function backgroundIsLight(page: Page): Promise<boolean> {
  const bg = await toRgb(page, await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
  return contrastRatio(bg, 'rgb(0, 0, 0)') > contrastRatio(bg, 'rgb(255, 255, 255)')
}

test.beforeEach(() => {
  expect(SYSTEM_URL, 'AIUI_E2E_CHAT_SYSTEM_URL (set by playwright.config.ts)').not.toBe('')
})

for (const scheme of ['light', 'dark'] as const satisfies readonly ColorMode[]) {
  test.describe(`OS colour scheme ${scheme}`, () => {
    test.use({ colorScheme: scheme })

    test(`an app with no theme renders ${scheme}`, async ({ page }) => {
      const errors = collectPageErrors(page)
      await openChat(page, SYSTEM_URL)
      await expect.poll(() => isDark(page)).toBe(scheme === 'dark')
      expect(await backgroundIsLight(page)).toBe(scheme === 'light')
      expect(errors.pageErrors).toEqual([])
    })
  })
}

test.describe('live and precedence', () => {
  test.use({ colorScheme: 'light' })

  test('the page follows the OS when it changes', async ({ page }) => {
    await openChat(page, SYSTEM_URL)
    await expect.poll(() => isDark(page)).toBe(false)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => isDark(page)).toBe(true)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => isDark(page)).toBe(false)
  })

  test("the viewer's stored choice wins over the OS", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('aiui-theme-preference', 'dark'))
    await openChat(page, SYSTEM_URL)
    await expect.poll(() => isDark(page)).toBe(true)
    await page.emulateMedia({ colorScheme: 'light' })
    expect(await isDark(page)).toBe(true)
  })

  test("the app's mode (set_theme, dark) wins over a light OS", async ({ page, baseURL }) => {
    await openChat(page, baseURL!)
    await expect.poll(() => isDark(page)).toBe(true)
    expect(await backgroundIsLight(page)).toBe(false)
  })
})
