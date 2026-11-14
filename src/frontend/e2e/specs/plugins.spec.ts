/**
 * The example plugin (examples/plugins/aiui-hello-plugin) in the app shell:
 * a React page, a server-driven blocks page, a block type and a chat tool
 * renderer, all loaded from the plugin's own files through the import map.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, sidebarLink } from './support'

test('the manifest lists the plugin and its surfaces', async ({ request }) => {
  const manifest = await (await request.get('/api/shell/manifest')).json()
  expect(manifest.plugins).toContainEqual(expect.objectContaining({ name: 'hello', status: 'ok' }))
  const byId = Object.fromEntries(manifest.pages.map((p: { id: string }) => [p.id, p]))
  expect(byId.hello).toMatchObject({ kind: 'react', title: 'Hello' })
  expect(byId.hello.module).toMatch(/^\/_plugins\/hello\/hello\.js/)
  expect(byId.hello.integrity).toMatch(/^sha384-/)
  expect(byId['hello-blocks']).toMatchObject({ kind: 'blocks' })
  expect(manifest.blocks.map((b: { type: string }) => b.type)).toContain('hello_badge')
  expect(manifest.toolRenderers.map((t: { toolName: string }) => t.toolName)).toContain('get_weather')
})

test('a plugin React page renders in the shell and shares its React', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/overview')
  await (await sidebarLink(page, 'hello')).click()
  await expect(page).toHaveURL(/\/hello$/)

  const hello = page.getByTestId('hello-plugin')
  await expect(hello.getByRole('heading', { name: 'Hello from a plugin' })).toBeVisible()
  // Rendered by the shell's Markdown component, imported from @aiui/sdk.
  await expect(hello.locator('code', { hasText: 'static/hello.js' })).toBeVisible()
  // useState from the shell's React: a second React copy would throw "Invalid hook call".
  const counter = hello.getByTestId('hello-count')
  await expect(counter).toHaveText('Clicked 0 times')
  await counter.click()
  await counter.click()
  await expect(counter).toHaveText('Clicked 2 times')
  // The shell chrome is still the shell's.
  await expect(page.locator('[data-aiui-shell-header]')).toContainText('Hello')
  expect(errors.pageErrors).toEqual([])
  expect(errors.consoleErrors.filter((e) => /hook|react/i.test(e))).toEqual([])
})

test('a plugin page opens from its URL', async ({ page }) => {
  await page.goto('/hello')
  await expect(page.getByTestId('hello-count')).toBeVisible()
})

test('a server-driven blocks page renders core, plugin and legacy blocks, and runs actions', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/hello-blocks')
  const area = page.locator('[data-aiui-page="hello-blocks"]')
  // The page's own state (a legacy-rendered block carries data-status too).
  await expect(area.locator('.aiui-block-page[data-status="ready"]')).toBeVisible()
  await expect(area.getByRole('heading', { name: 'Hello from a plugin' })).toBeVisible()
  await expect(area.getByRole('table')).toContainText('get_weather')
  // The plugin's own block type.
  await expect(area.getByTestId('hello-badge')).toContainText("Rendered by the plugin's own block")
  // No block is left unrendered.
  await expect(area.locator('[data-aiui-block-error]')).toHaveCount(0)

  // An action posts to the plugin's route and the page shows the new tree.
  await area.getByRole('button', { name: 'Say hello' }).click()
  await expect(area).toContainText(/Hello #\d+ from Python\./)
  expect(errors.pageErrors).toEqual([])
})

test('a plugin tool renderer draws its tool call in chat', async ({ page }) => {
  await page.goto('/chat')
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('weather plain')
  await composer.press('Enter')
  const weather = page.locator('[data-role="assistant"]').last().getByTestId('hello-weather')
  await expect(weather).toContainText('Paris')
  await expect(weather).toContainText('21°')
  await expect(weather).toContainText('sunny')
})

test('a plugin that fails to load shows an error and a toast, not a blank shell', async ({ page }) => {
  // The plugin's module fails to load (as a broken deploy would): the shell
  // must keep working and say which page failed.
  await page.route('**/_plugins/hello/hello.js*', (route) => route.fulfill({ status: 500, body: 'boom' }))
  await page.goto('/hello')
  await expect(page.locator('[data-aiui-shell-sidebar]')).toBeVisible()
  await expect(page.getByTestId('hello-plugin')).toHaveCount(0)
  await expect(page.locator('[data-aiui-page="hello"]').getByRole('alert')).toContainText('is unavailable')
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Plugin "hello" failed to load' })).toBeVisible()
  // Other pages still work.
  await (await sidebarLink(page, 'logs')).click()
  await expect(page.locator('[data-aiui-page="logs"] [data-status="ready"]')).toBeVisible()
})

test('a custom.js registerView takes priority over the page\'s server handler (set_custom_js)', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/overview')
  await (await sidebarLink(page, 'client-view')).click()
  const area = page.locator('[data-aiui-page="client-view"]')
  await expect(area.getByTestId('client-view')).toHaveText('Rendered by custom.js registerView')
  await expect(area.locator('.aiui-legacy-host[data-status="ready"]')).toBeVisible()
  await expect(area).not.toContainText('Server fallback')
  // ...also when the page is opened from its URL.
  await page.goto('/client-view')
  await expect(page.getByTestId('client-view')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})
