/**
 * Reloading a page URL shows the page, not JSON (dashboard and app shell).
 *
 * `/sessions` and `/agents` are JSON APIs as well as page URLs. The dashboard
 * pushes `/<page id>` into the address bar, so a reload or a pasted link used
 * to show the raw API body. The same spec runs against the default dashboard
 * (project page-reload-dashboard) and the app shell (page-reload-app); the
 * pytest twin is tests/unit/test_page_navigation_browser.py.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const PATHS = ['/sessions', '/agents'] as const

async function isAppShell(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.getAttribute('data-aiui-shell') === 'react')
}

/** The page area for `id` has rendered, in whichever UI this server runs. */
async function expectPageRendered(page: Page, id: string) {
  if (await isAppShell(page)) {
    await expect(page.locator('[data-aiui-shell-root]')).toBeVisible()
    await expect(page.locator(`[data-aiui-page="${id}"]`)).toBeVisible()
  } else {
    await expect(page.locator('.db-sidebar')).toBeVisible()
    await expect(page.locator(`.db-nav-item.active[data-nav-id="${id}"]`)).toBeVisible()
  }
}

for (const path of PATHS) {
  test(`reloading ${path} shows the page`, async ({ page }) => {
    const errors = collectPageErrors(page)
    const id = path.slice(1)
    let res = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(res?.headers()['content-type'] ?? '').toMatch(/^text\/html/)
    await expectPageRendered(page, id)

    res = await page.reload({ waitUntil: 'domcontentloaded' })
    expect(res?.headers()['content-type'] ?? '').toMatch(/^text\/html/)
    await expectPageRendered(page, id)
    const body = (await page.locator('body').innerText()).trimStart()
    expect(body.startsWith('{') || body.startsWith('[')).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}

test('the view still reads its API as JSON', async ({ page }) => {
  const api = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/sessions' && r.request().resourceType() === 'fetch',
  )
  await page.goto('/sessions', { waitUntil: 'domcontentloaded' })
  const res = await api
  expect(res.headers()['content-type'] ?? '').toMatch(/^application\/json/)
})
