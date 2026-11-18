/**
 * Behaviour of the default style (the vanilla dashboard) that the parity
 * screenshots do not cover: chat markdown, the order of a streamed turn, and
 * light/dark mode. Runs in the `dashboard-legacy` project (default style,
 * scripted provider: "markdown" replies with a table, "slow" streams for a
 * few seconds, every reply has reasoning and one tool call).
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, setDashboardMode, toRgb } from './support'

/** Relative luminance of an `rgb()`/`rgba()` colour (0 black, 1 white). */
function luminance(css: string): number {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

async function openChat(page: Page) {
  await page.goto('/chat')
  await expect(page.locator('#chat-input')).toBeVisible()
  await expect(page.locator('#chat-header-status')).toHaveText('connected')
}

async function send(page: Page, text: string) {
  await page.locator('#chat-input').fill(text)
  await page.locator('#chat-input').press('Enter')
}

/** Class names of the transcript rows, top to bottom. */
async function transcript(page: Page): Promise<string[]> {
  return page.locator('#chat-messages > *').evaluateAll((rows) =>
    rows.map((r) => {
      const c = r.className
      if (c.includes('chat-reasoning')) return 'reasoning'
      if (c.includes('chat-tool-call')) return 'tool'
      if (c.includes('chat-msg-user')) return 'user'
      if (c.includes('chat-msg-assistant')) return 'answer'
      return c
    }),
  )
}

test.describe('chat', () => {
  test('a markdown table in a reply renders as a table', async ({ page }) => {
    const errors = collectPageErrors(page)
    await openChat(page)
    await send(page, 'markdown please')
    const answer = page.locator('.chat-msg-assistant .chat-msg-content').last()
    const table = answer.locator('table.chat-table')
    await expect(table).toBeVisible()
    await expect(table.locator('thead th')).toHaveText(['Model', 'Tokens'])
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await expect(answer).not.toContainText('|---')
    // Headings and code still render as before.
    await expect(answer.locator('h2')).toHaveText('Markdown sample')
    await expect(answer.locator('pre.chat-code-block code.language-python')).toBeVisible()
    expect(errors.pageErrors).toEqual([])
  })

  test('reasoning and the tool step stay above the answer while it streams', async ({ page }) => {
    await openChat(page)
    await send(page, 'slow reply')
    await expect(page.locator('#chat-header-status')).toHaveText('streaming…')
    await expect(page.locator('#chat-messages .chat-tool-call')).toHaveCount(1)
    await expect(page.locator('.chat-msg-assistant .chat-msg-content').last()).toContainText('w3')
    const live = await transcript(page)
    expect(live.slice(-4)).toEqual(['reasoning', 'reasoning', 'tool', 'answer'])
    await expect(page.locator('#chat-header-status')).toHaveText('connected', { timeout: 30_000 })
    expect((await transcript(page)).slice(-4)).toEqual(live.slice(-4))
  })
})

/**
 * Serves /ui-config.json with `site.themeDefault` set, the server's own answer
 * for the app's default mode ('system' when the app chose nothing).
 */
async function withThemeDefault(page: Page, themeDefault: string) {
  await page.route('**/ui-config.json*', async (route) => {
    const response = await route.fetch()
    const config = await response.json()
    config.site = { ...(config.site ?? {}), themeDefault }
    await route.fulfill({ response, json: config })
  })
}

test.describe('light and dark', () => {
  test('with no app or viewer choice the dashboard follows the OS', async ({ page }) => {
    await withThemeDefault(page, 'system')
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/overview')
      await expect(page.locator('.db-sidebar')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-db-mode', scheme)
    }
  })

  test('an app that asks for dark stays dark on a light OS', async ({ page }) => {
    // aiui.set_theme(dark_mode=True): the theme equals the server's fill-in
    // one, which must not read as "no choice".
    await page.route('**/ui-config.json*', async (route) => {
      const response = await route.fetch()
      const config = await response.json()
      config.site = { ...(config.site ?? {}), theme: { preset: 'zinc', darkMode: true, radius: 'md' } }
      delete config.site.themeDefault
      await route.fulfill({ response, json: config })
    })
    await page.emulateMedia({ colorScheme: 'light' })
    // Every mode <html> takes during the load: never a light frame.
    await page.addInitScript(() => {
      const modes: string[] = []
      ;(window as unknown as { __aiuiModes: string[] }).__aiuiModes = modes
      // <html> may not exist yet when this runs: watch the whole document.
      new MutationObserver(() => {
        const m = document.documentElement?.getAttribute('data-db-mode')
        if (m) modes.push(m)
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-db-mode'] })
    })
    await page.goto('/overview')
    await expect(page.locator('.db-sidebar')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'dark')
    const modes = await page.evaluate(() => (window as unknown as { __aiuiModes: string[] }).__aiuiModes)
    expect(modes.length).toBeGreaterThan(0)
    expect(modes.filter((m) => m !== 'dark')).toEqual([])
  })

  test('a light pick on the Theme page survives a reload', async ({ page, request }) => {
    const errors = collectPageErrors(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/theme-picker')
    await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'dark')
    await page.locator('.tp-mode-btn[data-mode="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'light')
    try {
      await page.reload()
      await expect(page.locator('.db-sidebar')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-db-mode', 'light')
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(bg).toBe(await toRgb(page, '#fafafa'))
      await expect(page.locator('.tp-mode-btn[data-mode="light"]')).toHaveClass(/active/)
      expect(errors.pageErrors).toEqual([])
    } finally {
      // PUT /api/theme also set the server's mode; leave it as it was.
      await request.put('/api/theme', { data: { mode: 'dark' } })
    }
  })

  test('light mode reaches the log panel and form fields', async ({ page }) => {
    await setDashboardMode(page, 'light')
    await page.goto('/logs')
    const panel = page.locator('.aiui-logs-content')
    await expect(panel).toBeVisible()
    const panelBg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(luminance(panelBg), `log panel ${panelBg}`).toBeGreaterThan(0.8)
    await page.goto('/config')
    const field = page.locator('.aiui-config-field input').first()
    await expect(field).toBeVisible()
    const [fieldBg, fieldText] = await field.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.backgroundColor, s.color]
    })
    expect(luminance(fieldBg), `input ${fieldBg}`).toBeGreaterThan(0.8)
    expect(luminance(fieldText), `input text ${fieldText}`).toBeLessThan(0.1)
  })
})

/** Every request the page finishes from now on, with the bytes it took off the wire. */
async function transferLog(page: Page): Promise<{ path: string; url: string; bytes: number }[]> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  const urls = new Map<string, string>()
  const log: { path: string; url: string; bytes: number }[] = []
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url))
  cdp.on('Network.loadingFinished', (e) => {
    const url = urls.get(e.requestId)
    if (url && /^https?:/.test(url)) log.push({ path: new URL(url).pathname, url, bytes: e.encodedDataLength })
  })
  return log
}

test.describe('loading', () => {
  test('a second visit takes the view module from the browser cache', async ({ page }) => {
    const log = await transferLog(page)
    const views = () => log.filter((r) => r.path === '/plugins/views/chat.js')
    await openChat(page)
    await expect.poll(() => views().length).toBe(1)
    const [first] = views()
    // Imported at dashboard.js's own build stamp, never a per-load timestamp.
    const dashboard = log.find((r) => r.path === '/plugins/dashboard.js')
    expect(dashboard).toBeDefined()
    const stamp = new URL(first.url).searchParams.get('v')
    expect(stamp).toBe(new URL(dashboard!.url).searchParams.get('v'))
    expect(first.bytes).toBeGreaterThan(10_000)

    await openChat(page)
    // Same URL, and the body is not downloaded again (a cache hit or a 304).
    for (const again of views().slice(1)) {
      expect(again.url).toBe(first.url)
      expect(again.bytes).toBeLessThan(1_000)
    }
  })
})

test.describe('boot requests', () => {
  test('the dashboard asks for its config and pages once, and loads highlight.js only for code', async ({ page }) => {
    const paths: string[] = []
    page.on('request', (r) => paths.push(new URL(r.url()).host + new URL(r.url()).pathname))
    const count = (p: string) => paths.filter((x) => x.endsWith(p)).length
    const cdn = () => paths.filter((x) => x.startsWith('cdnjs.cloudflare.com'))
    // A stand-in for the CDN, so the test runs offline.
    await page.route('https://cdnjs.cloudflare.com/**', (route) =>
      route.fulfill(
        route.request().url().endsWith('.js')
          ? { contentType: 'text/javascript', body: 'window.hljs={highlightElement:function(el){el.classList.add("hljs")}}' }
          : { contentType: 'text/css', body: '' },
      ),
    )
    await openChat(page)
    await page.waitForLoadState('networkidle')
    // dashboard.js once; the chat view reads it once more for its own mode.
    expect(count('/ui-config.json')).toBeLessThanOrEqual(2)
    expect(count('/api/pages')).toBe(1)
    expect(cdn()).toEqual([])

    await send(page, 'markdown please')
    const code = page.locator('.chat-msg-assistant pre.chat-code-block code.language-python')
    await expect(code).toHaveClass(/hljs/)
    expect(cdn().length).toBe(2)
  })
})
