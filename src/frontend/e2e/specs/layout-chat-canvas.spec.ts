/**
 * The Chat and Canvas layout (ADR 0003, track CC), the app shell's default,
 * in a real browser against the scripted provider (fixtures/mock_server.py)
 * at 1440×900 and 390×844, light and dark:
 *
 *   - the frame's regions and landmarks: sidebar (New chat, at most 7
 *     primary pages, the chats), top bar (the open chat and its line,
 *     search, Share, theme), the main landmark with the routed page;
 *   - a conversation with a table, a code block and an approval: the
 *     thread uses the bubbles variant, the approval card decides the gate,
 *     the chat shows up in the sidebar and in the top bar;
 *   - the canvas: when the artifacts feature (`lf-artifacts`) is in the
 *     build, the chat page has a Canvas aside (phone: a Chat | Canvas
 *     switch); without it there is none and the chat still works;
 *   - a non-chat page renders in the outlet and downloads no feature chunk;
 *   - ⌘B hides the sidebar (remembered across a reload), ⌘N / New chat;
 *   - phone: 44 px targets, the menu sheet, nothing scrolls sideways;
 *   - switching to another layout and back leaves no connection, timer or
 *     listener behind.
 *
 * Server: the app shell with the default layout (no AIUI_LAYOUT), e.g. the
 * layouts-host server (fixtures/layout-plugin/serve.py).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')

/** dist file → chunk name (aiui-manifest.json). */
const CHUNK_NAMES: Map<string, string> = (() => {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'aiui-manifest.json'), 'utf8')) as Record<string, { file: string; name?: string }>
  return new Map(Object.values(manifest).map((c) => [c.file, c.name ?? '']))
})()

/** The artifacts feature is in this build: the chat page then has a canvas. */
const HAS_CANVAS = [...CHUNK_NAMES.values()].includes('lf-artifacts')

function trackScripts(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req: Request) => {
    if (req.resourceType() !== 'script') return
    const { pathname } = new URL(req.url())
    seen.push(pathname.startsWith('/assets/') ? (CHUNK_NAMES.get(pathname.slice(1)) ?? pathname) : pathname)
  })
  return seen
}

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

const frame = (page: Page) => page.locator('[data-aiui-layout-frame="chat-canvas"]')
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const assistant = (page: Page) => page.locator('[data-role="assistant"]')
const title = (page: Page) => page.locator('[data-cc-title]')

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

async function waitForRunEnd(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
}

async function runPaletteCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('combobox', { name: 'Search pages and commands' })
  await expect(input).toBeVisible()
  await input.fill(name)
  await page.getByRole('option', { name }).click()
}

/**
 * The modifier the page binds `mod+…` to: ⌘ when the page's platform is
 * Apple, Ctrl elsewhere (the kit's isMacPlatform). Playwright's
 * `ControlOrMeta` follows the host OS instead, and devices['Desktop Chrome']
 * reports Windows, so on a macOS host it would press ⌘ on a Ctrl page.
 */
async function pageModifiers(page: Page): Promise<{ mod: 'Meta' | 'Control'; other: 'Meta' | 'Control' }> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
  })
  return mac ? { mod: 'Meta', other: 'Control' } : { mod: 'Control', other: 'Meta' }
}

/** Icon-only buttons inside the frame that have no accessible name. */
async function unnamedIconButtons(page: Page): Promise<string[]> {
  return frame(page).evaluate((root) => {
    const shell = root.querySelectorAll<HTMLElement>('nav button, header button, nav a, header a')
    return [...shell]
      .filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
      .map((el) => el.outerHTML.slice(0, 120))
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
})

for (const mode of ['light', 'dark'] as ColorMode[]) {
  test(`desktop ${mode}: regions, a conversation with an approval card, the chat in the sidebar and top bar`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.setViewportSize(DESKTOP)
    await setColorMode(page, mode)
    await page.goto('/chat')
    await expect(frame(page)).toHaveAttribute('data-viewport', 'desktop')
    await expect(page.locator('html')).toHaveAttribute('data-aiui-tokens', 'pro')

    // Regions and landmarks.
    const sidebar = page.getByRole('navigation', { name: 'Main' })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /New chat/ })).toBeVisible()
    const primary = sidebar.getByRole('list', { name: 'Primary' }).locator('[data-aiui-nav-item]')
    const count = await primary.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(7)
    await expect(sidebar.locator('[data-aiui-nav-item="chat"]')).toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('heading', { name: 'Chats' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search or run a command' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Switch to (dark|light) theme/ })).toBeVisible()
    await expect(page.locator('main#aiui-main [data-aiui-page="chat"]')).toBeVisible()
    await expect(title(page)).toHaveText('New chat')
    expect(await unnamedIconButtons(page)).toEqual([])
    const bodySize = await title(page).evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-aiui-chat]') ?? document.body).fontSize))
    expect(bodySize).toBeGreaterThanOrEqual(14)

    // A conversation: table, code block, an approval decided on the card.
    // The connection is chrome (the top bar's line), not a pill in the thread.
    await expect(page.locator('[data-connection="open"]')).toBeAttached()
    await expect(page.locator('[data-cc-connection="open"]')).toBeVisible()
    const pillWidth = await page.locator('[data-aiui-chat] [data-connection]').evaluate((el) => el.getBoundingClientRect().width)
    expect(pillWidth, 'the chat page badge is for screen readers only').toBeLessThanOrEqual(1)
    await send(page, 'markdown apok')
    const reply = assistant(page).last()
    await expect(reply.locator('table')).toBeVisible()
    await expect(reply.locator('pre').first()).toBeVisible()
    await expect(page.locator('[data-variant="bubbles"]')).toHaveCount(1)
    const approve = reply.getByRole('button', { name: 'Approve' })
    await expect(approve).toBeVisible()
    // One request, shown once: the card carries the tool row (tool, risk, Details).
    await expect(reply.locator('[data-approval-card] [data-approval-tool]')).toContainText('shell')
    await expect(reply.locator('[data-tool] > button[aria-expanded]')).toHaveCount(0)
    await reply.locator('[data-approval-tool]').click()
    await expect(reply.getByText('Arguments')).toBeVisible()
    await approve.click()
    await expect(approve).toHaveCount(0)
    const seen = await (await page.request.get('/__e2e/approval-posts')).json()
    expect(seen.posts).toContain('POST /api/approvals/ap_ok/approve')
    await waitForRunEnd(page)

    // The chat is the open one in the sidebar, and the top bar names it and its agent.
    const open = sidebar.locator('[data-aiui-session][aria-current="true"]')
    await expect(open).toContainText(/markdown apok/i)
    await expect(title(page)).toContainText(/markdown apok/i)
    await expect(page.locator('[data-cc-subtitle]')).toContainText('Mock')

    // The canvas, when the artifacts feature is in the build.
    if (HAS_CANVAS) {
      await expect(page.getByRole('complementary', { name: 'Canvas' })).toBeVisible()
      await expect(page.locator('[data-chat-aside-toggle]')).toContainText('Canvas')
    } else {
      await expect(page.locator('[data-chat-aside]')).toHaveCount(0)
    }
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })

  test(`phone ${mode}: header with 44 px targets, the menu sheet, the canvas switch, no sideways scroll`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.setViewportSize(PHONE)
    await setColorMode(page, mode)
    await page.goto('/chat')
    await expect(frame(page)).toHaveAttribute('data-viewport', 'phone')
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

    for (const name of ['Open menu and chats', 'New chat']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(box && box.width >= 44 && box.height >= 44, `${name} is at least 44 px`).toBe(true)
    }
    const titleSize = await title(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(titleSize).toBeGreaterThanOrEqual(15)

    await expect(page.locator('[data-connection="open"]')).toBeVisible()
    await send(page, 'markdown phone')
    await expect(assistant(page).last().locator('table')).toBeVisible()
    await waitForRunEnd(page)
    await expect(title(page)).toContainText(/markdown phone/i)

    const toggle = page.locator('[data-chat-aside-switch]')
    if (HAS_CANVAS) {
      await expect(toggle).toBeVisible()
      await toggle.getByRole('button', { name: /Canvas/ }).click()
      await expect(page.getByRole('complementary', { name: 'Canvas' })).toBeVisible()
      await toggle.getByRole('button', { name: 'Chat', exact: true }).click()
    } else {
      await expect(toggle).toHaveCount(0)
    }

    // The menu: nav and chats with 44 px rows; it closes on navigation.
    await page.getByRole('button', { name: 'Open menu and chats' }).click()
    const sheet = page.locator('[data-aiui-phone-sheet]')
    await expect(sheet).toBeVisible()
    const row = sheet.locator('[data-aiui-session]').first()
    await expect(row).toBeVisible()
    expect(((await row.boundingBox())?.height ?? 0) >= 44).toBe(true)
    await sheet.locator('[data-aiui-nav-item="agents"]').click()
    await expect(page).toHaveURL(/\/agents$/)
    await expect(sheet).toBeHidden()
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}

test('a non-chat page renders in the outlet with its title and downloads no feature chunk', async ({ page }) => {
  const scripts = trackScripts(page)
  await page.setViewportSize(DESKTOP)
  await page.goto('/logs')
  await expect(frame(page)).toBeVisible()
  await expect(page.locator('main#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  await expect(title(page)).toHaveText(/Logs/)
  await expect(page.locator('[data-cc-subtitle]')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(scripts.filter((s) => /^lf-/.test(s))).toEqual([])
  expect([...new Set(scripts.filter((s) => /^layout-/.test(s)))].sort()).toEqual(['layout-chat-canvas', 'layout-kit'])
})

test('the composer is one quiet row at rest: after a desktop-to-phone switch, a model button, no loud ring', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  const input = page.getByRole('textbox', { name: 'Message' })
  await expect(input).toBeVisible()
  await expect(page.locator('[data-composer-model]')).toHaveAttribute('aria-label', /^Model: .+\. Change model$/)
  // Focused or not, the composer's halo is a soft 3px ring, never a 2px solid band.
  const shadow = await page.locator('form:has(textarea[aria-label="Message"])').evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).not.toMatch(/0px 0px 0px 2px/)
  await page.setViewportSize(PHONE)
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeLessThan(40)
})

test('⌘B hides the sidebar and it stays hidden after a reload; New chat starts an empty chat', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  const sidebar = page.getByRole('navigation', { name: 'Main' })
  await expect(sidebar).toBeVisible()
  await page.locator('body').click()
  const { mod, other } = await pageModifiers(page)
  // The other platform's modifier is not the shortcut (Ctrl+B on a Mac moves
  // the caret back one character in a text field).
  await page.keyboard.press(`${other}+b`)
  await page.waitForTimeout(150)
  await expect(sidebar).toBeVisible()
  await page.keyboard.press(`${mod}+b`)
  await expect(sidebar).toHaveCount(0)
  await page.reload()
  await expect(frame(page)).toBeVisible()
  await expect(sidebar).toHaveCount(0)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(sidebar).toBeVisible()

  await send(page, 'plain first')
  await waitForRunEnd(page)
  await expect(title(page)).toContainText(/plain first/i)
  await sidebar.getByRole('button', { name: /New chat/ }).click()
  await expect(title(page)).toHaveText('New chat')
  await expect(assistant(page)).toHaveCount(0)
})

test('switching to another layout and back leaks no connection, timer or listener', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  await expect(frame(page)).toBeVisible()
  await expect(page.locator('[data-connection="open"]')).toBeVisible()

  const roundTrip = async () => {
    await runPaletteCommand(page, 'Switch layout: Quiet Workbench')
    await expect(page.locator('[data-aiui-layout-frame="workbench"]')).toBeVisible()
    await runPaletteCommand(page, 'Switch layout: Chat and Canvas')
    await expect(frame(page)).toBeVisible()
    await expect(page.locator('main#aiui-main [data-aiui-page="chat"]')).toBeVisible()
  }
  // The first trip is the baseline: what a tab opens once opens during it.
  await roundTrip()
  await page.waitForTimeout(500)
  const before = await leakSnapshot(page)
  await roundTrip()
  await page.waitForTimeout(500)
  const delta = leakDelta(before, await leakSnapshot(page))
  for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)
  expect(errors.pageErrors).toEqual([])
})
