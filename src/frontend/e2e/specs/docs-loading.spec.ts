/**
 * Docs page loading on a built site (`aiui build` + `aiui serve`,
 * fixtures/docs-site): one stalled request, rapid clicks and a failed page
 * must not leave the reader on the loading skeleton (src/docs/docLoader.ts).
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const sidebarLink = (page: Page, href: string) => page.locator(`aside a[data-nav-path][href="${href}"]`).first()

test('a request that hangs is retried: the page shows within seconds, not after the hang', async ({ page }) => {
  let requests = 0
  await page.route('**/docs/guide/second.md', async (route) => {
    requests += 1
    if (requests === 1) {
      // The owner's failure mode: one connection stalls for ~20-30 s.
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      await route.abort('timedout').catch(() => {})
      return
    }
    await route.continue()
  })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  const clicked = Date.now()
  await sidebarLink(page, '/docs/guide/second').click()
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible({ timeout: 8_000 })
  expect(Date.now() - clicked).toBeLessThan(8_000)
  expect(requests).toBe(2)
  await expect(page.locator('.aiui-docs-skeleton')).toHaveCount(0)
})

test('rapid clicks through the sidebar: the last click wins, promptly', async ({ page }) => {
  const errors = collectPageErrors(page)
  // Every page takes 400 ms, so the clicks overtake each other.
  await page.route('**/*.md', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue().catch(() => {})
  })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  const order = ['/docs/guide/second', '/docs/markdown', '/', '/docs/guide/first', '/docs/guide/second', '/', '/docs/guide/first', '/docs/markdown']
  for (const href of order) {
    await sidebarLink(page, href).click()
    await page.waitForTimeout(80)
  }
  const lastClick = Date.now()
  await expect(page).toHaveURL(/\/docs\/markdown$/)
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible({ timeout: 3_000 })
  expect(Date.now() - lastClick).toBeLessThan(3_000)
  await expect(page.locator('.aiui-docs-skeleton')).toHaveCount(0)
  await expect(page.locator('#main-content h1')).toHaveCount(1)
  expect(errors.pageErrors).toEqual([])
})

test('a page that cannot load says so and offers Retry', async ({ page }) => {
  let failing = true
  await page.route('**/docs/guide/second.md', (route) => (failing ? route.abort('failed') : route.continue()))
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  await sidebarLink(page, '/docs/guide/second').click()
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't load this page" })
  await expect(alert).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.aiui-docs-skeleton')).toHaveCount(0)
  await expect(page.getByText('would be displayed here')).toHaveCount(0)

  failing = false
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('a page read before shows at once from memory, without a new request', async ({ page }) => {
  const fetched: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('.md')) fetched.push(new URL(r.url()).pathname)
  })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await sidebarLink(page, '/docs/markdown').click()
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  const before = fetched.filter((p) => p === '/docs/guide/first.md').length

  await sidebarLink(page, '/docs/guide/first').click()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  expect(fetched.filter((p) => p === '/docs/guide/first.md').length).toBe(before)
})
