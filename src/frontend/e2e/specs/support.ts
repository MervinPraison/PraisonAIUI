/** Shared helpers for the Playwright specs. */
import type { Page } from '@playwright/test'

export type ColorMode = 'light' | 'dark'

/** Frozen `Date.now()` for screenshots (timers keep running). */
export const FIXED_TIME = new Date('2026-01-15T10:00:00Z')

export interface PageErrors {
  /** Uncaught exceptions and unhandled rejections. */
  pageErrors: string[]
  /** console.error output. */
  consoleErrors: string[]
}

/** Record uncaught errors and console errors of a page from now on. */
export function collectPageErrors(page: Page): PageErrors {
  const errors: PageErrors = { pageErrors: [], consoleErrors: [] }
  page.on('pageerror', (e) => errors.pageErrors.push(String(e).slice(0, 300)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.consoleErrors.push(m.text().slice(0, 300))
  })
  return errors
}

/**
 * Choose light or dark for the React UIs before the page loads. They read the
 * same key the server's theme bootstrap script reads.
 */
export async function setColorMode(page: Page, mode: ColorMode): Promise<void> {
  await page.emulateMedia({ colorScheme: mode })
  await page.addInitScript((m) => {
    try {
      localStorage.setItem('aiui-theme-preference', m)
    } catch {
      /* storage unavailable */
    }
  }, mode)
}

/**
 * Choose light or dark for the vanilla dashboard, as `site.theme.darkMode`
 * (`aiui.set_theme(dark_mode=...)`) would: the dashboard reads it from
 * /ui-config.json on load, so the response is patched on its way to the page.
 */
export async function setDashboardMode(page: Page, mode: ColorMode): Promise<void> {
  await setColorMode(page, mode)
  await page.route('**/ui-config.json*', async (route) => {
    const response = await route.fetch()
    const config = await response.json()
    config.site = { ...(config.site ?? {}), theme: { ...(config.site?.theme ?? {}), darkMode: mode === 'dark' } }
    await route.fulfill({ response, json: config })
  })
}

/** True when the document scrolls sideways. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

/** WCAG relative luminance contrast of two `rgb()`/`rgba()` strings. */
export function contrastRatio(a: string, b: string): number {
  const lum = (css: string) => {
    const m = css.match(/[\d.]+/g)
    if (!m || m.length < 3) throw new Error(`not an rgb colour: ${css}`)
    const [r, g, bl] = m.slice(0, 3).map((v) => {
      const c = Number(v) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Resolve any CSS colour (oklch, color-mix, hex, ...) to `rgb(r, g, b)` in the
 * page, by painting one canvas pixel.
 */
export async function toRgb(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((value) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#000'
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  }, cssColor)
}

/**
 * The sidebar link of a page, with every folded sidebar group opened first
 * (rarely used groups such as Examples start folded).
 */
export async function sidebarLink(page: Page, id: string) {
  const folded = page.locator('[data-aiui-shell-sidebar] [data-group-toggle][aria-expanded="false"]:not([disabled])')
  for (let i = await folded.count(); i > 0; i--) await folded.first().click()
  return page.locator(`[data-aiui-shell-sidebar] a[data-page-id="${id}"]`)
}
