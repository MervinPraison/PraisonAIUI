/**
 * The Command Deck layout (ADR 0003 track K) in a real browser, against the
 * layouts server (e2e/fixtures/layout-plugin/serve.py: the mock server in the
 * app shell), previewed with ?layout=command:
 *
 *   - desktop and phone, light and dark: the frame's regions and landmarks,
 *     the Pro tokens, at most seven rail items, no sideways scroll, readable
 *     text and 44 px phone targets;
 *   - a run that pauses for approval: the run inspector follows it and the
 *     A key approves it once (one POST, however many A handlers listen);
 *   - the keys: ⌘I, ⌘/, G-prefix navigation, `/` and the command bar opening
 *     the one palette, ⌘1 on the session tabs;
 *   - a non-chat page in the outlet; network isolation (only this layout's
 *     chunks and its two features, the run inspector only on the chat page);
 *   - switching away and back leaves no socket, timer or listener.
 *
 * Runs with the layouts server, e.g. as part of the `layouts-host` project
 * (its testMatch must include this file), or on its own:
 *   AIUI_E2E_REUSE=1 npx playwright test -c e2e/fixtures/layout-plugin/playwright.config.ts e2e/specs/layout-command.spec.ts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

const frame = (page: Page) => page.locator('[data-aiui-layout-frame="command"]')
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const bar = (page: Page) => page.getByRole('textbox', { name: 'Ask or run a command' })
const inspector = (page: Page) => page.locator('[data-run-inspector="panel"]')
const peek = (page: Page) => page.locator('[data-run-inspector="sheet"]')

/** dist file → chunk name (aiui-manifest.json). */
const CHUNK_NAMES: Map<string, string> = (() => {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'aiui-manifest.json'), 'utf8')) as Record<string, { file: string; name?: string }>
  return new Map(Object.values(manifest).map((c) => [c.file, c.name ?? '']))
})()

function trackLayoutChunks(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() !== 'script') return
    const { pathname } = new URL(req.url())
    const name = pathname.startsWith('/assets/') ? CHUNK_NAMES.get(pathname.slice(1)) : undefined
    if (name && /^(layout|lf)-/.test(name)) seen.push(name)
  })
  return seen
}

const groups = (names: string[]) => [...new Set(names)].sort()

async function openDeck(page: Page, pageId = 'chat'): Promise<void> {
  await page.goto(`/${pageId}?layout=command`)
  await expect(frame(page)).toBeVisible()
  await expect(page.locator(`#aiui-main [data-aiui-page="${pageId}"]`)).toBeVisible()
}

/** Put the focus on the page (not a field), so single-key shortcuts are the page's. */
async function focusPage(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
}

/**
 * The modifier the frame reads as ⌘ (`mod`): Meta where the page reports an
 * Apple platform, else Control. The page decides, not the machine running
 * the test (the Desktop Chrome profile reports Windows).
 */
async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
  })
  return mac ? 'Meta' : 'Control'
}

async function approvalPosts(page: Page): Promise<string[]> {
  return ((await (await page.request.get('/__e2e/approval-posts')).json()) as { posts: string[] }).posts
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
})

for (const mode of ['light', 'dark'] as ColorMode[]) {
  test(`desktop ${mode}: command bar, rail, session tabs, outlet, run inspector and status bar`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.setViewportSize(DESKTOP)
    await openDeck(page)
    await expect(page.locator('html')).toHaveAttribute('data-aiui-tokens', 'pro')
    await expect(page.locator('[data-aiui-shell-root]')).toHaveAttribute('data-aiui-layout', 'command')
    await expect(page.getByRole('search')).toBeVisible()
    await expect(bar(page)).toBeVisible()
    const rail = page.getByRole('navigation', { name: 'Main' })
    await expect(rail).toBeVisible()
    const items = await rail.locator('a[data-aiui-nav-item]').count()
    expect(items).toBeGreaterThan(0)
    expect(items).toBeLessThanOrEqual(7)
    await expect(rail.locator('a[data-aiui-nav-item="chat"]')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible()
    // Rail labels, the footer's longer ones ("Inspector") included, are whole words.
    const clipped = await rail.locator('a[data-aiui-nav-item] span.truncate').evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
    )
    expect(clipped, 'no rail label is cut off').toEqual([])
    await expect(page.getByRole('tablist', { name: 'Open sessions' })).toBeVisible()
    await expect(page.locator('[data-command-run-toggle]')).toHaveAttribute('aria-pressed', 'true')
    await expect(inspector(page)).toBeVisible()
    await expect(page.locator('[data-command-status]')).toContainText('runs active')
    // Icon-only controls carry a name; body text is at least 14 px.
    for (const b of await frame(page).locator('button:not(:has-text(" "))').all()) {
      if (!(await b.isVisible())) continue
      const name = (await b.getAttribute('aria-label')) ?? (await b.innerText()).trim()
      expect(name, 'every visible button has a name').not.toBe('')
    }
    const size = await bar(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(14)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}

test('a run paused for approval: the inspector follows it, A approves it once, the tabs and ⌘1 switch sessions', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize(DESKTOP)
  await openDeck(page)
  await expect(inspector(page).locator('[data-run-empty]')).toBeVisible()

  // The bar asks: Enter puts the question in the composer.
  await focusPage(page)
  await page.keyboard.press('/')
  await expect(bar(page)).toBeFocused()
  await bar(page).fill('Compare sorting algorithms apok')
  await bar(page).press('Enter')
  await expect(composer(page)).toHaveValue('Compare sorting algorithms apok')
  await composer(page).press('Enter')

  await expect(inspector(page).locator('[data-run-status="waiting"]')).toBeVisible()
  await expect(inspector(page).getByRole('heading', { name: 'Approval needed' })).toBeVisible()
  await expect(inspector(page).locator('[data-run-step][data-state="waiting"]')).toHaveCount(1)
  await expect(page.locator('[data-command-approvals]')).toContainText('1 approval waiting')
  // The paused run is still an active run (the design: "1 run active · 1 approval").
  await expect(page.locator('[data-command-status]')).toContainText('1 run active · 1 approval')
  await expect(page.locator('[data-command-rail] a[data-aiui-nav-item="runs"] [aria-label="1 active run"]')).toHaveText('1')
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText('Compare sorting algorithms apok')

  const before = (await approvalPosts(page)).filter((p) => p.includes('ap_ok')).length
  await focusPage(page)
  await page.keyboard.press('a')
  await expect(inspector(page).locator('[data-run-status="completed"]')).toBeVisible()
  await expect(page.locator('[data-command-approvals]')).toHaveCount(0)
  const posts = (await approvalPosts(page)).filter((p) => p.includes('ap_ok'))
  expect(posts.slice(before)).toEqual(['POST /api/approvals/ap_ok/approve'])

  // J moves through the steps; Enter expands the focused one.
  await focusPage(page)
  await page.keyboard.press('j')
  await expect(inspector(page).locator('[data-run-step="01"]')).toBeFocused()

  // A new chat is a new tab; ⌘1 goes back to the first.
  await page.locator('[data-command-tabs]').getByRole('button', { name: 'New chat' }).click()
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText('New chat')
  await focusPage(page)
  await page.keyboard.press(`${await modKey(page)}+2`)
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText('Compare sorting algorithms apok')
  expect(errors.pageErrors).toEqual([])
})

test('keys: ⌘I, ⌘/, G-prefix navigation, and the bar opening the one palette', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await openDeck(page)
  const toggle = page.locator('[data-command-run-toggle]')
  const mod = await modKey(page)

  await page.keyboard.press(`${mod}+i`)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(inspector(page)).toHaveCount(0)
  await page.keyboard.press(`${mod}+i`)
  await expect(inspector(page)).toBeVisible()

  await page.keyboard.press(`${mod}+/`)
  const sheet = page.locator('dialog[data-command-shortcuts]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  await expect(sheet).toContainText('Go to')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // G A: the agents page, in this frame's outlet.
  await focusPage(page)
  await page.keyboard.press('g')
  await page.keyboard.press('a')
  await expect(page).toHaveURL(/\/agents(\?|$)/)
  await expect(page.locator('#aiui-main [data-aiui-page="agents"]')).toBeVisible()
  await expect(page.locator('a[data-aiui-nav-item="agents"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('tablist', { name: 'Open sessions' })).toHaveCount(0)

  // `/logs` in the bar opens the palette with "logs" typed in; the page renders in the outlet.
  await focusPage(page)
  await page.keyboard.press('/')
  await bar(page).pressSequentially('/logs')
  const search = page.getByRole('combobox', { name: 'Search pages and commands' })
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('logs')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/logs(\?|$)/)
  await expect(frame(page)).toBeVisible()
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
})

for (const mode of ['light', 'dark'] as ColorMode[]) {
  test(`phone ${mode}: the bar and menu on top, the n/m switcher, the run peek with 44 px Approve`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.setViewportSize(PHONE)
    await openDeck(page)
    await expect(frame(page)).toHaveAttribute('data-viewport', 'phone')
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
    await expect(page.locator('[data-command-status]')).toHaveCount(0)
    const menu = page.getByRole('button', { name: /^Open menu: destinations and sessions/ })
    for (const target of [menu, page.getByRole('button', { name: 'New chat' }), page.locator('[data-command-bar]')]) {
      const box = await target.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    }

    await composer(page).fill('phone apok')
    await composer(page).press('Enter')
    await expect(peek(page).locator('[data-run-status="waiting"]')).toBeVisible()
    const approve = peek(page).locator('[data-run-approve]')
    expect((await approve.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    await expect(page.locator('[data-command-switcher]')).toContainText(/phone apok/i)
    const title = page.locator('[data-command-switcher] span.truncate')
    expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15)
    expect(await hasHorizontalOverflow(page)).toBe(false)

    // The menu while the approval waits: "Waiting for you" keeps its full
    // height above the nav (it is not squeezed to its heading with the
    // Deny / Approve card drawn over the links), and so does the session list.
    await menu.click()
    const openSheet = page.locator('[data-aiui-phone-sheet]')
    await expect(openSheet).toBeVisible()
    const pendingList = openSheet.locator('[data-command-pending]')
    await expect(pendingList.getByRole('button', { name: 'Approve' })).toBeVisible()
    const firstLink = openSheet.locator('a[data-aiui-nav-item]').first()
    const [listBox, linkBox] = [await pendingList.boundingBox(), await firstLink.boundingBox()]
    expect(listBox && linkBox, 'the approval list and the nav are laid out').toBeTruthy()
    expect(listBox!.y + listBox!.height, 'the approval list ends above the first nav link').toBeLessThanOrEqual(linkBox!.y + 0.5)
    for (const section of [openSheet.locator('[data-command-waiting] > section'), openSheet.locator('[data-aiui-session-list] > section')]) {
      const { client, scroll } = await section.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
      expect(client, 'a sheet section shows all of its content (the sheet scrolls, not the section)').toBeGreaterThanOrEqual(scroll)
    }
    await expect(openSheet.locator('[data-aiui-session-list] [data-aiui-session]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(openSheet).toBeHidden()

    // Expanded, the peek is the whole inspector.
    await peek(page).getByRole('button', { name: 'Expand run panel' }).click()
    await expect(peek(page).locator('[data-run-metrics]')).toBeVisible()
    await approve.click()
    await expect(peek(page).locator('[data-run-status="completed"]')).toBeVisible()

    // The menu: destinations and sessions in a sheet.
    await menu.click()
    const sheetEl = page.locator('[data-aiui-phone-sheet]')
    await expect(sheetEl).toBeVisible()
    await expect(sheetEl.locator('[data-aiui-session-list]')).toContainText(/phone apok/i)
    await sheetEl.locator('a[data-aiui-nav-item="agents"]').click()
    await expect(page.locator('#aiui-main [data-aiui-page="agents"]')).toBeVisible()
    await expect(peek(page)).toHaveCount(0)
    expect(errors.pageErrors).toEqual([])
  })
}

test('network: the deck downloads its own chunks and features, the run inspector only for the chat page', async ({ page }) => {
  const chunks = trackLayoutChunks(page)
  await page.setViewportSize(DESKTOP)
  await openDeck(page, 'logs')
  await expect(page.getByRole('search')).toBeVisible()
  await expect(bar(page)).toBeVisible()
  expect(groups(chunks)).toEqual(['layout-command', 'layout-kit', 'lf-command-bar'])
  await page.locator('a[data-aiui-nav-item="chat"]').click()
  await expect(inspector(page)).toBeVisible()
  expect(groups(chunks)).toEqual(['layout-command', 'layout-kit', 'lf-command-bar', 'lf-run-inspector'])
})

test('switching away from the deck and back leaves nothing behind', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await openDeck(page)
  await expect(inspector(page)).toBeVisible()
  const roundTrip = async () => {
    await page.keyboard.press('ControlOrMeta+k')
    const search = page.getByRole('combobox', { name: 'Search pages and commands' })
    await search.fill('Switch layout: Classic')
    await page.getByRole('option', { name: 'Switch layout: Classic' }).click()
    await expect(frame(page)).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+k')
    await search.fill('Switch layout: Command Deck')
    await page.getByRole('option', { name: 'Switch layout: Command Deck' }).click()
    await expect(inspector(page)).toBeVisible()
  }
  // The first trip is the baseline: what a tab opens once opens during it.
  await roundTrip()
  await page.waitForTimeout(500)
  const before = await leakSnapshot(page)
  await roundTrip()
  await page.waitForTimeout(500)
  const delta = leakDelta(before, await leakSnapshot(page))
  for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)
})
