/**
 * Page templates (ADR 0003, track T) in a real browser: every built-in page
 * carries its template on the page root (data-aiui-page-type, from the
 * manifest's pageType), legacy views are dressed by legacy/page-types.css
 * under a layout, the classic frame keeps today's look, and the template
 * CSS is not part of the boot download.
 *
 * Runs in the `layouts-host` project (style app, default layout chat-canvas).
 *
 * Baselines: six representative pages x {chat-canvas, workbench} x
 * {light, dark} at 1440x900, and the same pages under chat-canvas at a
 * 390x844 phone, in e2e/__baseline__/<platform>/page-type-*.png. Only the
 * page region within the viewport is captured (the template is what this
 * suite owns; each layout's frame has its own suite). A platform without baselines skips the
 * comparison (see e2e/README.md); capture them with
 * `npx playwright test -c e2e/playwright.config.ts --project layouts-host page-types --update-snapshots`.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  collectPageErrors,
  contrastRatio,
  FIXED_TIME,
  hasHorizontalOverflow,
  setColorMode,
  toRgb,
  type ColorMode,
} from './support'

const TEMPLATES: Record<string, string> = {
  sessions: 'list',
  kanban: 'board',
  logs: 'log',
  'code-studio': 'editor',
  marketplace: 'gallery',
  overview: 'overview',
  config: 'settings',
}

const SWEEP = ['sessions', 'kanban', 'logs', 'code-studio', 'marketplace', 'config'] as const
const LAYOUTS = ['chat-canvas', 'workbench'] as const
const MODES: readonly ColorMode[] = ['light', 'dark']
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

/** Anti-aliasing noise only: the server data behind these pages is fixed. */
const MAX_DIFF = 0.01

/**
 * Live server state rather than design, painted over in the baseline and the
 * comparison: the log stream and its counts (whatever the server logged so
 * far), and the code editor canvas (Monaco loads from a CDN, or the textarea
 * fallback paints when it cannot).
 */
const VOLATILE = ['.aiui-logs-content', '.aiui-logs-count', '#cs-editor', '#cs-history']

async function open(page: Page, id: string, layout: string) {
  await page.goto(`/${id}?layout=${layout}`)
  await page.locator(`[data-aiui-page="${id}"] .aiui-legacy-host[data-status="ready"]`).waitFor({ timeout: 15_000 })
}

const style = (page: Page, sel: string, prop: string) =>
  page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)

test('the manifest names a template for every built-in page', async ({ request }) => {
  const manifest = await (await request.get('/api/shell/manifest')).json()
  const builtin = manifest.pages.filter((p: { source: string }) => p.source === 'builtin')
  expect(builtin.length).toBeGreaterThan(20)
  expect(builtin.filter((p: { pageType?: string }) => !p.pageType).map((p: { id: string }) => p.id)).toEqual([])
  for (const [id, type] of Object.entries(TEMPLATES)) {
    expect(builtin.find((p: { id: string }) => p.id === id)?.pageType, id).toBe(type)
  }
  const api = await (await request.get('/api/pages')).json()
  expect(JSON.stringify(api)).not.toContain('pageType')
})

for (const [id, type] of Object.entries(TEMPLATES)) {
  test(`${id}: the page root says ${type}`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await open(page, id, 'chat-canvas')
    await expect(page.locator(`[data-aiui-page="${id}"]`)).toHaveAttribute('data-aiui-page-type', type)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}

test('templates dress legacy views under a layout, not in the classic frame', async ({ page }) => {
  await open(page, 'kanban', 'chat-canvas')
  expect(await style(page, '.aiui-board-column', 'border-top-left-radius')).toBe('12px')
  await open(page, 'logs', 'chat-canvas')
  await page.locator('.aiui-logs-toolbar').waitFor()
  expect(await style(page, '.aiui-logs-toolbar', 'border-bottom-style')).toBe('solid')
  await open(page, 'config', 'chat-canvas')
  expect(await style(page, '.aiui-config-field', 'flex-direction')).toBe('row')

  await open(page, 'config', 'classic')
  expect(await style(page, '.aiui-config-field', 'flex-direction')).toBe('column')
})

test('the template CSS loads with the legacy host, never at boot', async ({ page }) => {
  const css: string[] = []
  page.on('response', (r) => {
    if (r.url().endsWith('.css')) css.push(r.url())
  })
  await page.goto('/chat?layout=chat-canvas')
  await page.getByRole('textbox', { name: /message/i }).first().waitFor()
  const bootCss = await Promise.all(
    css.map((u) => page.evaluate(async (url) => (await fetch(url)).text(), u)),
  )
  expect(bootCss.some((t) => t.includes('data-aiui-page-type'))).toBe(false)
})

for (const mode of MODES) {
  test(`editor: Code Studio's output tabs pass AA on the output pane (${mode})`, async ({ page }) => {
    await setColorMode(page, mode)
    await open(page, 'code-studio', 'chat-canvas')
    const pane = page.locator('.cs-tab').first().locator('xpath=../..')
    const bg = await toRgb(page, await pane.evaluate((el) => getComputedStyle(el).backgroundColor))
    for (const tab of ['output', 'errors', 'artifacts']) {
      const fg = await toRgb(page, await style(page, `.cs-tab[data-tab="${tab}"]`, 'color'))
      expect(contrastRatio(fg, bg), `${tab}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}

/** Compare against the platform baseline; skip without one unless capturing. */
async function compare(page: Page, info: TestInfo, id: string, name: string) {
  const capturing = info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed'
  const baseline = info.snapshotPath(name)
  if (!capturing && !existsSync(baseline)) {
    info.annotations.push({
      type: 'skip',
      description: `no ${process.platform} baseline (${path.basename(path.dirname(baseline))}/${name})`,
    })
    return
  }
  // The page region as it is on screen: frames scroll the page in their own
  // container, so an element screenshot of a tall page would come out blank
  // below the fold. Clip the viewport to the region instead.
  const box = await page.locator(`[data-aiui-page="${id}"]`).boundingBox()
  const vp = page.viewportSize()!
  const x = Math.max(0, box!.x)
  const y = Math.max(0, box!.y)
  const clip = {
    x,
    y,
    width: Math.min(vp.width, box!.x + box!.width) - x,
    height: Math.min(vp.height, box!.y + box!.height) - y,
  }
  await expect(page).toHaveScreenshot(name, {
    clip,
    maxDiffPixelRatio: MAX_DIFF,
    mask: VOLATILE.map((s) => page.locator(s)),
  })
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  // Views paint after their first fetch; give late DOM writes a moment.
  await page.waitForTimeout(400)
}

for (const layout of LAYOUTS) {
  for (const mode of MODES) {
    for (const id of SWEEP) {
      test(`baseline: ${id} in ${layout}, ${mode}`, async ({ page }, info) => {
        const errors = collectPageErrors(page)
        await page.setViewportSize(DESKTOP)
        await setColorMode(page, mode)
        await page.clock.setFixedTime(FIXED_TIME)
        await open(page, id, layout)
        await settle(page)
        expect(await hasHorizontalOverflow(page)).toBe(false)
        await compare(page, info, id, `page-type-${id}-${layout}-${mode}.png`)
        expect(errors.pageErrors).toEqual([])
      })
    }
  }
}

for (const layout of LAYOUTS) {
  test(`phone: no page scrolls sideways at 390 px in ${layout}`, async ({ page }) => {
    await page.setViewportSize(PHONE)
    for (const id of SWEEP) {
      await open(page, id, layout)
      await settle(page)
      expect(await hasHorizontalOverflow(page), id).toBe(false)
    }
  })
}

test('editor on a phone: the workspace spans the width and every output tab shows', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await open(page, 'code-studio', 'chat-canvas')
  const workspace = await page.locator('.cs-root > div').first().boundingBox()
  const page_ = await page.locator('[data-aiui-page="code-studio"]').boundingBox()
  expect(workspace!.width).toBeGreaterThan(page_!.width * 0.8)
  const strip = await page.locator('.cs-tab').first().locator('xpath=..').boundingBox()
  for (const tab of ['output', 'errors', 'artifacts']) {
    const box = await page.locator(`.cs-tab[data-tab="${tab}"]`).boundingBox()
    expect(box!.x + box!.width, tab).toBeLessThanOrEqual(strip!.x + strip!.width + 0.5)
  }
})

/**
 * A blocks page added to the manifest in the browser only (no fixture change),
 * served `components` from its own endpoint, then opened from /chat.
 */
async function openBlocksPage(page: Page, id: string, title: string, components: unknown[]) {
  const extra = { id, title, kind: 'blocks', source: 'e2e', apiEndpoint: `/api/${id}` }
  // The manifest arrives inlined in the HTML (<script id="aiui-boot">), or from
  // /api/shell/manifest when the server inlines only part of it.
  await page.route('**/chat?*', async (route) => {
    const response = await route.fetch()
    const html = (await response.text()).replace(
      /(<script id="aiui-boot" type="application\/json">)([\s\S]*?)(<\/script>)/,
      (_, open: string, json: string, close: string) => {
        const boot = JSON.parse(json)
        if (Array.isArray(boot.pages)) boot.pages.push(extra)
        return open + JSON.stringify(boot).replace(/</g, '\\u003c') + close
      },
    )
    await route.fulfill({ response, body: html })
  })
  await page.route('**/api/shell/manifest*', async (route) => {
    const response = await route.fetch()
    const manifest = await response.json()
    manifest.pages.push(extra)
    await route.fulfill({ response, json: manifest })
  })
  await page.route(`**/api/${id}*`, (route) => route.fulfill({ json: { _components: components } }))
  await page.goto('/chat?layout=chat-canvas')
  await page.getByRole('textbox', { name: /message/i }).first().waitFor()
  await page.evaluate((path) => {
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }, `/${id}`)
}

test('list_detail on a phone: a tap brings the stacked detail on screen and focuses it', async ({ page }) => {
  // One page of 25 agents, so the detail panel stacks under the whole table.
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}`, runs: i, detail: { model: 'mock' } }))
  await page.setViewportSize(PHONE)
  await openBlocksPage(page, 'e2e-list', 'List demo', [
    { type: 'list_detail', title: 'Agents', columns: ['name', 'runs'], rows, page_size: 25 },
  ])
  const last = page.locator('tr[data-row-id="a24"]')
  await last.waitFor()
  // The toolbar has no "25 shown" next to the pager.
  await expect(page.locator('[data-aiui-template="list"]')).not.toContainText('shown')

  await page.locator('tr[data-row-id="a3"]').click()
  const detail = page.getByRole('complementary', { name: 'Agent 3' })
  await expect(detail).toBeFocused()
  await expect(detail).toBeInViewport()

  // Esc closes it and focus returns to the row.
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(page.locator('tr[data-row-id="a3"]')).toBeFocused()
})

test('log_viewer: full ISO stamps show a time of day that stays inside the Time column', async ({ page }) => {
  // What Python's logging and isoformat() produce, not ProLogs' short times.
  const stamps = ['2026-11-15T10:00:10Z', '2026-11-15T10:00:11.123456+00:00', '2026-11-15 10:00:12,042', Date.UTC(2026, 10, 15, 10, 0, 13, 500) / 1000]
  const levels = ['info', 'debug', 'warning', 'error']
  const entries = stamps.map((ts, i) => ({ ts, level: levels[i], source: 'agent', message: `line ${i}` }))
  await page.setViewportSize(DESKTOP)
  await openBlocksPage(page, 'e2e-log', 'Log demo', [{ type: 'log_viewer', title: 'Agent log', entries }])
  const rows = page.locator('.aiui-tpl-log-row')
  await expect(rows).toHaveCount(stamps.length)
  for (let i = 0; i < stamps.length; i++) {
    const ts = rows.nth(i).locator('.aiui-tpl-log-ts')
    await expect(ts).toHaveText(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/)
    await expect(ts).toHaveAttribute('title', /2026-11-15/)
    // The text fits its cell (nothing clipped), and the cell ends before Level.
    const fit = await ts.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(fit.scroll, `row ${i}`).toBeLessThanOrEqual(fit.client)
    const tsBox = (await ts.boundingBox())!
    const lvlBox = (await rows.nth(i).locator('.aiui-tpl-lvl').boundingBox())!
    expect(tsBox.x + tsBox.width, `row ${i}`).toBeLessThanOrEqual(lvlBox.x)
  }
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

for (const mode of MODES) {
  for (const id of SWEEP) {
    test(`baseline: ${id} on a phone in chat-canvas, ${mode}`, async ({ page }, info) => {
      await page.setViewportSize(PHONE)
      await setColorMode(page, mode)
      await page.clock.setFixedTime(FIXED_TIME)
      await open(page, id, 'chat-canvas')
      await settle(page)
      await compare(page, info, id, `page-type-${id}-chat-canvas-phone-${mode}.png`)
    })
  }
}
