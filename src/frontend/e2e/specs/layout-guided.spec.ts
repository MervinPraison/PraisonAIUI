/**
 * Guided Studio (ADR 0003 §4 G; Guided.dc.html, GuidedPhone.dc.html) in a
 * real browser, against the mock server in the app shell
 * (e2e/fixtures/layout-plugin/serve.py, the `layouts-host` server):
 *
 *   - the frame: five plain destinations (at most 7), "Start a new chat",
 *     your recent chats, the chat header; Pro tokens; 14 px body or more;
 *     only this layout's chunks and the kit are downloaded;
 *   - a turn: the plain-language step tracker (its chunk loads with the
 *     first answer), Show details, follow-up chips from
 *     run_completed.suggestions that fill the composer;
 *   - an approval: the explained card pinned above the composer (desktop and
 *     phone), the gated tool's raw row hidden, "Why am I asked?", Approve;
 *   - templates on an empty chat, the Home (`start`) and Templates pages,
 *     `/` opening on Home, a non-chat page (logs) in the outlet;
 *   - phone: four bottom tabs, a chats sheet, 44 px targets, 15 px text;
 *   - light and dark; switching away and back leaks nothing.
 *
 * The mock provider sends no follow-up suggestions, so the suite adds them
 * to the run_completed frame on its way to the page (a WebSocket proxy),
 * exactly where aiui.suggest() puts them.
 */
import { expect, test, type Page, type Request } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')
const SHOTS = path.resolve(HERE, '..', '.results', 'layout-guided')

const SUGGESTIONS = ['Show a mergesort example', 'Explain Big-O in plain words', 'Time all three on my data']

const CHUNK_NAMES: Map<string, string> = (() => {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'aiui-manifest.json'), 'utf8')) as Record<string, { file: string; name?: string }>
  return new Map(Object.values(manifest).map((c) => [c.file, c.name ?? '']))
})()

function trackScripts(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req: Request) => {
    if (req.resourceType() !== 'script') return
    const { pathname } = new URL(req.url())
    seen.push(pathname.startsWith('/assets/') ? (CHUNK_NAMES.get(pathname.slice(1)) ?? pathname) : pathname)
  })
  return seen
}
const groups = (scripts: string[]) => [...new Set(scripts.filter((s) => /^(layout|lf)-/.test(s)))].sort()

const frame = (page: Page) => page.locator('[data-aiui-layout-frame="guided"]')
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const lastTurn = (page: Page) => page.locator('[data-role="assistant"]').last()

/** Add follow-up suggestions to every run_completed frame the chat socket delivers. */
async function suggestOnRunCompleted(page: Page): Promise<void> {
  await page.routeWebSocket(/\/api\/chat\/ws/, (ws) => {
    const server = ws.connectToServer()
    server.onMessage((msg) => {
      if (typeof msg !== 'string') return ws.send(msg)
      try {
        const ev = JSON.parse(msg) as Record<string, unknown>
        if (ev.type === 'run_completed') return ws.send(JSON.stringify({ ...ev, suggestions: SUGGESTIONS }))
      } catch {
        /* not JSON */
      }
      ws.send(msg)
    })
  })
}

async function openGuided(page: Page, pageId = 'chat'): Promise<void> {
  await page.goto(`/${pageId}?layout=guided`)
  await expect(frame(page)).toBeVisible()
  await expect(page.locator(`#aiui-main [data-aiui-page="${pageId}"]`)).toBeVisible()
}

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

async function waitForRunEnd(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
}

/** Font size (px) of an element. */
const fontPx = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
})

for (const mode of ['light', 'dark'] as ColorMode[]) {
  test.describe(`${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      await setColorMode(page, mode)
    })

    test(`desktop: the Guided frame and a full turn (${mode})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const errors = collectPageErrors(page)
      const scripts = trackScripts(page)
      await suggestOnRunCompleted(page)
      await openGuided(page)

      // Frame: Pro tokens, the plain destinations, the chat header, the main landmark.
      await expect(page.locator('html')).toHaveAttribute('data-aiui-tokens', 'pro')
      const nav = page.getByRole('navigation', { name: 'Main' })
      await expect(nav.getByRole('button', { name: 'Start a new chat' })).toBeVisible()
      const primary = nav.getByRole('list', { name: 'Primary' }).getByRole('listitem')
      expect(await primary.count()).toBeLessThanOrEqual(7)
      for (const label of ['Chat', 'My agents', 'Help']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
      await expect(nav.locator('[data-aiui-nav-item="chat"]')).toHaveAttribute('aria-current', 'page')
      await expect(nav.getByRole('heading', { name: 'Your recent chats' })).toBeVisible()
      await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText('New chat')
      await expect(frame(page).getByText(/Chatting with .+ · ready to help/)).toBeVisible()
      await expect(frame(page).getByRole('button', { name: 'Change agent' })).toBeVisible()
      expect(await fontPx(page, '[data-aiui-layout-frame="guided"] main')).toBeGreaterThanOrEqual(14)

      // An empty chat offers templates; nothing of the step tracker loads yet.
      await expect(page.locator('[data-guided-templates]')).toBeVisible()
      expect(groups(scripts)).toEqual(['layout-guided', 'layout-kit'])
      await shot(page, `desktop-empty-${mode}`)

      // A turn: the plain-language steps above the answer.
      await send(page, 'compare sorting algorithms')
      await waitForRunEnd(page)
      const tracker = lastTurn(page).locator('[data-step-tracker]')
      await expect(tracker).toHaveAttribute('data-step-tracker', 'done')
      await expect(tracker).toContainText(/Here is what .+ did/)
      await expect(tracker).toContainText(/All done in /)
      await expect(tracker.locator('[data-step="reasoning"]')).toContainText('Understanding your question')
      await expect(tracker.locator('[data-step="tool"]')).toContainText('Searching the web')
      await expect(tracker.locator('[data-step="text"]')).toContainText('Writing the answer')
      // The tracker owns the steps: the thread's own tool row is hidden.
      await expect(lastTurn(page).locator('[data-tool="web_search"]')).toBeHidden()
      expect(groups(scripts)).toContain('lf-step-tracker')

      await tracker.getByRole('button', { name: 'Show details' }).click()
      await expect(tracker.locator('[data-step-details]')).toContainText('web_search')
      await expect(tracker.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true')

      // Follow-up chips fill the composer.
      const followups = lastTurn(page).getByRole('region', { name: 'You could ask next' })
      await expect(followups).toBeVisible()
      await expect(followups.getByRole('button')).toHaveText(SUGGESTIONS)
      await shot(page, `desktop-turn-${mode}`)
      await followups.getByRole('button', { name: SUGGESTIONS[1] }).click()
      await expect(composer(page)).toHaveValue(SUGGESTIONS[1])

      // The chat now has a title in the header and a card under "Your recent chats".
      await expect(nav.locator('[data-aiui-session][aria-current="page"]')).toBeVisible()

      expect(await hasHorizontalOverflow(page)).toBe(false)
      expect(groups(scripts).filter((g) => /^layout-/.test(g) && g !== 'layout-guided' && g !== 'layout-kit')).toEqual([])
      expect(errors.pageErrors).toEqual([])
    })

    test(`phone: header, bottom tabs, the chats sheet, the step tracker (${mode})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const errors = collectPageErrors(page)
      await openGuided(page)
      await expect(frame(page)).toHaveAttribute('data-viewport', 'phone')
      expect(await hasHorizontalOverflow(page)).toBe(false)

      const tabs = page.locator('[data-aiui-phone-tabs] [data-aiui-tab]')
      const ids = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-aiui-tab')))
      expect(ids.filter((id) => id !== 'start')).toEqual(['chat', 'agents', 'help'])
      for (const box of await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44)
      for (const name of ['Your chats and more', 'Start a new chat']) {
        const b = await page.getByRole('button', { name }).first().boundingBox()
        expect(b && b.width >= 44 && b.height >= 44, name).toBe(true)
      }
      expect(await fontPx(page, '[data-aiui-layout-frame="guided"] main')).toBeGreaterThanOrEqual(15)

      await send(page, 'phone sorting question')
      await waitForRunEnd(page)
      const tracker = lastTurn(page).locator('[data-step-tracker]')
      await expect(tracker).toContainText('Understanding your question')
      await expect(tracker.getByRole('button', { name: 'Show details' })).toBeVisible()
      const toggle = await tracker.getByRole('button', { name: 'Show details' }).boundingBox()
      expect(toggle && toggle.height >= 44).toBe(true)
      expect(await hasHorizontalOverflow(page)).toBe(false)
      await shot(page, `phone-turn-${mode}`)

      // The chats sheet lists the chat just made; a tab navigates.
      await page.getByRole('button', { name: 'Your chats and more' }).click()
      const sheet = page.locator('[data-aiui-phone-sheet]')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('heading', { name: 'Your recent chats' })).toBeVisible()
      await expect(sheet.locator('[data-aiui-session]')).not.toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await page.locator('[data-aiui-tab="agents"]').click()
      await expect(page).toHaveURL(/\/agents$/)
      await expect(page.locator('#aiui-main [data-aiui-page="agents"]')).toBeVisible()
      await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText('My agents')
      expect(errors.pageErrors).toEqual([])
    })
  })
}

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`${name}: an approval is the explained card, pinned above the composer, and Approve decides it`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openGuided(page)
    await send(page, 'apok please')
    // Guided.dc.html / GuidedPhone.dc.html: the card sits right above the composer, out of the turn.
    const card = page.locator('[data-chat-pinned] [data-approval-card]')
    await expect(card).toBeVisible()
    await expect(lastTurn(page).locator('[data-approval-card]')).toHaveCount(0)
    const [c, m] = [await card.boundingBox(), await composer(page).boundingBox()]
    expect(c && m && c.y + c.height <= m.y && m.y - (c.y + c.height) < 48, 'directly above the composer').toBe(true)
    // The step tracker owns the steps: the gated tool's raw row is not shown.
    await expect(lastTurn(page).locator('[data-tool]')).toBeHidden()
    await expect(card.getByRole('heading')).toContainText(/^Allow .+ to use .+\?$/)
    await expect(lastTurn(page).locator('[data-step-tracker]')).toHaveAttribute('data-step-tracker', 'waiting')
    await expect(lastTurn(page).locator('[data-step-tracker]')).toContainText('Waiting for your OK')
    if (name === 'desktop') await expect(frame(page).getByText(/Chatting with .+ · waiting for your OK/)).toBeVisible()
    await card.getByRole('button', { name: 'Why am I asked?' }).click()
    await expect(card.locator('[data-why]')).toContainText('Nothing runs until you decide.')
    if (name === 'phone') {
      for (const b of await card.getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(b).toBeGreaterThanOrEqual(44)
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }
    await shot(page, `${name}-approval-light`)
    await card.getByRole('button', { name: 'Approve' }).click()
    await expect(card).toHaveCount(0)
    await expect(page.locator('[data-chat-pinned]')).toBeHidden()
    const seen = await (await page.request.get('/__e2e/approval-posts')).json()
    expect(seen.posts).toContain('POST /api/approvals/ap_ok/approve')
  })
}

test('templates: an empty chat, the Templates page and Home start a chat with the prompt filled in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openGuided(page)
  // On the empty chat: the prompt goes into this chat's composer.
  const first = page.locator('[data-guided-templates] [data-guided-template]').first()
  await first.click()
  await expect(composer(page)).not.toHaveValue('')

  const manifest = await page.evaluate(() => fetch('/api/shell/manifest').then((r) => r.json()))
  const ids = (manifest.pages as { id: string }[]).map((p) => p.id)
  expect(ids, 'builtin.layout-guided lists its pages while Guided is offered').toEqual(expect.arrayContaining(['start', 'templates']))
  const guided = manifest.layouts.available.find((s: { id: string }) => s.id === 'guided')
  expect(guided.home).toBe('start')

  // The Templates page: search narrows, a card opens a new chat with its prompt.
  await page.locator('[data-aiui-nav-item="templates"]').click()
  await expect(page).toHaveURL(/\/templates$/)
  const tpl = page.locator('#aiui-main [data-guided-page="templates"]')
  await expect(tpl).toBeVisible()
  await tpl.getByRole('searchbox', { name: 'Search templates' }).fill('step by step')
  await expect(tpl.locator('[data-guided-template]')).toHaveCount(1)
  await shot(page, 'desktop-templates-light')
  await tpl.locator('[data-guided-template]').first().click()
  await expect(page).toHaveURL(/\/chat/)
  await expect(composer(page)).toHaveValue(/plan this step by step/i)

  // Home: the layout's home page; `/` opens on it.
  await page.goto('/')
  await expect(page).toHaveURL(/\/start$/)
  const home = page.locator('#aiui-main [data-guided-page="start"]')
  await expect(home).toBeVisible()
  await expect(home.getByRole('heading', { name: /What would you like to do today\?/ })).toBeVisible()
  await expect(home.locator('[data-guided-template]')).not.toHaveCount(0)
  await shot(page, 'desktop-home-light')
})

test('a non-chat page renders in the outlet; switching away and back leaks nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = collectPageErrors(page)
  const scripts = trackScripts(page)
  await openGuided(page, 'logs')
  await expect(frame(page).getByRole('heading', { level: 1 })).toHaveText('Logs')
  await expect(frame(page).getByRole('button', { name: 'Change agent' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('More tools')).toBeVisible()

  const switchTo = async (title: string) => {
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Search pages and commands' })
    await input.fill(title)
    await page.getByRole('option', { name: title }).click()
  }
  const roundTrip = async () => {
    await switchTo('Switch layout: Chat and Canvas')
    await expect(page.locator('[data-aiui-layout-frame="chat-canvas"]')).toBeVisible()
    await switchTo('Switch layout: Guided Studio')
    await expect(frame(page)).toBeVisible()
    await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  }
  await roundTrip()
  await page.waitForTimeout(500)
  const before = await leakSnapshot(page)
  await roundTrip()
  await page.waitForTimeout(500)
  const delta = leakDelta(before, await leakSnapshot(page))
  for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)
  expect(scripts.filter((s) => /^layout-(workbench|command|mission)$/.test(s))).toEqual([])
  expect(errors.pageErrors).toEqual([])
})
