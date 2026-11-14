/**
 * App shell sweep: every page the server lists in the shell manifest must
 * render in the React shell without errors and without leaving resources
 * behind (ADR-0001 §9, default-flip criterion 1).
 *
 * The sweep reads the page list from GET /api/shell/manifest, so it follows
 * whatever the server registers; it only looks at what a user can see.
 */
import { expect, test, type Page } from '@playwright/test'
import { installLeakProbe, leakDelta, leakDetail, leakSnapshot } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

interface ManifestPage {
  id: string
  title: string
  kind: string
}

/** A path no page owns: the shell shows "Page not found" and mounts no view. */
const NEUTRAL = '/e2e-neutral-page'
/** Pages for the light / dark / phone checks and the screenshots attached to the report. */
const KEY_PAGES = ['chat', 'overview', 'usage', 'logs', 'approvals', 'jobs']
/** Limit the sweep while debugging: AIUI_E2E_SWEEP_PAGES=chat,logs */
const ONLY = (process.env.AIUI_E2E_SWEEP_PAGES || '').split(',').filter(Boolean)

/**
 * Defects the sweep found that are fixed outside the test suite. Each entry is
 * a strict expectation: the test fails if a defect is still listed after it
 * has been fixed, so the lists cannot go stale.
 */
const KNOWN_LEAKS: Record<string, string> = {
  // plugins/views/chat.js cleanup() closes its socket with onclose still
  // attached; onclose reconnects 3 s later and that socket is never closed.
  // chat-canvas embeds that view (the /chat page itself is the React chat).
  'chat-canvas': 'views/chat.js reconnects its WebSocket after cleanup()',
}
const KNOWN_BROKEN_DEEP_LINKS: Record<string, string> = {
  // GET /agents and GET /sessions are JSON APIs that the server answers
  // before the page fallback, so reloading these pages shows raw JSON.
  agents: 'GET /agents returns the agent list (JSON) to a browser navigation',
  sessions: 'GET /sessions returns the session list (JSON) to a browser navigation',
}

async function manifestPages(page: Page): Promise<ManifestPage[]> {
  const res = await page.request.get('/api/shell/manifest')
  expect(res.ok(), `GET /api/shell/manifest -> ${res.status()}`).toBe(true)
  const manifest = await res.json()
  expect(manifest.style, 'the server must run the app shell (AIUI_SHELL=app)').toBe('app')
  const pages: ManifestPage[] = manifest.pages
  return pages.filter((p) => ONLY.length === 0 || ONLY.includes(p.id))
}

type PageState = { state: 'loading' | 'ready' | 'error'; detail: string }

/** What the page area shows right now, judged from the DOM only. */
async function pageState(page: Page, id: string): Promise<PageState> {
  return page.evaluate((pageId) => {
    const host = document.querySelector(`[data-aiui-page="${CSS.escape(pageId)}"]`) as HTMLElement | null
    if (!host) return { state: 'loading' as const, detail: 'page area not mounted' }
    if (host.querySelector('[data-aiui-skeleton]')) return { state: 'loading' as const, detail: 'skeleton' }
    // Views use data-status for their own rows too; only these values are page states.
    const statuses = [...host.querySelectorAll('[data-status]')]
      .map((el) => el.getAttribute('data-status') || '')
      .filter((v) => v === 'loading' || v === 'ready' || v === 'error')
    if (statuses.includes('error')) return { state: 'error' as const, detail: host.innerText.trim().slice(0, 200) }
    const alert = host.querySelector('[role="alert"]')
    if (alert && /failed to load|page not found/i.test(alert.textContent || '')) {
      return { state: 'error' as const, detail: (alert.textContent || '').trim().slice(0, 200) }
    }
    if (statuses.includes('loading')) return { state: 'loading' as const, detail: 'loading' }
    const hasContent =
      host.innerText.trim().length > 0 || !!host.querySelector('canvas, svg, iframe, img, input, textarea, button')
    return hasContent ? { state: 'ready' as const, detail: '' } : { state: 'loading' as const, detail: 'empty' }
  }, id)
}

/** Poll until the page is ready or failed; a page still loading after 20 s is returned as such. */
async function waitForPage(page: Page, id: string): Promise<PageState> {
  const deadline = Date.now() + 20_000
  let last = await pageState(page, id)
  while (last.state === 'loading' && Date.now() < deadline) {
    await page.waitForTimeout(100)
    last = await pageState(page, id)
  }
  return last
}

async function expectNeutral(page: Page) {
  await expect(page.locator('[data-aiui-shell-root]')).toBeVisible()
  await expect(page.getByText('Page not found')).toBeVisible()
}

/**
 * Leave the current view (browser Back to the neutral page) and let anything
 * it scheduled run: the fake clock jumps 6 s, so a "reconnect in 3 s" timer
 * fires now instead of during a later page's measurement.
 */
async function leaveAndSettle(page: Page) {
  await page.goBack()
  await expectNeutral(page)
  await page.clock.fastForward(6_000)
  await page.waitForTimeout(250)
}

const CONNECTIONS = ['ws', 'es'] as const

test('every manifest page renders with no errors and no leaks', async ({ page }, testInfo) => {
  const pages = await manifestPages(page)
  expect(pages.length, 'pages to sweep').toBeGreaterThan(0)
  test.setTimeout(60_000 + pages.length * 20_000)
  // Order matters: the probe must wrap the clock's timers, not be replaced by them.
  await page.clock.install()
  await page.addInitScript(installLeakProbe)
  const errors = collectPageErrors(page)

  await page.goto(NEUTRAL)
  await expectNeutral(page)
  // Let the shell finish booting (its own listeners and streams) before the first count.
  await page.waitForLoadState('networkidle')
  await page.clock.fastForward(6_000)
  await page.waitForTimeout(500)

  const failures: string[] = []
  const rows: Record<string, unknown>[] = []
  const stillListed = new Set(Object.keys(KNOWN_LEAKS).filter((id) => pages.some((p) => p.id === id)))

  let before = await leakSnapshot(page)
  for (const { id, kind } of pages) {
    const errorsBefore = errors.pageErrors.length
    const link = page.locator(`[data-aiui-shell-sidebar] a[data-page-id="${id}"]`)
    if ((await link.count()) !== 1) {
      failures.push(`${id}: no sidebar link`)
      continue
    }

    // First visit: the page must render. What it leaves behind once (a loaded
    // library's own listeners, a measuring node) is recorded, not failed,
    // except connections: nothing may keep a socket open after it is left.
    await link.scrollIntoViewIfNeeded()
    await link.click()
    const state = await waitForPage(page, id)
    await page.waitForTimeout(150)
    await leaveAndSettle(page)
    const afterFirst = await leakSnapshot(page)
    const firstVisit = leakDelta(before, afterFirst)

    // Second visit: everything one-off is loaded now, so any growth is a leak per visit.
    await link.click()
    await waitForPage(page, id)
    await page.waitForTimeout(150)
    await leaveAndSettle(page)
    const afterSecond = await leakSnapshot(page)
    const perVisit = leakDelta(afterFirst, afterSecond)
    before = afterSecond

    const pageErrors = errors.pageErrors.slice(errorsBefore)
    rows.push({ id, kind, state: state.state, pageErrors: pageErrors.length, firstVisit, perVisit })
    if (state.state !== 'ready') failures.push(`${id}: ${state.state} (${state.detail})`)
    if (pageErrors.length) failures.push(`${id}: page error: ${pageErrors[0]}`)

    const leaks: string[] = []
    if (CONNECTIONS.some((k) => (firstVisit[k] ?? 0) > 0)) {
      leaks.push(`left a connection open: ${JSON.stringify(firstVisit)}`)
    }
    if (Object.values(perVisit).some((n) => (n ?? 0) > 0)) {
      leaks.push(`leaks on every visit: ${JSON.stringify(perVisit)}`)
    }
    if (leaks.length && KNOWN_LEAKS[id]) {
      stillListed.delete(id)
      testInfo.annotations.push({ type: 'known-leak', description: `${id}: ${KNOWN_LEAKS[id]} (${leaks.join('; ')})` })
    } else if (leaks.length) {
      failures.push(`${id}: ${leaks.join('; ')} ${JSON.stringify(await leakDetail(page))}`)
    }
  }
  for (const id of stillListed) {
    failures.push(`${id}: no longer leaks. Remove it from KNOWN_LEAKS (${KNOWN_LEAKS[id]})`)
  }

  const ready = rows.filter((r) => r.state === 'ready').length
  console.log(`shell sweep: ${ready}/${pages.length} pages ready, ${errors.pageErrors.length} page errors`)
  for (const row of rows) {
    const residue = JSON.stringify({ firstVisit: row.firstVisit, perVisit: row.perVisit })
    if (residue !== '{"firstVisit":{},"perVisit":{}}') console.log(`  ${row.id}: ${residue}`)
  }
  await testInfo.attach('shell-sweep.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
  expect(failures, failures.join('\n')).toEqual([])
})

test('every page opens from its own URL (reload, bookmark)', async ({ page }, testInfo) => {
  const pages = await manifestPages(page)
  test.setTimeout(60_000 + pages.length * 10_000)
  const errors = collectPageErrors(page)
  const failures: string[] = []
  const stillListed = new Set(Object.keys(KNOWN_BROKEN_DEEP_LINKS).filter((id) => pages.some((p) => p.id === id)))
  for (const { id } of pages) {
    const response = await page.goto(`/${id}`)
    const isHtml = (response?.headers()['content-type'] || '').includes('text/html')
    const state = isHtml
      ? await waitForPage(page, id)
      : { state: 'error', detail: 'the server did not answer with the app' }
    if (state.state === 'ready') continue
    if (KNOWN_BROKEN_DEEP_LINKS[id]) {
      stillListed.delete(id)
      testInfo.annotations.push({ type: 'known-issue', description: `/${id}: ${KNOWN_BROKEN_DEEP_LINKS[id]}` })
    } else {
      failures.push(`/${id}: ${state.state} (${state.detail})`)
    }
  }
  for (const id of stillListed) {
    failures.push(`/${id} opens now. Remove it from KNOWN_BROKEN_DEEP_LINKS (${KNOWN_BROKEN_DEEP_LINKS[id]})`)
  }
  expect(failures, failures.join('\n')).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

for (const variant of [
  { name: 'light', mode: 'light', viewport: { width: 1280, height: 800 } },
  { name: 'dark', mode: 'dark', viewport: { width: 1280, height: 800 } },
  { name: 'phone', mode: 'light', viewport: { width: 390, height: 844 } },
] as const) {
  test(`key pages fit the viewport (${variant.name})`, async ({ page }, testInfo) => {
    const pages = await manifestPages(page)
    await page.setViewportSize(variant.viewport)
    await setColorMode(page, variant.mode)
    const errors = collectPageErrors(page)
    for (const id of KEY_PAGES.filter((k) => pages.some((p) => p.id === k))) {
      await page.goto(`/${id}`)
      const state = await waitForPage(page, id)
      expect(state.state, `/${id}: ${state.detail}`).toBe('ready')
      const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
      expect(dark, `/${id}: <html class="dark">`).toBe(variant.mode === 'dark')
      expect(await hasHorizontalOverflow(page), `/${id} scrolls sideways at ${variant.viewport.width}px`).toBe(false)
      // For owner review (attached to the HTML report), not compared.
      await testInfo.attach(`${id}-${variant.name}.png`, { body: await page.screenshot(), contentType: 'image/png' })
    }
    expect(errors.pageErrors).toEqual([])
  })
}

test('the command palette opens with the keyboard and navigates', async ({ page }) => {
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByRole('combobox', { name: 'Search pages and commands' })
  await expect(search).toBeVisible()
  // Only the shell's palette may open: the legacy dashboard has its own.
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await search.fill('Logs')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/logs$/)
  expect((await waitForPage(page, 'logs')).state).toBe('ready')
})

test('a new approval raises a toast that opens the approvals page, except on chat', async ({ page }) => {
  const errors = collectPageErrors(page)
  const created: string[] = []
  const requestApproval = async (toolName: string) => {
    const res = await page.request.post('/api/approvals', {
      data: { tool_name: toolName, risk_level: 'high', description: 'raised by the e2e suite' },
    })
    expect(res.status(), `POST /api/approvals -> ${res.status()}`).toBe(201)
    const entry = await res.json()
    expect(entry.status, 'the default policy leaves a new approval pending').toBe('pending')
    created.push(entry.id)
  }
  try {
    await page.goto('/overview')
    expect((await waitForPage(page, 'overview')).state).toBe('ready')

    // Chat shows approvals in its own thread, so no toast is raised there.
    await page.locator('[data-aiui-shell-sidebar] a[data-page-id="chat"]').click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
    await requestApproval('e2e_on_chat')
    await page.waitForTimeout(2_000)
    await expect(page.locator('[data-sonner-toast]', { hasText: 'e2e_on_chat' })).toHaveCount(0)

    await page.locator('[data-aiui-shell-sidebar] a[data-page-id="overview"]').click()
    expect((await waitForPage(page, 'overview')).state).toBe('ready')
    await requestApproval('e2e_deploy')
    const toast = page.locator('[data-sonner-toast]', { hasText: 'Approval needed: e2e_deploy' })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('high risk')
    await toast.getByRole('button', { name: 'Review' }).click()
    await expect(page).toHaveURL(/\/approvals$/)
    expect((await waitForPage(page, 'approvals')).state).toBe('ready')
    expect(errors.pageErrors).toEqual([])
  } finally {
    for (const id of created) await page.request.post(`/api/approvals/${id}/deny`, { data: {} })
  }
})
