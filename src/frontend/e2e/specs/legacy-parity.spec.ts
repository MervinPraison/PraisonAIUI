/**
 * The default style (the vanilla dashboard) must look the same as v0.3.153.
 *
 * Baselines live in e2e/__baseline__/<platform>/ and are captured from the
 * v0.3.153 tree itself by the `legacy-baseline` project (same spec, other
 * server): `npm run test:e2e:baseline`. A platform without baselines skips the
 * screenshot comparisons (see e2e/README.md); the DOM checks always run.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, FIXED_TIME, hasHorizontalOverflow, setDashboardMode, toRgb } from './support'

const PAGES = ['overview', 'chat', 'logs', 'usage', 'agents', 'approvals', 'jobs'] as const
const MODES = ['dark', 'light'] as const

/**
 * Allowed share of differing pixels. The `--db-p-*` token pass keeps every
 * original colour as its fallback, so the dashboard is expected to be
 * identical in both modes; the allowance only absorbs anti-aliasing noise.
 */
const MAX_DIFF = 0.005

/**
 * Pages opened from the sidebar instead of by URL. Under the dashboard style
 * GET /agents is the agent-list API (JSON), in v0.3.153 and now.
 */
const CLICK_ONLY = new Set<string>(['agents'])

/**
 * Parts of a page that show live server state rather than design: the log
 * stream (whatever the server logged so far, and its count) and the usage
 * chart's time axis (hours of the server's clock, which the frozen page clock
 * does not reach). They are painted over in both the baseline and the
 * comparison.
 */
const VOLATILE = ['.aiui-logs-content', '.aiui-logs-count', 'svg.aiui-usage-chart text']

async function openDashboardPage(page: Page, id: string, mode: (typeof MODES)[number]) {
  await setDashboardMode(page, mode)
  await page.clock.setFixedTime(FIXED_TIME)
  if (CLICK_ONLY.has(id)) {
    await page.goto('/overview')
    await page.locator(`.db-nav-item[data-nav-id="${id}"]`).click()
  } else {
    await page.goto(`/${id}`)
  }
  await expect(page.locator('.db-sidebar')).toBeVisible()
  await expect(page.locator(`.db-nav-item.active[data-nav-id="${id}"]`)).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Views paint after their first fetch; give late DOM writes a moment.
  await page.waitForTimeout(600)
}

for (const mode of MODES) {
  for (const id of PAGES) {
    test(`/${id} matches v0.3.153 (${mode})`, async ({ page }, testInfo) => {
      const name = `${id}-${mode}.png`
      const baseline = testInfo.snapshotPath(name)
      const capturing = testInfo.project.name === 'legacy-baseline'
      test.skip(
        !capturing && !existsSync(baseline),
        `no ${process.platform} baseline (${path.basename(path.dirname(baseline))}/${name}); see e2e/README.md`,
      )

      const errors = collectPageErrors(page)
      await openDashboardPage(page, id, mode)

      await expect(page).toHaveScreenshot(name, {
        maxDiffPixelRatio: MAX_DIFF,
        mask: VOLATILE.map((selector) => page.locator(selector)),
      })
      expect(errors.pageErrors, 'uncaught page errors').toEqual([])
    })
  }
}

test('the page background covers overscroll in both modes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'legacy-baseline', 'checks the current build only')
  // index.css is loaded by the dashboard too. Its base layer must not repaint
  // <html>/<body>: the dashboard paints its own background on both, and a
  // mismatch shows as a band of the wrong colour when the page overscrolls.
  for (const mode of MODES) {
    await setDashboardMode(page, mode)
    await page.goto('/overview')
    await expect(page.locator('.db-sidebar')).toBeVisible()
    await page.waitForLoadState('networkidle')
    const colours = await page.evaluate(() => {
      const css = (el: Element) => getComputedStyle(el).backgroundColor
      return {
        html: css(document.documentElement),
        body: css(document.body),
        dbBg: getComputedStyle(document.documentElement).getPropertyValue('--db-bg').trim(),
      }
    })
    const expected = await toRgb(page, colours.dbBg)
    const where = `${mode}: ${JSON.stringify(colours)}`
    // The dashboard paints <body> with --db-bg and leaves <html> alone.
    expect(colours.body, where).toBe(expected)
    expect(['rgba(0, 0, 0, 0)', expected], where).toContain(colours.html)
    expect(await hasHorizontalOverflow(page), `${mode}: horizontal overflow`).toBe(false)
  }
})
