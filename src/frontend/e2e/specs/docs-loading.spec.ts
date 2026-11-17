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

test('first load: a hung manifest is retried and the page still shows within seconds', async ({ page }) => {
  let requests = 0
  await page.route('**/ui-config.json', async (route) => {
    requests += 1
    if (requests === 1) {
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      await route.abort('timedout').catch(() => {})
      return
    }
    await route.continue()
  })
  const started = Date.now()
  await page.goto('/docs/guide/first', { waitUntil: 'commit' })
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible({ timeout: 9_000 })
  expect(Date.now() - started).toBeLessThan(9_000)
  expect(requests).toBeGreaterThanOrEqual(2) // the app's retry (legacy topnav may read it too)
})

test('first load: a page renders from the markdown inlined in its HTML, with no request for it', async ({ page }) => {
  const mdRequests: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('.md')) mdRequests.push(new URL(r.url()).pathname) })
  // Slow manifests: the inlined markdown must not wait on anything but the app.
  await page.route(/\/(ui-config|docs-nav|route-manifest)\.json$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.continue()
  })
  await page.goto('/docs/guide/second')
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(mdRequests.filter((p) => p === '/docs/guide/second.md')).toEqual([])
  await expect(page.locator('#aiui-initial-doc')).toHaveCount(0) // read once, then removed
})

test('first load: without the inlined block, a deep link fetches its page alongside the manifests', async ({ page }) => {
  const started: Record<string, number> = {}
  const finished: Record<string, number> = {}
  page.on('request', (r) => { started[new URL(r.url()).pathname] ??= Date.now() })
  page.on('requestfinished', (r) => { finished[new URL(r.url()).pathname] ??= Date.now() })
  // An HTML without the block (an older build, a host that rewrote it).
  await page.route(/\/docs\/guide\/second\/?$/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(/<script type="application\/json" id="aiui-initial-doc">[\s\S]*?<\/script>/, '')
    await route.fulfill({ response, body })
  })
  await page.route(/\/(ui-config|docs-nav|route-manifest)\.json$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.continue()
  })
  await page.goto('/docs/guide/second')
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(started['/docs/guide/second.md']).toBeDefined()
  expect(started['/docs/guide/second.md']).toBeLessThan(finished['/docs-nav.json'])
  // One request for it: Content.tsx joined the boot prefetch.
  const mdRequests = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.endsWith('/docs/guide/second.md')).length)
  expect(mdRequests).toBe(1)
})

test('first load: when the manifests cannot load, the page says so and offers Retry', async ({ page }) => {
  let failing = true
  await page.route('**/ui-config.json', (route) => (failing ? route.abort('failed') : route.continue()))
  await page.goto('/docs/guide/first')
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't load the docs" })
  await expect(alert).toBeVisible({ timeout: 5_000 })

  failing = false
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('first load: a docs page loads none of the chat, agents or playground code', async ({ page }) => {
  const scripts = new Set<string>()
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.add(new URL(r.url()).pathname) })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // The style layouts are lazy chunks (App.tsx, React.lazy); their files come from the build manifest.
  const manifest = (await (await page.request.get('/aiui-manifest.json')).json()) as Record<string, { file: string }>
  const styleChunks = Object.entries(manifest)
    .filter(([key]) => /^src\/layouts\/(ChatLayout|AgentUILayout|PlaygroundLayout|CopilotWidget)\.tsx$/.test(key))
    .map(([, chunk]) => `/${chunk.file}`)
  expect(styleChunks.length).toBe(4)
  expect(styleChunks.filter((f) => scripts.has(f))).toEqual([])
  expect([...scripts].filter((p) => /\/SurfaceHost-[\w-]+\.js$/.test(p))).toEqual([])
})
