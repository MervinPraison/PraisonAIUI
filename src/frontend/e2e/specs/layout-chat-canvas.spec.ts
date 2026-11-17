/**
 * The Chat and Canvas layout (ADR 0003, track CC), the app shell's default,
 * in a real browser against the scripted provider (fixtures/mock_server.py)
 * at 1440×900 and 390×844, light and dark:
 *
 *   - the frame's regions and landmarks: sidebar (New chat, at most 7
 *     primary pages, the chats), top bar (the open chat and its line,
 *     search, Share once the chat has a message, theme), the main landmark with the routed page;
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

/** The reply's table card; every mock reply also carries the tool's chart image as a card. */
const TABLE_CARD = '[data-artifact-card^="table:"]'

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
    // The layout's own look (Canvas.dc.html): paper neutrals and a serif title.
    await expect(page.locator('html')).toHaveAttribute('data-aiui-look', 'paper')
    expect(await title(page).evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Newsreader/)

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
    // A new chat has nothing to share yet: Share comes with the first message.
    await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Switch to (dark|light) theme/ })).toBeVisible()
    await expect(page.locator('main#aiui-main [data-aiui-page="chat"]')).toBeVisible()
    await expect(title(page)).toHaveText('New chat')
    // A new chat is the brand moment: the wordmark and promise, the starters, and the
    // composer together in the middle of the thread (not pinned to the bottom).
    await expect(page.locator('[data-chat-hero] h2')).toBeVisible()
    {
      const [hero, box, thread] = [
        await page.locator('[data-chat-hero]').boundingBox(),
        await page.getByRole('textbox', { name: 'Message' }).boundingBox(),
        await page.locator('[data-aiui-thread]').boundingBox(),
      ]
      expect(hero && box && thread && hero.y > thread.y + 40 && box.y + box.height < thread.y + thread.height - 40, 'hero and composer centred').toBe(true)
    }
    expect(await unnamedIconButtons(page)).toEqual([])
    const bodySize = await title(page).evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-aiui-chat]') ?? document.body).fontSize))
    expect(bodySize).toBeGreaterThanOrEqual(14)

    // A conversation: table, code block, an approval decided on the card.
    // The connection is chrome, not a pill in the thread: "Connected" at the
    // sidebar's foot; the top bar's line names it only while it is not open.
    await expect(page.locator('[data-connection="open"]')).toBeAttached()
    await expect(sidebar.locator('[data-aiui-connection="online"]')).toContainText('Connected')
    await expect(page.locator('[data-cc-connection]')).toHaveCount(0)
    await expect(sidebar.locator('[data-cc-more]')).toContainText('More')
    // Settings at the foot (the config page), as the design draws it; Inspector is in More.
    await expect(sidebar.locator('[data-aiui-nav-item="config"]')).toContainText('Settings')
    await expect(sidebar.locator('[data-aiui-nav-item="inspector"]')).toHaveCount(0)
    const pillWidth = await page.locator('[data-aiui-chat] [data-connection]').evaluate((el) => el.getBoundingClientRect().width)
    expect(pillWidth, 'the chat page badge is for screen readers only').toBeLessThanOrEqual(1)
    await send(page, 'markdown apok')
    const reply = assistant(page).last()
    if (HAS_CANVAS) {
      // The table is an artifact: the reply shows its card, the canvas the table.
      // The tool's chart image is a second card, so name the table's.
      await expect(reply.locator(TABLE_CARD)).toBeVisible()
      await expect(reply.locator('table')).toBeHidden()
    } else {
      await expect(reply.locator('table')).toBeVisible()
    }
    // A two-line snippet is no artifact: it stays in the reply.
    await expect(reply.locator('pre').first()).toBeVisible()
    await expect(page.locator('[data-variant="bubbles"]')).toHaveCount(1)
    const approve = reply.getByRole('button', { name: 'Approve' })
    await expect(approve).toBeVisible()
    // One request, shown once: the card carries the tool row (tool, risk, Details).
    await expect(reply.locator('[data-approval-card] [data-approval-tool]')).toContainText('High risk')
    // The design's order: Approve, Deny, then the pause note.
    await expect(reply.getByRole('button', { name: 'Deny' })).toBeVisible()
    await expect(reply.locator('[data-approval-card]')).toContainText('Paused until you choose')
    // The composer: the text above a row of attach, model and a round Send.
    {
      const [text, send] = [
        await page.getByRole('textbox', { name: 'Message' }).boundingBox(),
        await page.getByRole('button', { name: 'Send' }).boundingBox(),
      ]
      expect(text && send && send.y >= text.y + text.height - 2, 'Send sits under the text').toBe(true)
      expect(await page.getByRole('button', { name: 'Send' }).evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px')
    }
    await expect(reply.locator('[data-tool] > button[aria-expanded]')).toHaveCount(0)
    await reply.locator('[data-approval-tool]').click()
    await expect(reply.getByText('Arguments')).toBeVisible()
    await approve.click()
    await expect(approve).toHaveCount(0)
    const seen = await (await page.request.get('/__e2e/approval-posts')).json()
    expect(seen.posts).toContain('POST /api/approvals/ap_ok/approve')
    await waitForRunEnd(page)

    await expect(page.locator('[data-cc-share]')).toBeVisible()
    // The chat is the open one in the sidebar, and the top bar names it and its agent.
    const open = sidebar.locator('[data-aiui-session][aria-current="true"]')
    await expect(open).toContainText(/markdown apok/i)
    await expect(title(page)).toContainText(/markdown apok/i)
    await expect(page.locator('[data-cc-subtitle]')).toContainText('Mock')

    // The canvas, when the artifacts feature is in the build.
    if (HAS_CANVAS) {
      await expect(page.getByRole('complementary', { name: 'Canvas' })).toBeVisible()
      // The toggle sits in the top bar (pressed while open), the chat's row counts its artifacts.
      const toggle = page.locator('header [data-chat-aside-toggle]')
      await expect(toggle).toContainText('Canvas')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(open.locator('[data-cc-chat-meta]')).toContainText(/\d artifacts? · /)
      // "@" references an artifact: the list of this chat's artifacts, a choice puts a plain mention in the message.
      const box = page.getByRole('textbox', { name: 'Message' })
      await expect(box).toHaveAttribute('placeholder', 'Ask a follow-up, or type @ to edit an artifact')
      await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true')
      await page.getByRole('button', { name: 'Reference an artifact' }).click()
      await page.getByRole('list', { name: "This chat's artifacts" }).getByRole('button', { name: /Model table/ }).click()
      await expect(box).toHaveValue(/@"Model table" $/)
      await expect(page.getByRole('button', { name: 'Send' })).not.toHaveAttribute('aria-disabled', 'true')
      await box.fill('')
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
    await expect(assistant(page).last().locator(HAS_CANVAS ? TABLE_CARD : 'table')).toBeVisible()
    await waitForRunEnd(page)
    await expect(title(page)).toContainText(/markdown phone/i)
    // The header's line is the agent and the model (CanvasPhone.dc.html), the composer's own placeholder.
    await expect(page.locator('[data-cc-subtitle]')).toContainText(/^Mock\s*·\s*\S+/)
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Ask a follow-up')

    const toggle = page.locator('[data-chat-aside-switch]')
    if (HAS_CANVAS) {
      await expect(toggle).toBeVisible()
      await toggle.getByRole('button', { name: /Canvas/ }).click()
      await expect(page.getByRole('complementary', { name: 'Canvas' })).toBeVisible()
      await toggle.getByRole('button', { name: 'Chat', exact: true }).click()
      // A card takes the phone to the canvas side.
      await assistant(page).last().locator(TABLE_CARD).click()
      await expect(page.getByRole('complementary', { name: 'Canvas' })).toBeVisible()
      await expect(toggle).toHaveAttribute('data-tab', 'aside')
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

test('the canvas is the main surface: wider than the thread, resizable by keyboard; one copy of each artifact', async ({ page }) => {
  test.skip(!HAS_CANVAS, 'the artifacts feature is not in this build')
  const errors = collectPageErrors(page)
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  await send(page, 'Compare sorting algorithms')
  const reply = assistant(page).last()
  const canvas = page.getByRole('complementary', { name: 'Canvas' })
  await expect(canvas).toBeVisible()
  await expect(reply.locator('[data-artifact-card]')).toHaveCount(2)
  // The table and sort_demo.py are in the canvas; the reply shows their cards only.
  await expect(reply.locator('table')).toBeHidden()
  await expect(reply.locator('[data-in-canvas]')).toHaveCount(2)
  for (const el of await reply.locator('[data-in-canvas]').all()) await expect(el).toBeHidden()
  await expect(reply.locator('[data-aiui-code]')).toBeHidden()
  await expect(reply.getByText('Here is how the three common')).toBeVisible()

  const width = async (sel: string) => (await page.locator(sel).boundingBox())?.width ?? 0
  const [aside, thread] = [await width('[data-chat-aside]'), await width('[data-aiui-chat] > section')]
  expect(aside, 'the canvas is wider than the chat').toBeGreaterThan(thread)
  expect(thread, 'the chat keeps a readable column').toBeGreaterThanOrEqual(380)

  const handle = page.getByRole('separator', { name: 'Resize Canvas' })
  const before = Number(await handle.getAttribute('aria-valuenow'))
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(before)
  await page.keyboard.press('Home')
  expect(await width('[data-aiui-chat] > section')).toBeGreaterThanOrEqual(380)

  // Closed, a card brings the canvas back with that artifact.
  await page.locator('[data-chat-aside-toggle]').click()
  await expect(canvas).toBeHidden()
  await reply.locator('[data-artifact-card="sort_demo.py"]').click()
  await expect(canvas).toBeVisible()
  await expect(canvas.getByRole('tab', { name: /sort_demo\.py/ })).toHaveAttribute('aria-selected', 'true')
  expect(errors.pageErrors).toEqual([])
})

test('the canvas panel as designed: tabs with split, + and close; the code docked below the table', async ({ page }) => {
  test.skip(!HAS_CANVAS, 'the artifacts feature is not in this build')
  const errors = collectPageErrors(page)
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  await send(page, 'Compare sorting algorithms')
  const canvas = page.getByRole('complementary', { name: 'Canvas' })
  await expect(canvas.getByRole('tab', { name: /Algorithm table/ })).toHaveAttribute('aria-selected', 'true')
  await expect(canvas.getByRole('tab', { name: /sort_demo\.py/ })).toContainText('split')
  const split = canvas.locator('[data-artifact-split="sort_demo.py"]')
  await expect(split).toBeVisible()
  await expect(split).toContainText('Python · v1 · by Researcher')
  await expect(split.locator('[data-aiui-art-code]')).toBeVisible()
  await expect(canvas.getByRole('columnheader', { name: /Algorithm/ })).toBeVisible()
  await expect(canvas.getByText('Select a column header to sort.')).toBeVisible()

  // "+": a disclosure list; Escape closes it.
  const plus = canvas.getByRole('button', { name: 'Open another artifact' })
  const menu = canvas.getByRole('list', { name: 'Open an artifact' })
  await plus.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(plus).toBeFocused()

  // The split closed stays closed; "+" docks the code below again.
  await split.getByRole('button', { name: 'Close the split view' }).click()
  await expect(split).toHaveCount(0)
  await plus.click()
  await menu.getByRole('button', { name: /sort_demo\.py/ }).click()
  await expect(split).toBeVisible()

  await canvas.getByRole('button', { name: 'Close the canvas' }).click()
  await expect(canvas).toBeHidden()
  await expect(page.locator('[data-chat-aside-toggle]')).toHaveAttribute('aria-pressed', 'false')
  expect(errors.pageErrors).toEqual([])
})

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

test('the composer is two quiet rows at rest: after a desktop-to-phone switch, a model button, no loud ring', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/chat')
  const input = page.getByRole('textbox', { name: 'Message' })
  await expect(input).toBeVisible()
  await expect(page.locator('[data-composer-model]')).toHaveAttribute('aria-label', /^Model: .+\. Change model$/)
  // Focused or not, the composer's halo is a soft 3px ring, never a 2px solid band.
  const shadow = await page.locator('form:has(textarea[aria-label="Message"])').evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).not.toMatch(/0px 0px 0px 2px/)
  // Two rows of text (Canvas.dc.html), not a column the auto-height measured as a sliver.
  await page.setViewportSize(PHONE)
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeLessThan(72)
  expect((await input.boundingBox())?.height ?? 0).toBeGreaterThan(40)
  await expect(page.locator('[data-composer-model]')).toBeVisible()
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

test('the Paper look: another layout drops it, "Switch look: Pro" turns it off and it stays off', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await setColorMode(page, 'light')
  await page.goto('/chat')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-aiui-look', 'paper')
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())
  expect(paper).toBe('#f6f3ec')
  await runPaletteCommand(page, 'Switch layout: Quiet Workbench')
  await expect(page.locator('[data-aiui-layout-frame="workbench"]')).toBeVisible()
  await expect(html).not.toHaveAttribute('data-aiui-look', /.*/)
  await runPaletteCommand(page, 'Switch layout: Chat and Canvas')
  await expect(html).toHaveAttribute('data-aiui-look', 'paper')
  await runPaletteCommand(page, 'Switch look: Pro')
  await expect(html).not.toHaveAttribute('data-aiui-look', /.*/)
  await expect(html).toHaveAttribute('data-aiui-tokens', 'pro')
  await page.reload()
  await expect(frame(page)).toBeVisible()
  await expect(html).not.toHaveAttribute('data-aiui-look', /.*/)
  await runPaletteCommand(page, 'Switch look: Paper')
  await expect(html).toHaveAttribute('data-aiui-look', 'paper')
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
