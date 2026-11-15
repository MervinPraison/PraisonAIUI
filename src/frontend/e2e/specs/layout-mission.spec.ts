/**
 * Mission Control (ADR 0003 track M) in a real browser, against the mock
 * server in the app shell (`?layout=mission` previews it for the tab):
 *
 *   - the ops overview is the home: KPI strip, agents, approvals first;
 *   - the chat page: ops column beside the chat, the run timeline above
 *     the answer, the agent card fed by the run ledger;
 *   - approvals everywhere: banner on every page, nav badge, bell, the
 *     overview's request card, and Approve resolves it;
 *   - a non-chat page (logs) renders in the frame's outlet;
 *   - desktop 1440×900 and phone 390×844, light and dark: landmarks, at most
 *     7 primary destinations, body text and touch targets, no sideways scroll;
 *   - isolation: only Mission's chunks (layout-mission, the kit,
 *     lf-mission-board) load, nothing of another layout; switching away
 *     leaves no connection, timer or listener behind;
 *   - with the run ledger and the approvals API answering 404 the frame
 *     shows empty states and never crashes.
 *
 * It needs no server of its own: it runs against the app-shell server of
 * e2e/playwright.config.ts (PORTS.app: `--shell app -- --plugin --custom-js`,
 * AIUI_LAYOUT=classic; the suite previews Mission with ?layout=mission).
 * That config has no project for this file yet, so CI does not run it until
 * one is added there:
 *
 *   { name: 'layout-mission', testMatch: /[\\/]layout-mission\.spec\.ts$/,
 *     use: { ...chromium, baseURL: url(PORTS.app) } }
 *
 * Until then, run it with a config that adds that project.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')
const OTHER_LAYOUTS = ['chat-canvas', 'workbench', 'command', 'guided']

const CHUNK_NAMES: Map<string, string> = (() => {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'aiui-manifest.json'), 'utf8')) as Record<string, { file: string; name?: string }>
  return new Map(Object.values(manifest).map((c) => [c.file, c.name ?? '']))
})()

/** Every script the page requests, as a chunk name. */
function trackScripts(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req: Request) => {
    if (req.resourceType() !== 'script') return
    const { pathname } = new URL(req.url())
    seen.push(pathname.startsWith('/assets/') ? (CHUNK_NAMES.get(pathname.slice(1)) ?? pathname) : pathname)
  })
  return seen
}
/** Every dist file a script request fetched (/assets/…), so a group's chunk count can be checked. */
function trackScriptFiles(page: Page): Set<string> {
  const seen = new Set<string>()
  page.on('request', (req: Request) => {
    const { pathname } = new URL(req.url())
    if (req.resourceType() === 'script' && pathname.startsWith('/assets/')) seen.add(pathname.slice(1))
  })
  return seen
}
const groups = (scripts: string[]) => [...new Set(scripts.filter((s) => /^(layout|lf)-/.test(s)))].sort()

const frame = (page: Page) => page.locator('[data-aiui-layout-frame="mission"]')

async function requestApproval(page: Page, cmd = 'pip install numpy'): Promise<string> {
  const res = await page.request.post('/api/approvals', {
    data: { tool_name: 'shell', arguments: { cmd }, agent_name: 'Coder', risk_level: 'high', description: 'Needed for the benchmark' },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function clearApprovals(page: Page): Promise<void> {
  const body = (await (await page.request.get('/api/approvals/pending')).json()) as { approvals?: { id: string }[] }
  for (const a of body.approvals ?? []) await page.request.post(`/api/approvals/${a.id}/deny`, { data: { reason: 'e2e cleanup' } })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
  await clearApprovals(page)
})

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`desktop ${scheme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })

    test('the home is the ops overview: KPIs, agents, at most 7 primary destinations', async ({ page }) => {
      const errors = collectPageErrors(page)
      await page.addInitScript((m) => localStorage.setItem('aiui-theme-preference', m), scheme)
      await page.goto('/?layout=mission')
      await expect(page).toHaveURL(/\/overview(\?|$)/)
      await expect(frame(page)).toHaveAttribute('data-viewport', 'desktop')
      await expect(page.locator('html')).toHaveAttribute('data-aiui-tokens', 'pro')
      await expect(page.locator('[data-aiui-ops-overview]')).toBeVisible()
      await expect(page.locator('[data-aiui-kpis]')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
      // Landmarks: the top bar, the nav, one main.
      await expect(page.locator('[data-aiui-mission-topbar]')).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
      await expect(page.locator('main#aiui-main')).toHaveCount(1)
      const primary = page.locator('nav[aria-label="Main"] > ul').first().locator('a[data-aiui-nav-item]')
      expect(await primary.count()).toBeGreaterThan(0)
      expect(await primary.count()).toBeLessThanOrEqual(7)
      await expect(primary.first()).toHaveAttribute('data-aiui-nav-item', 'overview')
      // Body text at least 14 px; every icon-only button is named.
      const size = await page.locator('[data-aiui-ops-overview]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(size).toBeGreaterThanOrEqual(14)
      const unnamed = await frame(page).locator('button').evaluateAll((els) =>
        els.filter((b) => !(b.textContent ?? '').trim() && !b.getAttribute('aria-label')).length,
      )
      expect(unnamed).toBe(0)
      expect(await hasHorizontalOverflow(page)).toBe(false)
      expect(errors.pageErrors).toEqual([])
    })
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('chat: ops column beside the chat, the run timeline above the answer, the agent from the ledger', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto('/chat?layout=mission')
    await expect(page.locator('[data-aiui-ops-column]')).toBeVisible()
    await expect(page.locator('[data-aiui-mission-chat-header]')).toContainText('New chat')
    const box = page.getByRole('textbox', { name: /message/i }).first()
    await box.fill('compare sorting algorithms')
    await box.press('Enter')
    const timeline = page.locator('[data-aiui-run-timeline]').last()
    await expect(timeline).toBeVisible()
    await expect(timeline.locator('[data-step-kind="think"]')).toBeVisible()
    await expect(timeline.locator('[data-step-kind="tool"]')).toContainText('web_search')
    await expect(timeline.locator('[data-step-kind="answer"]')).toBeVisible()
    // The run ledger knows the agent once the run is done (the board polls every 5 s).
    await expect(page.locator('[data-aiui-ops-column] [data-aiui-agent="Mock"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-aiui-mission-chat-header]')).toContainText('Mock')
    expect(errors.pageErrors).toEqual([])
  })

  test('approvals everywhere: banner, nav badge, bell, overview card; Approve resolves it', async ({ page }) => {
    await page.goto('/logs?layout=mission')
    await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
    await requestApproval(page)
    const banner = page.locator('[data-aiui-approval-banner]')
    await expect(banner).toContainText('Coder needs your approval to continue')
    await expect(banner).toContainText('pip install numpy')
    await expect(page.locator('nav[aria-label="Main"] [data-aiui-nav-item="approvals"]')).toHaveAttribute('aria-label', 'Approvals, 1 waiting')
    await expect(page.getByRole('button', { name: 'Approvals, 1 waiting' })).toBeVisible()

    // The overview lists it as a request card (and no banner repeats it).
    await page.locator('nav[aria-label="Main"] [data-aiui-nav-item="overview"]').click()
    const card = page.locator('[data-aiui-ops-approvals] [data-aiui-approval]')
    await expect(card).toContainText('Coder wants to run a command')
    await expect(page.locator('[data-aiui-approval-banner]')).toHaveCount(0)
    await expect(page.locator('[data-aiui-agent="Coder"]')).toContainText('Waiting for approval')

    // mod+j reaches Approve from anywhere; Approve resolves it on the server.
    await page.goto('/logs')
    await expect(banner).toBeVisible()
    // `mod` is what the page thinks the platform is (the device profile may differ from the host).
    const mac = await page.evaluate(() => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
      return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
    })
    await page.keyboard.press(mac ? 'Meta+j' : 'Control+j')
    await expect(banner.getByRole('button', { name: 'Approve' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(banner).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approvals, none waiting' })).toBeVisible()
    const pending = (await (await page.request.get('/api/approvals/pending')).json()) as { approvals: unknown[] }
    expect(pending.approvals).toEqual([])
  })

  test('isolation: Mission downloads only its own chunks, and switching away leaks nothing', async ({ page }) => {
    const scripts = trackScripts(page)
    const files = trackScriptFiles(page)
    for (const p of ['chat', 'logs', 'overview']) {
      await page.goto(`/${p}?layout=mission`)
      await expect(frame(page)).toBeVisible()
    }
    await expect(page.locator('[data-aiui-ops-overview]')).toBeVisible()
    const loaded = groups(scripts)
    expect(loaded.filter((g) => g.startsWith('layout-')).sort()).toEqual(['layout-kit', 'layout-mission'])
    expect(loaded.filter((g) => g.startsWith('lf-'))).toEqual(['lf-mission-board'])
    // The board is one chunk (mission-board/index.ts): one file, whichever part a page shows.
    expect([...files].filter((f) => CHUNK_NAMES.get(f) === 'lf-mission-board')).toHaveLength(1)
    for (const id of OTHER_LAYOUTS) expect(scripts).not.toContain(`layout-${id}`)

    // Round trip to the classic frame and back, twice; the second must leave nothing behind.
    const roundTrip = async () => {
      await page.keyboard.press('ControlOrMeta+k')
      const input = page.getByRole('combobox', { name: 'Search pages and commands' })
      await input.fill('Switch layout: Classic')
      await page.getByRole('option', { name: 'Switch layout: Classic' }).click()
      await expect(frame(page)).toHaveCount(0)
      await page.keyboard.press('ControlOrMeta+k')
      await input.fill('Switch layout: Mission Control')
      await page.getByRole('option', { name: 'Switch layout: Mission Control' }).click()
      await expect(frame(page)).toBeVisible()
      await expect(page.locator('[data-aiui-ops-overview]')).toBeVisible()
    }
    await roundTrip()
    await page.waitForTimeout(500)
    const before = await leakSnapshot(page)
    await roundTrip()
    await page.waitForTimeout(500)
    const delta = leakDelta(before, await leakSnapshot(page))
    for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)
  })

  test('with the run ledger and the approvals API off, panels show empty states and nothing crashes', async ({ page }) => {
    const errors = collectPageErrors(page)
    // Every ledger route, the run list (/api/runs?…) included: an unmounted ledger answers 404 on all of them.
    await page.route(/\/api\/runs(?:[/?]|$)/, (route) => route.fulfill({ status: 404, json: { error: 'Not Found' } }))
    await page.route('**/api/approvals/**', (route) => route.fulfill({ status: 404, json: { error: 'Not Found' } }))
    await page.goto('/overview?layout=mission')
    await expect(page.locator('[data-aiui-kpis="off"]')).toContainText('Run history is off')
    await page.goto('/chat?layout=mission')
    await expect(page.locator('[data-aiui-ops-column] [data-aiui-kpis="off"]')).toBeVisible()
    await expect(page.locator('#aiui-main [data-aiui-page="chat"]')).toBeVisible()
    await expect(page.locator('[data-aiui-approval-banner]')).toHaveCount(0)
    expect(errors.pageErrors).toEqual([])
  })
})

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`phone ${scheme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true })

    test('approval card first, then KPIs and agents; bottom tabs; 44 px targets; no sideways scroll', async ({ page }) => {
      const errors = collectPageErrors(page)
      await page.addInitScript((m) => localStorage.setItem('aiui-theme-preference', m), scheme)
      await page.goto('/overview?layout=mission')
      await expect(frame(page)).toHaveAttribute('data-viewport', 'phone')
      await requestApproval(page)
      const card = page.locator('[data-aiui-ops-approvals] [data-aiui-approval]')
      await expect(card).toBeVisible()
      const cardTop = (await card.boundingBox())!.y
      const kpiTop = (await page.locator('[data-aiui-kpis]').boundingBox())!.y
      expect(cardTop).toBeLessThan(kpiTop)

      const tabs = page.locator('[data-aiui-phone-tabs] [data-aiui-tab]')
      await expect(tabs).toHaveCount(5)
      expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-aiui-tab')))).toEqual(['overview', 'agents', 'approvals', 'chat', 'more'])
      for (const el of await tabs.all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      for (const name of ['Approve', 'Deny']) expect((await card.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      const body = await page.locator('[data-aiui-ops-overview]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(body).toBeGreaterThanOrEqual(15)
      expect(await hasHorizontalOverflow(page)).toBe(false)

      // The banner follows to other pages; More opens the rest of the nav.
      await tabs.filter({ hasText: 'Chat' }).click()
      await expect(page).toHaveURL(/\/chat(\?|$)/)
      await expect(page.locator('[data-aiui-approval-banner]')).toBeVisible()
      await page.locator('[data-aiui-tab="more"]').click()
      const sheet = page.locator('[data-aiui-phone-sheet]')
      await expect(sheet).toBeVisible()
      await sheet.locator('[data-aiui-nav-item="runs"]').click()
      await expect(page).toHaveURL(/\/runs(\?|$)/)
      expect(errors.pageErrors).toEqual([])
    })
  })
}
