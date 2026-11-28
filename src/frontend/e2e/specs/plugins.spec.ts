/**
 * The example plugin (examples/plugins/aiui-hello-plugin) in the app shell:
 * a React page, a server-driven blocks page, a block type and a chat tool
 * renderer, all loaded from the plugin's own files through the import map.
 */
import { createHash } from 'node:crypto'
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

// ── shell contributions: nav_groups(), settings(), themes() (G13) ──────

test('the plugin record carries its nav group, settings section and theme preset', async ({ request }) => {
  const manifest = await (await request.get('/api/shell/manifest')).json()
  const hello = manifest.plugins.find((p: { name: string }) => p.name === 'hello')
  expect(hello.navGroups).toEqual([{ name: 'Hello', order: 250, folded: false }])
  expect(hello.settings).toEqual([
    expect.objectContaining({ id: 'greeting', title: 'Hello plugin', endpoint: '/api/plugins/hello/settings/greeting' }),
  ])
  expect(hello.themes).toEqual([expect.objectContaining({ id: 'sunrise', label: 'Sunrise' })])
})

test("the plugin's nav group holds its pages at the declared position", async ({ page }) => {
  await page.goto('/overview')
  const sidebar = page.locator('[data-aiui-shell-sidebar]')
  const group = sidebar.locator('section[aria-label="Hello"]')
  await expect(group.locator('a[data-page-id="hello"]')).toBeVisible()
  await expect(group.locator('a[data-page-id="hello-blocks"]')).toBeVisible()
  // order 250: after the app's second group (Work, 200), before its third (Control, 300).
  const names = await sidebar
    .locator('nav[aria-label="Pages"] > section')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names.indexOf('Hello')).toBe(names.indexOf('Work') + 1)
  expect(names.indexOf('Control')).toBe(names.indexOf('Hello') + 1)
})

test("the plugin's settings section renders in the settings dialog and its value reaches Python", async ({ page, request }) => {
  const errors = collectPageErrors(page)
  const endpoint = '/api/plugins/hello/settings/greeting'
  try {
    await page.goto('/hello-blocks')
    await page.getByRole('button', { name: 'Plugin settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Plugin settings' })
    // builtin.layouts' Appearance section (order 10) comes first; pick the plugin's.
    const sectionButton = dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hello plugin' })
    await sectionButton.click()
    await expect(dialog.getByRole('heading', { name: 'Hello plugin' })).toBeVisible()
    await expect(sectionButton).toHaveAttribute('aria-current', 'true')
    const greeting = dialog.getByLabel('Greeting')
    await expect(greeting).toHaveValue('Hello')
    await expect(dialog.getByRole('combobox', { name: 'Tone' })).toContainText('Plain')
    const save = dialog.getByRole('button', { name: 'Save' })
    await expect(save).toBeDisabled()
    await greeting.fill('Howdy')
    await save.click()
    await expect(page.locator('[data-sonner-toast]', { hasText: 'Hello plugin saved' })).toBeVisible()
    expect((await (await request.get(endpoint)).json()).values).toMatchObject({ greeting: 'Howdy', tone: 'plain' })

    // The saved value is read back when the dialog opens again (after a reload).
    await page.reload()
    await page.getByRole('button', { name: 'Plugin settings' }).click()
    const reopened = page.getByRole('dialog', { name: 'Plugin settings' })
    await reopened.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hello plugin' }).click()
    await expect(reopened.getByLabel('Greeting')).toHaveValue('Howdy')
    await page.keyboard.press('Escape')

    // The plugin's Python code uses it.
    const area = page.locator('[data-aiui-page="hello-blocks"]')
    await area.getByRole('button', { name: 'Say hello' }).click()
    await expect(area).toContainText(/Howdy #\d+ from Python\./)
    expect(errors.pageErrors).toEqual([])
  } finally {
    await request.put(endpoint, { data: { values: { greeting: 'Hello', tone: 'plain' } } })
  }
})

test("the plugin's theme preset is offered in the palette and re-seeds the tokens", async ({ page }) => {
  await page.goto('/overview')
  const accent = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--seed-accent').trim())
  const before = await accent()
  const search = page.getByRole('button', { name: 'Search pages and commands' }).first()
  await search.click()
  await page.getByRole('option', { name: 'Sunrise theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-aiui-preset', 'hello.sunrise')
  expect(await accent()).toBe('#c2410c')
  // Back to the app's own theme.
  await search.click()
  await page.getByRole('option', { name: 'Default theme' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-aiui-preset', /.+/)
  expect(await accent()).toBe(before)
})

// ── the plugin's nav group and settings in every layout (R2) ──────────
// The classic frame draws them in its sidebar and header; each built-in
// layout must list the plugin's declared group and open its settings too,
// not only through the palette. `?layout=` previews a layout for the tab.
for (const layout of ['chat', 'chat-canvas', 'workbench', 'command', 'mission', 'guided']) {
  test(`layout ${layout}: the plugin's nav group pages and its settings are in the frame`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(`/overview?layout=${layout}`)
    await expect(page.locator('[data-aiui-layout-frame]').first()).toBeVisible()
    const frame = page.locator('[data-aiui-layout-frame]').first()
    for (const id of ['hello', 'hello-blocks']) {
      await expect(frame.locator(`a[data-aiui-nav-item="${id}"]:visible`).first()).toBeVisible()
    }
    await frame.locator('a[data-aiui-nav-item="hello"]:visible').first().click()
    await expect(page).toHaveURL(/\/hello$/)
    await expect(page.getByTestId('hello-count')).toBeVisible()

    await frame.getByRole('button', { name: 'Plugin settings' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Plugin settings' })
    await expect(dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Hello plugin' })).toBeVisible()
    expect(errors.pageErrors).toEqual([])
  })
}

test('a React plugin using pageLinkProps stays in-document, supports Back, and keeps Cmd/Ctrl-click native; useLiveData retains data on refresh error', async ({ page }) => {
  const errors = collectPageErrors(page)
  let reads = 0
  let failNext = false
  await page.route('**/api/test-live-data*', (route) => {
    reads += 1
    if (failNext) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'temporary outage' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reading: reads }) })
  })
  const pluginCode = `
    import { createElement as h } from 'react'
    import { fetchJson, pageLinkProps, useLiveData } from '@aiui/sdk'
    export default function LiveTabPage({ page }) {
      const { data, error, refreshing, refresh } = useLiveData(
        page.id,
        (signal) => fetchJson('/api/test-live-data?page=' + encodeURIComponent(page.id), { signal }),
      )
      return h('div', { 'data-testid': 'sdk-live-plugin' },
        h('a', { ...pageLinkProps('hello-blocks'), 'data-testid': 'tab-blocks' }, 'Blocks tab'),
        h('button', { type: 'button', onClick: () => void refresh(), disabled: refreshing, 'data-testid': 'live-refresh' }, 'Refresh'),
        data && h('span', { 'data-testid': 'live-value' }, 'reading=' + data.reading),
        error && h('p', { role: 'alert', 'data-testid': 'live-error' }, error.message),
      )
    }
  `
  const sri = 'sha384-' + createHash('sha384').update(pluginCode).digest('base64')
  await page.route('**/_plugins/hello/hello.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: pluginCode }),
  )

  // Substitute the test module's real SRI hash into the HTML (both importmap
  // integrity and #aiui-boot) so the browser verifies and loads it cleanly.
  await page.route('**/hello', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const res = await route.fetch()
    let html = await res.text()
    const match = html.match(/"\/_plugins\/hello\/hello\.js"\s*:\s*"(sha384-[^"]+)"/)
    if (match) html = html.split(match[1]).join(sri)
    await route.fulfill({ response: res, body: html })
  })

  await page.goto('/hello')
  await expect(page.getByTestId('live-value')).toHaveText('reading=1')

  // Refresh fails -> last successful reading stays visible alongside the error.
  failNext = true
  await page.getByTestId('live-refresh').click()
  await expect(page.getByTestId('live-error')).toContainText('temporary outage')
  await expect(page.getByTestId('live-value')).toHaveText('reading=1')

  // Modified click (Ctrl/Meta) is not intercepted by pageLinkProps (keeps native new-tab behaviour).
  const modPrevented = await page.getByTestId('tab-blocks').evaluate((el) => {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(modPrevented).toBe(false)
  await expect(page).toHaveURL(/\/hello$/)

  // Ordinary click stays in the current document (0 document requests) and Back works.
  let docRequests = 0
  page.on('request', (req) => {
    if (req.resourceType() === 'document') docRequests += 1
  })
  await page.getByTestId('tab-blocks').click()
  await expect(page).toHaveURL(/\/hello-blocks$/)
  await expect(page.locator('[data-aiui-page="hello-blocks"] .aiui-block-page[data-status="ready"]')).toBeVisible()
  expect(docRequests).toBe(0)

  await page.goBack()
  await expect(page).toHaveURL(/\/hello$/)
  await expect(page.getByTestId('sdk-live-plugin')).toBeVisible()
  expect(docRequests).toBe(0)
  expect(errors.pageErrors).toEqual([])
})
