/**
 * The legacy plugins a built docs site loads (`aiui build` + `aiui serve`,
 * fixtures/docs-site): nothing from a CDN, and plugin modules from one
 * versioned URL per build so the browser and the CDN can cache them.
 */
import { expect, test } from '@playwright/test'

test('the docs site loads no plugin from a CDN and imports plugins from a versioned URL', async ({ page, baseURL }) => {
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')

  const origin = new URL(baseURL!).origin
  expect(urls.filter((u) => new URL(u).origin !== origin)).toEqual([])

  const loader = urls.filter((u) => u.includes('/plugins/plugin-loader.js'))
  const plugins = urls.filter((u) => /\/plugins\/[\w-]+\.js(\?|$)/.test(u) && !u.includes('plugin-loader'))
  expect(loader).toHaveLength(1)
  expect(plugins.length).toBeGreaterThan(0)
  const versions = new Set([...loader, ...plugins].map((u) => new URL(u).searchParams.get('v')))
  expect(versions.size).toBe(1)
  expect([...versions][0]).toMatch(/^[0-9a-f]{10}$/)
})

test('in-article docs links still navigate in the app (nav-intercept)', async ({ page }) => {
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true })
  await page.locator('#main-content article').getByRole('link', { name: 'second page' }).click()
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true)
})
