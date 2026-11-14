/**
 * The layout host (ADR 0003 §1.2-1.4) in a real browser, against the mock
 * server with a third-party layout plugin (e2e/fixtures/layout-plugin):
 *
 *   - the app shell opens in the default layout (chat-canvas) and downloads
 *     that layout's chunks only: no other layout, no plugin layout module;
 *   - ?layout=classic is a tab preview that survives navigation and reload;
 *   - the plugin layout appears in the palette and Settings → Appearance and
 *     its module is imported only when it is picked; the choice persists;
 *   - pages render in every frame's outlet; switching back and forth leaves
 *     no connection, timer or listener behind;
 *   - a frame that throws falls back to the classic frame with one toast and
 *     an aiui:plugin-error event;
 *   - phone: the frame's menu sheet.
 *
 * Runs as the `layouts-host` project of e2e/playwright.config.ts (CI), or on
 * its own with e2e/fixtures/layout-plugin/playwright.config.ts.
 *
 * Until the server half of ADR 0003 (F2: manifest `layouts`) is merged, the
 * manifest the server sends has no `layouts` key; the suite then adds the
 * one F2 will send (FALLBACK_LAYOUTS) to the boot manifest, so the shell half
 * is tested either way. Once the server sends it, nothing is patched.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'
import { installLeakProbe, leakDelta, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow } from './support'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '..', '..', 'dist')

const BUILTIN_IDS = ['chat-canvas', 'workbench', 'command', 'guided', 'mission']
const FALLBACK_LAYOUTS = {
  default: 'chat-canvas',
  userChoice: true,
  available: [
    { id: 'chat-canvas', title: 'Chat + Canvas', source: 'builtin.layout-chat-canvas', order: 10, home: 'chat' },
    { id: 'workbench', title: 'Workbench', source: 'builtin.layout-workbench', order: 20, home: 'chat' },
    { id: 'command', title: 'Command Deck', source: 'builtin.layout-command', order: 30, home: 'chat' },
    { id: 'guided', title: 'Guided', source: 'builtin.layout-guided', order: 40, home: 'chat' },
    { id: 'mission', title: 'Mission Control', source: 'builtin.layout-mission', order: 50, home: 'chat' },
    { id: 'aurora', title: 'Aurora', source: 'plugin:layoutfx', module: '/_plugins/layoutfx/aurora.js', order: 90 },
    { id: 'broken', title: 'Broken', source: 'plugin:layoutfx', module: '/_plugins/layoutfx/broken.js', order: 95 },
  ],
}

function withLayouts(manifest: Record<string, unknown>): Record<string, unknown> {
  return manifest.layouts ? manifest : { ...manifest, layouts: FALLBACK_LAYOUTS }
}

const BOOT = /(<script id="aiui-boot" type="application\/json">)([\s\S]*?)(<\/script>)/

/** Add FALLBACK_LAYOUTS to the boot and API manifests when the server sends none. */
async function offerLayouts(page: Page): Promise<void> {
  await page.route('**/api/shell/manifest', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: withLayouts(await res.json()) })
  })
  await page.route(
    (url) => !url.pathname.includes('.') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_'),
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback()
      const res = await route.fetch()
      const body = await res.text()
      const patched = body.replace(BOOT, (_m, open: string, json: string, close: string) => {
        const next = JSON.stringify(withLayouts(JSON.parse(json))).replace(/</g, '\\u003c')
        return `${open}${next}${close}`
      })
      await route.fulfill({ response: res, body: patched })
    },
  )
}

/** dist file → chunk name (aiui-manifest.json), so requests map to layout groups. */
const CHUNK_NAMES: Map<string, string> = (() => {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'aiui-manifest.json'), 'utf8')) as Record<string, { file: string; name?: string }>
  return new Map(Object.values(manifest).map((c) => [c.file, c.name ?? '']))
})()

/** Every script the page requests, as a chunk name or a plugin path. */
function trackScripts(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req: Request) => {
    if (req.resourceType() !== 'script') return
    const { pathname } = new URL(req.url())
    seen.push(pathname.startsWith('/assets/') ? (CHUNK_NAMES.get(pathname.slice(1)) ?? pathname) : pathname)
  })
  return seen
}

const layoutGroups = (scripts: string[]) => [...new Set(scripts.filter((s) => /^layout-/.test(s)))].sort()

const frame = (page: Page, id: string) => page.locator(`[data-aiui-layout-frame="${id}"]`)
const shellRoot = (page: Page) => page.locator('[data-aiui-shell-root]')

async function runPaletteCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('combobox', { name: 'Search pages and commands' })
  await expect(input).toBeVisible()
  await input.fill(title)
  await page.getByRole('option', { name: title }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installLeakProbe)
  await page.addInitScript(() => {
    const w = window as unknown as { __pluginErrors: unknown[] }
    w.__pluginErrors = []
    window.addEventListener('aiui:plugin-error', (e) => w.__pluginErrors.push((e as CustomEvent).detail))
  })
  await offerLayouts(page)
})

test('the server offers the built-in layouts and the plugin layout', async ({ page }) => {
  await page.goto('/chat')
  const manifest = await page.evaluate(() => fetch('/api/shell/manifest').then((r) => r.json()))
  expect(manifest.plugins).toContainEqual(expect.objectContaining({ name: 'layoutfx', status: 'ok' }))
  const ids = manifest.layouts.available.map((s: { id: string }) => s.id)
  expect(ids).toEqual(expect.arrayContaining([...BUILTIN_IDS, 'aurora']))
  const aurora = manifest.layouts.available.find((s: { id: string }) => s.id === 'aurora')
  expect(aurora.module).toMatch(/^\/_plugins\/layoutfx\/aurora\.js/)
})

test('the app shell opens in the default layout and downloads only its chunks', async ({ page }) => {
  const errors = collectPageErrors(page)
  const scripts = trackScripts(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/chat$/)
  await expect(frame(page, 'chat-canvas')).toBeVisible()
  await expect(shellRoot(page)).toHaveAttribute('data-aiui-layout', 'chat-canvas')
  await expect(page.locator('#aiui-main [data-aiui-page="chat"]')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  expect(layoutGroups(scripts)).toEqual(['layout-chat-canvas', 'layout-kit'])
  expect(scripts.filter((s) => s.startsWith('/_plugins/layoutfx/'))).toEqual([])
  expect(scripts.filter((s) => /^lf-/.test(s))).toEqual([])

  // A non-chat page renders in the same frame's outlet.
  await page.goto('/logs')
  await expect(frame(page, 'chat-canvas')).toBeVisible()
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

for (const id of BUILTIN_IDS) {
  test(`network isolation: ${id} downloads its own chunks and the kit, nothing of another layout`, async ({ page }) => {
    const scripts = trackScripts(page)
    for (const pageId of ['chat', 'logs']) {
      await page.goto(`/${pageId}?layout=${id}`)
      await expect(frame(page, id)).toBeVisible()
      await expect(page.locator(`#aiui-main [data-aiui-page="${pageId}"]`)).toBeVisible()
    }
    expect(layoutGroups(scripts)).toEqual([`layout-${id}`, 'layout-kit'].sort())
    expect(scripts.filter((s) => /^lf-/.test(s) || s.startsWith('/_plugins/layoutfx/'))).toEqual([])
  })
}

test('?layout=classic previews the classic frame for this tab, across navigation and reload', async ({ page }) => {
  const scripts = trackScripts(page)
  await page.goto('/chat?layout=classic')
  await expect(page.locator('[data-aiui-shell-header]')).toBeVisible()
  await expect(shellRoot(page)).not.toHaveAttribute('data-aiui-layout', /.+/)
  await expect(page.locator('[data-aiui-layout-frame]')).toHaveCount(0)
  expect(layoutGroups(scripts)).toEqual([])

  await page.locator('[data-aiui-shell-sidebar] a[data-page-id="logs"]').click()
  await expect(page).toHaveURL(/\/logs$/)
  await expect(page.locator('[data-aiui-shell-header]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-aiui-shell-header]')).toBeVisible()
  await expect(page.locator('[data-aiui-layout-frame]')).toHaveCount(0)
  // A preview never becomes the stored choice.
  expect(await page.evaluate(() => localStorage.getItem('aiui-layout'))).toBeNull()
})

test('the plugin layout loads only when picked, persists, and switching leaks nothing', async ({ page }) => {
  const errors = collectPageErrors(page)
  const scripts = trackScripts(page)
  await page.goto('/logs')
  await expect(frame(page, 'chat-canvas')).toBeVisible()
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  expect(scripts.filter((s) => s.includes('aurora'))).toEqual([])
  const before = await leakSnapshot(page)

  await runPaletteCommand(page, 'Switch layout: Aurora')
  await expect(frame(page, 'aurora')).toBeVisible()
  await expect(frame(page, 'aurora')).toHaveAttribute('data-active-layout', 'aurora')
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  expect(scripts.filter((s) => s.startsWith('/_plugins/layoutfx/'))).toEqual(['/_plugins/layoutfx/aurora.js'])
  expect(await page.evaluate(() => localStorage.getItem('aiui-layout'))).toBe('aurora')

  // Its nav drives the router; the page renders in its outlet.
  await page.locator('[data-aurora-link="chat"]').click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.locator('#aiui-main [data-aiui-page="chat"]')).toBeVisible()
  await page.locator('[data-aurora-link="logs"]').click()
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()

  // Back to the default: its chunks are cached, nothing new is fetched.
  const fetched = scripts.length
  await runPaletteCommand(page, 'Switch layout: Chat + Canvas')
  await expect(frame(page, 'chat-canvas')).toBeVisible()
  await expect(page.locator('#aiui-main [data-aiui-page="logs"]')).toBeVisible()
  expect(layoutGroups(scripts.slice(fetched))).toEqual([])
  const delta = leakDelta(before, await leakSnapshot(page))
  for (const key of ['ws', 'es', 'intervals', 'windowListeners'] as const) expect(delta[key] ?? 0, key).toBeLessThanOrEqual(0)

  // The choice persists across a reload, and is the viewer's own.
  await runPaletteCommand(page, 'Switch layout: Aurora')
  await expect(frame(page, 'aurora')).toBeVisible()
  await page.reload()
  await expect(frame(page, 'aurora')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('Settings → Appearance lists every offered layout and the classic frame', async ({ page }) => {
  await page.goto('/chat')
  await expect(frame(page, 'chat-canvas')).toBeVisible()
  await runPaletteCommand(page, 'Plugin settings')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Appearance', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Layout' }).click()
  for (const title of ['Chat + Canvas', 'Workbench', 'Aurora', 'Classic']) {
    await expect(page.getByRole('option', { name: title, exact: true })).toBeVisible()
  }
})

test('a frame that throws falls back to the classic frame with one toast and aiui:plugin-error', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/chat?layout=broken')
  await expect(page.locator('[data-aiui-shell-header]')).toBeVisible()
  await expect(page.locator('#aiui-main [data-aiui-page="chat"]')).toBeVisible()
  await expect(page.getByText('The “Broken” layout failed to load')).toHaveCount(1)
  const detail = await page.evaluate(() => (window as unknown as { __pluginErrors: { layout?: string; plugin?: string }[] }).__pluginErrors)
  expect(detail).toEqual([expect.objectContaining({ layout: 'broken', plugin: 'layoutfx' })])
  expect(errors.pageErrors).toEqual([])
})

test('phone: the frame moves its nav into a menu sheet; nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/logs')
  await expect(frame(page, 'chat-canvas')).toHaveAttribute('data-viewport', 'phone')
  expect(await hasHorizontalOverflow(page)).toBe(false)
  const menu = page.getByRole('button', { name: 'Open menu and chats' })
  const box = await menu.boundingBox()
  expect(box && box.width >= 44 && box.height >= 44).toBe(true)
  await menu.click()
  const sheet = page.locator('[data-aiui-phone-sheet]')
  await expect(sheet).toBeVisible()
  await sheet.locator('[data-aiui-nav-item="chat"]').click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(sheet).toBeHidden()
})
