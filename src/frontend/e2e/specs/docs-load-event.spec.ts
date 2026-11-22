/**
 * The page's `load` event waits for every request in flight. Optional work
 * (the previous / next page prefetch, the GitHub star count, the telemetry
 * chunk) must start after it, so a slow or stuck optional request never makes
 * `load` late (src/docs/afterLoad.ts).
 */
import { expect, test } from '@playwright/test'

test('neighbour pages are prefetched after load, never while the page loads', async ({ page }) => {
  // A slow image in the page keeps it loading for 3 s after its content shows
  // (an image in flight holds the load event, as a stuck request does).
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    const body = (await response.text()).replace('</body>', '<img src="/__slow.gif" alt="" width="1" height="1"></body>')
    await route.fulfill({ response, body })
  })
  await page.route('**/__slow.gif', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }).catch(() => {})
  })
  await page.goto('/docs/guide/first', { waitUntil: 'commit' })
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await page.waitForLoadState('load')
  // The neighbour (the next page) is still prefetched, once loaded.
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
    .some((e) => e.name.includes('/docs/guide/second.source.md'))), { timeout: 8_000 }).toBe(true)
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const early = performance.getEntriesByType('resource')
      .filter((e) => e.name.endsWith('.source.md') && e.startTime < nav.loadEventStart)
      .map((e) => new URL(e.name).pathname)
    return { load: nav.loadEventStart, early }
  })
  expect(timing.load).toBeGreaterThan(2_500) // the slow plugin did hold the load
  expect(timing.early).toEqual([])
})
