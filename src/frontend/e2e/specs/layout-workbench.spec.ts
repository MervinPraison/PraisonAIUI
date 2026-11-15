/**
 * The Quiet Workbench layout (ADR 0003, Track W; design Main.dc.html and
 * QuietPhone.dc.html) in a real browser, against the scripted provider
 * (fixtures/mock_server.py), on a desktop (1440×900) and a phone (390×844),
 * in light and dark:
 *
 *   - the frame's regions: the Main sidebar (New chat, at most 7 primary
 *     pages, Search and more, Chats with search), the top bar (title, agent)
 *     and the page in the main landmark;
 *   - the chat inside it: no session rail of its own, the quiet thread, the
 *     new chat listed and titled in the frame, an inline approval decided;
 *   - a non-chat page (logs) renders in the same outlet;
 *   - phone: a header with 44 px targets and the sidebar as a sheet, body
 *     text at least 15 px, nothing scrolls sideways;
 *   - ⌘N and ⌘B; network isolation (only `layout-workbench` and the kit);
 *     switching to the classic frame and back leaks nothing.
 *
 * The layout is picked with the `?layout=workbench` tab preview, so the spec
 * runs against any app-shell server that offers it: the `layouts-host`
 * server of e2e/playwright.config.ts, or `AIUI_LAYOUT=workbench` on
 * `start-server.mjs --shell app`. Screenshots are attached to the report for
 * review (they block nothing until they are approved as baselines).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
/** The sorting conversation (one per run: the server keeps its sessions across tests). */
const question = (mode: ColorMode) => `markdown apok Compare sorting algorithms ${mode}`
/** The server may capitalise a title it derives from the first message. */
const titled = (text: string) => new RegExp('^' + text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '$', 'i')

/** dist file → chunk name (aiui-manifest.json). */
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

const frame = (page: Page) => page.locator('[data-aiui-layout-frame="workbench"]')
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const assistant = (page: Page) => page.locator('[data-role="assistant"]')

async function open(page: Page, pageId: string): Promise<void> {
  await page.goto(`/${pageId}?layout=workbench`)
  await expect(frame(page)).toBeVisible()
  await expect(page.locator(`#aiui-main [data-aiui-page="${pageId}"]`)).toBeVisible()
}

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
}

async function box(locator: Locator): Promise<{ width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not rendered')
  return b
}

async function fontSize(locator: Locator): Promise<number> {
  return locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
}

/** The key the frame's `mod+` shortcuts listen for: ⌘ where the page thinks it runs on Apple, else Ctrl. */
async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
  })
  return mac ? 'Meta' : 'Control'
}

async function attachShot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
})

for (const mode of ['light', 'dark'] as ColorMode[]) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => setColorMode(page, mode))

    test(`desktop (${mode}): the frame, the quiet chat with an inline approval, a page in the outlet`, async ({ page }) => {
      await page.setViewportSize(DESKTOP)
      const errors = collectPageErrors(page)
      const scripts = trackScripts(page)
      await open(page, 'chat')
      await expect(page.locator('html')).toHaveAttribute('data-aiui-tokens', 'pro')
      await expect(frame(page)).toHaveAttribute('data-viewport', 'desktop')

      // Sidebar: New chat, at most 7 primary pages (the chat page current), Search, Chats.
      const nav = sidebar(page)
      await expect(nav.getByRole('button', { name: /New chat/ })).toBeVisible()
      const primary = nav.getByRole('list', { name: 'Primary' }).getByRole('link')
      expect(await primary.count()).toBeGreaterThan(0)
      expect(await primary.count()).toBeLessThanOrEqual(7)
      await expect(nav.locator('[data-aiui-nav-item="chat"]')).toHaveAttribute('aria-current', 'page')
      await expect(nav.getByRole('button', { name: 'Search and more' })).toBeVisible()
      await expect(nav.getByRole('heading', { name: 'Chats' })).toBeVisible()
      // One search entry in the sidebar (Search and more ⌘K); the chat filter opens from the Chats header.
      await expect(nav.getByRole('searchbox', { name: 'Search chats' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Search chats' }).click()
      await expect(nav.getByRole('searchbox', { name: 'Search chats' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(nav.getByRole('searchbox', { name: 'Search chats' })).toHaveCount(0)
      await expect(nav.getByRole('status')).toContainText('Connected')
      // The chat draws no session rail of its own here, and the thread is quiet.
      await expect(page.locator('#aiui-main [data-session-id]')).toHaveCount(0)
      await expect(page.locator('[data-variant="quiet"] [data-aiui-thread]')).toBeVisible()

      // The sorting conversation: listed and titled in the frame.
      const QUESTION = question(mode)
      await send(page, QUESTION)
      const row = nav.locator('[data-aiui-session]', { hasText: QUESTION })
      await expect(row).toHaveAttribute('aria-current', 'true')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titled(QUESTION))
      await expect(page.locator('[data-aiui-chat-meta]')).toContainText('Mock')
      // One visible title and one Connected: the chat's own title row steps
      // aside while the socket is open (workbench.css), the badge still there.
      await expect(page.locator('[data-connection="open"]')).toBeAttached()
      const ownTitleWidth = await page.locator('[data-chat-title]').evaluate((el) => el.getBoundingClientRect().width)
      expect(ownTitleWidth).toBeLessThanOrEqual(1)
      await expect(page.getByText('Connected', { exact: true }).filter({ visible: true })).toHaveCount(1)

      // The reply: a table and code; the approval is decided inline.
      const reply = assistant(page).last()
      await expect(reply.locator('table')).toBeVisible()
      await expect(reply.locator('pre').first()).toBeVisible()
      const approve = reply.getByRole('button', { name: 'Approve' })
      await expect(approve).toBeVisible()
      await expect(reply.getByRole('button', { name: 'Deny' })).toBeVisible()
      // Nothing is approved unseen: the exact command sits above Approve and Deny,
      // and the risk is a chip in the row header next to "Needs approval".
      // The gated web_search: what it will search for, word for word.
      await expect(reply.locator('[data-gate-command]')).toHaveText(new RegExp(`^Query:${QUESTION}$`))
      const [cmd, btn] = [await reply.locator('[data-gate-command]').boundingBox(), await approve.boundingBox()]
      expect(cmd && btn && cmd.y <= btn.y, 'the command is not below the buttons').toBe(true)
      await expect(reply.locator('[data-tool] > button [data-tool-risk]')).toHaveText('high risk')
      expect(await fontSize(reply.locator('p').first())).toBeGreaterThanOrEqual(14)
      await attachShot(page, `workbench-desktop-chat-${mode}`)
      await approve.click()
      await expect(approve).toHaveCount(0)
      const seen = await (await page.request.get('/__e2e/approval-posts')).json()
      expect(seen.posts).toContain('POST /api/approvals/ap_ok/approve')

      // A non-chat page renders in the same frame; the chat list stays. Pages
      // beyond the primary ones are in "Search and more" (the palette).
      await expect(nav.getByText(/^More \(\d+\)$/)).toHaveCount(0)
      await nav.getByRole('button', { name: /Search and more/ }).click()
      await page.getByRole('combobox', { name: 'Search pages and commands' }).fill('Logs')
      await page.getByRole('option', { name: /^Logs/ }).first().click()
      await expect(page).toHaveURL(/\/logs(\?|$)/)
      await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logs')
      await expect(row).toBeVisible()
      await attachShot(page, `workbench-desktop-logs-${mode}`)

      // Opening the chat from the list goes back to it.
      await row.click()
      await expect(page).toHaveURL(/\/chat(\?|$)/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titled(QUESTION))

      expect([...new Set(scripts.filter((s) => /^layout-/.test(s)))].sort()).toEqual(['layout-kit', 'layout-workbench'])
      expect(scripts.filter((s) => /^lf-/.test(s))).toEqual([])
      expect(errors.pageErrors).toEqual([])
    })

    test(`phone (${mode}): header with 44 px targets, the sidebar as a sheet, 15 px text`, async ({ page }) => {
      await page.setViewportSize(PHONE)
      const errors = collectPageErrors(page)
      await open(page, 'chat')
      await expect(frame(page)).toHaveAttribute('data-viewport', 'phone')
      await expect(page.locator('[data-aiui-workbench-sidebar]')).toHaveCount(0)
      const menu = page.getByRole('button', { name: 'Open menu' })
      const newChat = page.getByRole('button', { name: 'New chat' })
      for (const b of [menu, newChat]) {
        const { width, height } = await box(b)
        expect(width).toBeGreaterThanOrEqual(44)
        expect(height).toBeGreaterThanOrEqual(44)
      }
      expect(await hasHorizontalOverflow(page)).toBe(false)

      await send(page, `plain hello from the phone ${mode}`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titled(`plain hello from the phone ${mode}`))
      expect(await fontSize(assistant(page).last().locator('p').first())).toBeGreaterThanOrEqual(15)
      expect(await hasHorizontalOverflow(page)).toBe(false)
      await attachShot(page, `workbench-phone-chat-${mode}`)

      await menu.click()
      const sheet = page.locator('[data-aiui-phone-sheet]')
      await expect(sheet).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
      const targets = [
        sheet.getByRole('button', { name: 'Close menu' }),
        sheet.getByRole('button', { name: /New chat/ }),
        sheet.locator('[data-aiui-nav-item="chat"]'),
        sheet.getByRole('button', { name: 'Search chats' }),
        sheet.locator('[data-aiui-session]').first(),
      ]
      for (const t of targets) expect((await box(t)).height).toBeGreaterThanOrEqual(44)
      expect(await fontSize(sheet.locator('[data-aiui-nav-item="chat"]'))).toBeGreaterThanOrEqual(15)
      await attachShot(page, `workbench-phone-sheet-${mode}`)

      // A page from the sheet: it closes, the page renders under the header.
      const target = sheet.locator('[data-aiui-nav-item]:not([aria-current])').first()
      const id = await target.getAttribute('data-aiui-nav-item')
      await target.click()
      await expect(sheet).toBeHidden()
      await expect(page.locator(`#aiui-main [data-aiui-page="${id}"]`)).toBeVisible()
      expect(await hasHorizontalOverflow(page)).toBe(false)
      expect(errors.pageErrors).toEqual([])
    })
  })
}

test('⌘N starts a new chat from anywhere; ⌘B collapses the sidebar and the choice is kept', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await open(page, 'chat')
  await send(page, 'plain first chat')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(titled('plain first chat'))

  await page.goto('/logs?layout=workbench')
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  const mod = await modKey(page)
  await page.keyboard.press(`${mod}+n`)
  await expect(page).toHaveURL(/\/chat(\?|$)/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New chat')

  await page.keyboard.press(`${mod}+b`)
  await expect(page.locator('[data-aiui-workbench-sidebar]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await page.reload()
  await expect(frame(page)).toBeVisible()
  await expect(page.locator('[data-aiui-workbench-sidebar]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.locator('[data-aiui-workbench-sidebar]')).toBeVisible()
})

test('switching to the classic frame and back fetches nothing new and leaks nothing', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  const scripts = trackScripts(page)
  await open(page, 'logs')
  const palette = async (title: string) => {
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Search pages and commands' })
    await expect(input).toBeVisible()
    await input.fill(title)
    await page.getByRole('option', { name: title }).click()
  }
  const roundTrip = async () => {
    await palette('Switch layout: Classic')
    await expect(page.locator('[data-aiui-shell-header]')).toBeVisible()
    await expect(frame(page)).toHaveCount(0)
    await palette('Switch layout: Quiet Workbench')
    await expect(frame(page)).toBeVisible()
    await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  }
  // The first trip is the baseline: what a tab opens once opens during it.
  await roundTrip()
  await page.waitForTimeout(500)
  const fetched = scripts.length
  const before = await leakSnapshot(page)
  await roundTrip()
  await page.waitForTimeout(500)
  expect(scripts.slice(fetched).filter((s) => /^(layout|lf)-/.test(s))).toEqual([])
  const delta = leakDelta(before, await leakSnapshot(page))
  for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)
})
