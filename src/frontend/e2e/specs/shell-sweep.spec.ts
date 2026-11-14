/**
 * App shell sweep: every page the server lists in the shell manifest must
 * render in the React shell without errors and without leaving resources
 * behind (ADR-0001 §9, default-flip criterion 1).
 *
 * The sweep reads the page list from GET /api/shell/manifest, so it follows
 * whatever the server registers; it only looks at what a user can see.
 */
import { expect, test, type Page } from '@playwright/test'
import { installLeakProbe, leakDelta, leakDetail, leakSnapshot, type LeakDelta } from './leak-probe'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, sidebarLink } from './support'

interface ManifestPage {
  id: string
  title: string
  kind: string
  apiEndpoint?: string | null
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
// Pages that leak on leaving, each with the reason. Empty: an entry that stops
// leaking fails the sweep until it is removed here.
const KNOWN_LEAKS: Record<string, string> = {}
// Pages whose URL does not open the app when loaded directly, each with the
// reason. Empty: an entry that starts working fails the test until removed.
const KNOWN_BROKEN_DEEP_LINKS: Record<string, string> = {}
// Pages that render but whose own data endpoint answers an error (the page
// shows an error body, not its content), each with the reason. An entry that
// starts working fails the sweep until it is removed here.
const KNOWN_BROKEN_PAGES: Record<string, string> = {}
/**
 * What a page may leave behind after its FIRST visit, with the reason: a
 * library it loads once (its own window listeners, a measuring node) stays
 * loaded for the rest of the session. Anything above these numbers, or on a
 * page not listed, fails the sweep; so does a page listed here that leaves
 * nothing (remove it). Connections are never allowed. Growth on a second visit
 * is always a leak.
 */
const FIRST_VISIT_ALLOWANCE: Record<string, { allow: LeakDelta; reason: string }> = {
  chat: {
    allow: { windowListeners: 13, bodyChildren: 1 },
    reason:
      'the chat chunk loads once: its libraries register global pointer/mouse/touch/click listeners at module load, ' +
      "and react-textarea-autosize (the composer) keeps one hidden measuring <textarea> in <body>",
  },
  'chat-canvas': {
    allow: { windowListeners: 1 },
    reason: 'a one-time DOMContentLoaded listener from the canvas view module, registered when it is first imported',
  },
  'code-studio': {
    allow: { intervals: 1, windowListeners: 1, bodyChildren: 2 },
    reason:
      "Monaco (loaded once from its CDN): its own interval (L.cancelAndSet in editor.main.js), a 'message' listener, " +
      'and its .context-view and .monaco-aria-container nodes in <body>; code-studio clears its own interval on cleanup',
  },
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
    // A view that printed a raw server error body ({"error": "Not Found", ...}).
    const text = host.innerText.trim()
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const body = JSON.parse(text) as Record<string, unknown>
        if (body && typeof body === 'object' && 'error' in body) return { state: 'error' as const, detail: text.slice(0, 200) }
      } catch {
        /* not JSON: ordinary content */
      }
    }
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

  const brokenStillListed = new Set(Object.keys(KNOWN_BROKEN_PAGES).filter((id) => pages.some((p) => p.id === id)))
  const allowanceStillListed = new Set(Object.keys(FIRST_VISIT_ALLOWANCE).filter((id) => pages.some((p) => p.id === id)))
  const gutters: { id: string; left: number }[] = []
  // The page's own data endpoint answering 4xx/5xx while the page is on screen.
  let apiErrors: string[] = []
  let watchedEndpoint = ''
  page.on('response', (res) => {
    if (!watchedEndpoint || res.status() < 400) return
    try {
      if (new URL(res.url()).pathname === watchedEndpoint) apiErrors.push(`${res.status()} ${watchedEndpoint}`)
    } catch {
      /* not a URL */
    }
  })

  let before = await leakSnapshot(page)
  for (const { id, title, kind, apiEndpoint } of pages) {
    const errorsBefore = errors.pageErrors.length
    const link = await sidebarLink(page, id)
    if ((await link.count()) !== 1) {
      failures.push(`${id}: no sidebar link`)
      continue
    }

    // First visit: the page must render, its own endpoint must not fail, and
    // what it leaves behind once must be within its FIRST_VISIT_ALLOWANCE.
    await link.scrollIntoViewIfNeeded()
    apiErrors = []
    watchedEndpoint = apiEndpoint && apiEndpoint.startsWith('/') ? apiEndpoint.split('?')[0] : ''
    await link.click()
    let state = await waitForPage(page, id)
    await page.waitForTimeout(150)
    watchedEndpoint = ''
    if (state.state === 'ready' && apiErrors.length) state = { state: 'error', detail: `its data endpoint answered ${apiErrors[0]}` }
    // Legacy pages share the shell's gutter and title: their first visible
    // content box starts at the mount's left edge (no inner padding wrapper),
    // and no visible h1/h2 repeats the title the shell header already shows.
    const layout = await page.evaluate(
      ({ pageId, title }) => {
        const host = document.querySelector(`[data-aiui-page="${CSS.escape(pageId)}"] .aiui-legacy-host:not(.db-fill)`)
        const mount = host?.querySelector('.aiui-legacy-mount')
        if (!mount) return null
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect()
          if (r.width <= 2 || r.height <= 2) return false
          const s = getComputedStyle(el)
          return s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'fixed' && s.clip !== 'rect(0px, 0px, 0px, 0px)'
        }
        let left = Infinity
        let first = ''
        for (const el of mount.querySelectorAll('*')) {
          if (!visible(el)) continue
          const s = getComputedStyle(el)
          const boxed = parseFloat(s.borderLeftWidth) > 0 || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(s.backgroundColor)
          const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
          const x = el.getBoundingClientRect().left
          if ((boxed || text) && x < left) {
            left = x
            first = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`
          }
        }
        const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        const want = norm(title)
        const repeats = [...mount.querySelectorAll('h1, h2')]
          .filter((h) => visible(h) && want && norm(h.textContent || '').includes(want))
          .map((h) => (h.textContent || '').trim())
        return {
          mountLeft: Math.round(mount.getBoundingClientRect().left),
          contentLeft: Number.isFinite(left) ? Math.round(left) : null,
          first,
          repeats,
          headerShown: !!document.querySelector('[data-aiui-page-header="shown"]'),
        }
      },
      { pageId: id, title },
    )
    if (layout) {
      gutters.push({ id, left: layout.mountLeft })
      if (layout.contentLeft !== null && Math.abs(layout.contentLeft - layout.mountLeft) > 1) {
        failures.push(`${id}: content starts at x=${layout.contentLeft} (${layout.first}), not at the shell gutter x=${layout.mountLeft}`)
      }
      if (layout.headerShown && layout.repeats.length) {
        failures.push(`${id}: a visible heading repeats the header title "${title}": ${JSON.stringify(layout.repeats)}`)
      }
    }
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
    if (state.state !== 'ready' && KNOWN_BROKEN_PAGES[id]) {
      brokenStillListed.delete(id)
      testInfo.annotations.push({ type: 'known-broken', description: `${id}: ${KNOWN_BROKEN_PAGES[id]} (${state.detail})` })
    } else if (state.state !== 'ready') {
      failures.push(`${id}: ${state.state} (${state.detail})`)
    }
    if (pageErrors.length) failures.push(`${id}: page error: ${pageErrors[0]}`)

    const leaks: string[] = []
    if (CONNECTIONS.some((k) => (firstVisit[k] ?? 0) > 0)) {
      leaks.push(`left a connection open: ${JSON.stringify(firstVisit)}`)
    }
    const allowance = FIRST_VISIT_ALLOWANCE[id]
    const over = Object.entries(firstVisit).filter(
      ([k, n]) => !CONNECTIONS.includes(k as (typeof CONNECTIONS)[number]) && (n ?? 0) > ((allowance?.allow as Record<string, number> | undefined)?.[k] ?? 0),
    )
    if (over.length) {
      failures.push(
        `${id}: left more behind on its first visit than allowed: ${JSON.stringify(firstVisit)} (allowed ${JSON.stringify(allowance?.allow ?? {})}) ${JSON.stringify(await leakDetail(page))}`,
      )
    }
    if (allowance && Object.values(firstVisit).some((n) => (n ?? 0) > 0)) allowanceStillListed.delete(id)
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
  for (const id of brokenStillListed) {
    failures.push(`${id}: renders now. Remove it from KNOWN_BROKEN_PAGES (${KNOWN_BROKEN_PAGES[id]})`)
  }
  for (const id of allowanceStillListed) {
    failures.push(`${id}: leaves nothing behind now. Remove it from FIRST_VISIT_ALLOWANCE (${FIRST_VISIT_ALLOWANCE[id].reason})`)
  }
  const lefts = [...new Set(gutters.map((g) => g.left))]
  if (lefts.length > 1) failures.push(`legacy pages start at different x positions: ${JSON.stringify(gutters)}`)

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
  // A prefix outranks fuzzy matches (Knowledge used to win for "log").
  await search.fill('log')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/logs$/)
  expect((await waitForPage(page, 'logs')).state).toBe('ready')
})

test('closing the palette gives focus back: typing in the composer continues, navigating lands on main', async ({ page }) => {
  await page.goto('/chat')
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.click()
  await page.keyboard.type('draft ')
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByRole('combobox', { name: 'Search pages and commands' })
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
  await expect(composer).toBeFocused()
  await page.keyboard.type('continues')
  await expect(composer).toHaveValue('draft continues')

  // From a button: back on the button.
  const searchButton = page.getByRole('button', { name: 'Search pages and commands' }).first()
  await searchButton.click()
  await expect(search).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(searchButton).toBeFocused()

  // Choosing a page: focus starts on the new page's main region, not <body>.
  await page.keyboard.press('ControlOrMeta+k')
  await search.fill('logs')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/logs$/)
  await expect(page.locator('#aiui-main')).toBeFocused()
})

test('the palette chunk is warmed only after the routed page has loaded', async ({ page }) => {
  const events: string[] = []
  page.on('request', (r) => {
    if (/\/assets\/CommandPalette-[^/]+\.js$/.test(r.url())) events.push('palette requested')
  })
  page.on('requestfinished', (r) => {
    if (/\/assets\/ChatPage-[^/]+\.js$/.test(r.url())) events.push('chat page loaded')
  })
  await page.goto('/chat')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect.poll(() => events.includes('palette requested'), { timeout: 15_000 }).toBe(true)
  expect(events.indexOf('chat page loaded'), JSON.stringify(events)).toBeGreaterThanOrEqual(0)
  expect(events.indexOf('chat page loaded'), JSON.stringify(events)).toBeLessThan(events.indexOf('palette requested'))
})

test('the palette reopens with an empty query, and arrow keys wrap around the list', async ({ page }) => {
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  const search = page.getByRole('combobox', { name: 'Search pages and commands' })
  await page.keyboard.press('ControlOrMeta+k')
  await search.fill('log')
  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(search).toHaveValue('')

  const items = page.locator('[cmdk-item]')
  const selected = page.locator('[cmdk-item][data-selected="true"]')
  const first = await items.first().textContent()
  const last = await items.last().textContent()
  await expect(selected).toHaveText(first ?? '')
  await page.keyboard.press('ArrowUp')
  await expect(selected, 'ArrowUp on the first item wraps to the last').toHaveText(last ?? '')
  await page.keyboard.press('ArrowDown')
  await expect(selected, 'ArrowDown on the last item wraps to the first').toHaveText(first ?? '')
})

test('closing the mobile nav returns focus to the menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  const menu = page.getByRole('button', { name: 'Open navigation' })
  await menu.click()
  const sheet = page.locator('[data-aiui-mobile-nav]')
  await expect(sheet).toBeVisible()
  // Functional motion (DESIGN.md): the sheet slides in within 200 ms, not shadcn's 500 ms.
  const seconds = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(seconds, 'sheet open animation').toBeLessThanOrEqual(0.2)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(menu).toBeFocused()
  // Choosing a page in the sheet: focus lands on the new page's main region.
  await menu.click()
  await sheet.locator('a[data-page-id="logs"]').click()
  await expect(page).toHaveURL(/\/logs$/)
  await expect(sheet).toBeHidden()
  await expect(page.locator('#aiui-main')).toBeFocused()
})

test('legacy pages share the gutter and width of a React page', async ({ page }) => {
  /** Left edge and width of the page's first content box, and of its page area. */
  const measure = (id: string) =>
    page.evaluate((pageId) => {
      const area = document.querySelector(`[data-aiui-page="${CSS.escape(pageId)}"]`)
      if (!area) return null
      // The React page's body or the legacy view's mount: the box the page's content lives in.
      const body =
        area.querySelector('.aiui-legacy-mount') ??
        [...area.children].find((el) => !el.hasAttribute('data-aiui-slot') && el.getBoundingClientRect().height > 0)
      if (!body) return null
      const a = area.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      const s = getComputedStyle(area)
      // Where the first visible text or box inside it starts (an inner
      // padding wrapper moves this off the gutter, not the body itself).
      let content = Infinity
      for (const el of body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width <= 2 || r.height <= 2 || cs.visibility === 'hidden' || cs.position === 'fixed' || cs.position === 'absolute') continue
        const boxed = parseFloat(cs.borderLeftWidth) > 0 || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor)
        const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
        if (boxed || text) content = Math.min(content, r.left)
      }
      return {
        left: Math.round(b.left),
        width: Math.round(b.width),
        content: Number.isFinite(content) ? Math.round(content) : null,
        gutter: Math.round(a.left + parseFloat(s.paddingLeft)),
        measure: Math.round(a.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)),
      }
    }, id)

  await page.goto('/hello')
  await expect(page.locator('[data-aiui-page="hello"]')).toContainText(/hello/i)
  const react = await measure('hello')
  expect(react, 'the React page area').not.toBeNull()
  expect(react!.left, 'a React page starts at the shell gutter').toBe(react!.gutter)
  // Data pages use the full page width; forms (config, theme-picker) keep a reading measure.
  for (const id of ['logs', 'usage', 'channels', 'security', 'jobs']) {
    await page.goto(`/${id}`)
    expect((await waitForPage(page, id)).state, id).toBe('ready')
    const legacy = await measure(id)
    expect(legacy, `${id}: the legacy mount`).not.toBeNull()
    // Same page area as the React page, and the view's mount fills it: no
    // second gutter, no narrower max-width of its own.
    expect(legacy!.gutter, `${id}: page area`).toBe(react!.gutter)
    expect(legacy!.left, `${id}: gutter`).toBe(react!.gutter)
    expect(legacy!.width, `${id}: width`).toBe(react!.measure)
    expect(legacy!.content, `${id}: first content box`).toBe(react!.gutter)
  }
})

test('Escape dismisses the collapsed rail tooltip, for keyboard focus and for hover', async ({ page }) => {
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  const tip = page.locator('[data-aiui-nav-tip]')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const link = page.locator('[data-aiui-shell-sidebar] a[data-page-id="logs"]')
  await link.focus()
  await expect(tip).toHaveText('Logs')
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await expect(link, 'focus stays on the link').toBeFocused()
  await page.locator('[data-aiui-shell-sidebar] a[data-page-id="usage"]').hover()
  await expect(tip).toHaveText('Usage')
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
})

test('the collapsed rail shows a tooltip that never survives a collapse toggle', async ({ page }) => {
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  const tip = page.locator('[data-aiui-nav-tip]')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const link = page.locator('[data-aiui-shell-sidebar] a[data-page-id="logs"]')
  await link.focus()
  await expect(tip).toHaveText('Logs')
  // Toggle with the keyboard: focus stays on the link, so no blur clears the tip.
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  await expect(tip).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect(tip, 'a stale tooltip from before the toggle').toHaveCount(0)
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
    await (await sidebarLink(page, 'chat')).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
    await requestApproval('e2e_on_chat')
    await page.waitForTimeout(2_000)
    await expect(page.locator('[data-sonner-toast]', { hasText: 'e2e_on_chat' })).toHaveCount(0)

    await (await sidebarLink(page, 'overview')).click()
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

test('a page chunk that fails to load offline never reloads the tab, and Try again works once back online', async ({ page, context }) => {
  const navigations: string[] = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations.push(f.url())
  })
  await page.goto('/hello')
  await expect(page.locator('[data-aiui-page="hello"]')).toContainText(/hello/i)
  const loads = navigations.length
  // The legacy host chunk is not loaded yet on a React page: it is fetched on the first legacy page.
  await context.setOffline(true)
  await (await sidebarLink(page, 'sessions')).click()
  // The page's error boundary renders in place of the page area.
  const area = page.locator('#aiui-main')
  await expect(area.getByRole('alert')).toContainText('failed to load')
  await page.waitForTimeout(1500)
  expect(navigations.filter((u) => u.startsWith('chrome-error')), 'never the browser offline page').toEqual([])
  expect(navigations.slice(loads).every((u) => new URL(u).pathname === '/sessions'), JSON.stringify(navigations)).toBe(true)
  await expect(page.locator('[data-aiui-shell-root]')).toBeVisible()

  await context.setOffline(false)
  await area.getByRole('button', { name: 'Try again' }).click()
  expect((await waitForPage(page, 'sessions')).state).toBe('ready')
  // The failed load did not poison the chunk for other legacy pages.
  await (await sidebarLink(page, 'usage')).click()
  expect((await waitForPage(page, 'usage')).state).toBe('ready')
  expect(navigations.filter((u) => !u.startsWith('http')), 'no reload, no error page').toEqual([])
})

test('after a page chunk 404s, the next page of that kind loads once the chunk is back', async ({ page }) => {
  // The chunk 404s until it is "redeployed" (React's own render retry fails too).
  let broken = true
  await page.route(/\/assets\/LegacyViewHost-[^/]+\.js$/, (route) =>
    broken ? route.fulfill({ status: 404, body: 'gone' }) : route.continue(),
  )
  await page.goto('/hello')
  await expect(page.locator('[data-aiui-page="hello"]')).toContainText(/hello/i)
  await (await sidebarLink(page, 'sessions')).click()
  // The page's error boundary renders in place of the page area.
  const area = page.locator('#aiui-main')
  await expect(area.getByRole('alert')).toContainText('failed to load')
  broken = false
  // No Try again: simply opening another legacy page imports the chunk again.
  await (await sidebarLink(page, 'usage')).click()
  expect((await waitForPage(page, 'usage')).state).toBe('ready')
  await (await sidebarLink(page, 'sessions')).click()
  expect((await waitForPage(page, 'sessions')).state).toBe('ready')
})

test('a 5xx from /api/auth/status never covers the shell with the legacy onboarding wizard', async ({ page }) => {
  await page.route('**/api/auth/status', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }))
  await page.goto('/overview')
  expect((await waitForPage(page, 'overview')).state).toBe('ready')
  await page.goto('/chat')
  await expect(page.locator('[data-aiui-page="chat"]')).toBeVisible()
  await page.waitForTimeout(1_000)
  await expect(page.locator('#aiui-onboarding')).toHaveCount(0)
})

test('overview says when its data failed to load, with a retry', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    // Only the overview's own data sources fail; the shell itself keeps working.
    if (/^\/api\/(agents|sessions|approvals\/pending|usage|channels|gateway|features|traces|config\/runtime)/.test(path)) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    }
    return route.continue()
  })
  await page.goto('/overview')
  const area = page.locator('[data-aiui-page="overview"]')
  await expect(area.locator('[data-ov-error="banner"]')).toContainText('could not be loaded')
  await expect(area.locator('[data-ov-error="agents"]')).toContainText('Agents could not be loaded')
  await expect(area).not.toContainText('No agents registered yet')
})

