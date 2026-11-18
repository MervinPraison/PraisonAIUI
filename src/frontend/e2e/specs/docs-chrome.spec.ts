/**
 * The docs style's chrome on a built site (`aiui build` + `aiui serve`,
 * fixtures/docs-site): Pro tokens, sidebar, page source fixes, "On this
 * page", previous / next, search, focus ring and the phone drawer.
 * DESIGN.md "Docs style" is the contract.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, contrastRatio, hasHorizontalOverflow, setColorMode, toRgb } from './support'

const PRO_INDIGO_LIGHT = '#4f46e5'

test('the docs site draws in the Pro tokens, light and dark', async ({ page }) => {
  const errors = collectPageErrors(page)
  await setColorMode(page, 'light')
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-aiui-tokens', 'pro')
  await expect(html).toHaveAttribute('data-aiui-docs', '')
  // The brand tile is the Pro accent (zinc, the default preset, maps to indigo).
  const tile = page.locator('.aiui-docs-header .aiui-docs-mark')
  const tileBg = await tile.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, tileBg)).toBe(await toRgb(page, PRO_INDIGO_LIGHT))
  const lightBg = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).backgroundColor)

  await setColorMode(page, 'dark')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
  const darkBg = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(darkBg).not.toBe(lightBg)
  expect(errors.pageErrors).toEqual([])
})

test('the docs site draws in self-hosted Geist (latin woff2, same origin)', async ({ page, baseURL }) => {
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  const family = await page.locator('.aiui-docs').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toMatch(/^"?Geist"?,/)
  const mono = await page.locator('#main-content [data-streamdown="inline-code"]').first().evaluate((el) => getComputedStyle(el).fontFamily)
  expect(mono).toMatch(/^"?Geist Mono"?,/)
  expect(await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('16px Geist') && document.fonts.check('13px "Geist Mono"')
  })).toBe(true)
  const geist = fonts.filter((url) => /geist/i.test(url))
  expect(geist.length).toBeGreaterThan(0)
  for (const url of geist) {
    expect(url.startsWith(baseURL!)).toBe(true)
    expect(url).toMatch(/\/assets\/geist(-mono)?-latin-wght-normal-[\w-]+\.woff2$/)
  }
})

test('sidebar, section, frontmatter, relative links and previous / next', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  const article = page.locator('#main-content article')
  await expect(article.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()

  // The active page is marked in the sidebar, and its section heads the article.
  const sidebar = page.locator('.aiui-docs-sidebar')
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText('First page')
  await expect(page.locator('.aiui-docs-eyebrow')).toHaveText(/guide/i)

  // Frontmatter is metadata, never text; relative links resolve against the page folder.
  await expect(article).not.toContainText('description:')
  await expect(article.getByRole('link', { name: 'second page' })).toHaveAttribute('href', '/docs/guide/second')
  // ../index.md is the docs home page, whose one URL is the site root.
  await expect(article.getByRole('link', { name: 'home page' })).toHaveAttribute('href', '/')
  await expect(article).not.toContainText('[blocked]')

  // Callouts carry their tone and a title.
  await expect(article.getByRole('note', { name: 'Good to know' })).toHaveAttribute('data-type', 'tip')

  // Previous / next, in sidebar order.
  const pager = page.getByRole('navigation', { name: 'Previous and next page' })
  await pager.getByRole('link', { name: /Next.*Second page/ }).click()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText('Second page')
  await expect(pager.getByRole('link', { name: /Previous.*First page/ })).toHaveAttribute('href', '/docs/guide/first')
  expect(errors.pageErrors).toEqual([])
})

test('"On this page" follows the reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await page.goto('/docs/guide/first')
  const toc = page.locator('.aiui-docs-toc nav[aria-label="On this page"]')
  await expect(toc.getByRole('link', { name: 'Setup' })).toHaveAttribute('aria-current', 'location')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(toc.getByRole('link', { name: 'Reference' })).toHaveAttribute('aria-current', 'location')
  await expect(toc.locator('[aria-current="location"]')).toHaveCount(1)
})

test('search finds a page by title (Ctrl+K)', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('button', { name: 'Search documentation' }).first()).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill('second')
  // The page itself first (a text match on another page may mention it too).
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName(/^Second page/)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  expect(errors.pageErrors).toEqual([])
})

test('search finds a section by its heading and opens the page there', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 480 })
  await page.goto('/docs/guide/second')
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await dialog.getByRole('combobox').fill('usage')
  const option = dialog.getByRole('option', { name: /Usage/ }).first()
  await expect(option).toBeVisible()
  await expect(option).toContainText('First page')
  await expect(option.locator('mark').first()).toHaveText(/usage/i)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/guide\/first#usage$/)
  const heading = page.getByRole('heading', { name: 'Usage', level: 2 })
  await expect(heading).toBeInViewport()
  await expect.poll(() => heading.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(160)
  expect(errors.pageErrors).toEqual([])
})

test('search finds words in a page\'s text, with the matching snippet', async ({ page }) => {
  await page.goto('/docs/guide/second')
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await dialog.getByRole('combobox').fill('tone icon')
  const option = dialog.getByRole('option').first()
  await expect(option).toContainText('Callouts carry a tone icon')
  await expect(option).toContainText('First page')
  await dialog.getByRole('combobox').fill('zzzz nothing')
  await expect(dialog.getByText('Nothing matches. Try fewer words.')).toBeVisible()
})

test('a deep link opens the page at its section', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  // A section with the rest of the page below it, so it can reach the top
  // whatever the platform's line heights (the last section may not).
  await page.goto('/docs/guide/first#usage')
  const heading = page.getByRole('heading', { name: 'Usage', level: 2 })
  await expect(heading).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect.poll(() => heading.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(160)
})

test('section headings carry a copy-link anchor', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto('/docs/guide/first')
  const heading = page.getByRole('heading', { name: 'Usage', level: 2 })
  await expect(heading).toBeVisible()
  // Located by class: its accessible name changes once the link is copied.
  const anchor = heading.locator('a.aiui-heading-anchor')
  await expect(anchor).toHaveAccessibleName('Copy link to Usage')
  await expect(anchor).toHaveAttribute('href', '#usage')
  // Hidden until the heading is hovered or the link focused; never in the TOC text.
  expect(await anchor.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await heading.hover()
  await expect.poll(() => anchor.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await expect(page.locator('.aiui-docs-toc').getByRole('link', { name: 'Usage', exact: true })).toBeVisible()
  await anchor.click()
  await expect(page).toHaveURL(/\/docs\/guide\/first#usage$/)
  await expect(anchor).toHaveAccessibleName('Link to Usage copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/docs\/guide\/first#usage$/)
})

test('page actions: copy the page as Markdown, view it, open it in an assistant', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto('/docs/guide/first')
  const actions = page.getByRole('group', { name: 'Page actions' })
  await expect(actions).toBeVisible()
  await actions.getByRole('button', { name: 'Copy page' }).click()
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('## Usage')
  expect(copied.startsWith('# First page\n\n> The first guide page.')).toBe(true)
  expect(copied).not.toContain('title: First page')

  await actions.getByRole('button', { name: 'More page actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: /View as Markdown/ })).toHaveAttribute('href', '/docs/guide/first.md')
  const md = encodeURIComponent(`${baseURL}/docs/guide/first.md`)
  const chatgpt = await menu.getByRole('menuitem', { name: /Open in ChatGPT/ }).getAttribute('href')
  expect(chatgpt!.startsWith(`https://chatgpt.com/?hints=search&q=Read%20${md}`)).toBe(true)
  await expect(menu.getByRole('menuitem', { name: /Open in Claude/ })).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=/)
  await expect(menu.getByRole('menuitem', { name: /Open in Claude/ })).toHaveAttribute('rel', 'noopener noreferrer')
  const res = await page.request.get('/docs/guide/first.md')
  expect(res.ok()).toBe(true)
  expect(await res.text()).toContain('[second page](/docs/guide/second.md)')
})

test('phone: page actions fit beside the section and the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/guide/first')
  const actions = page.getByRole('group', { name: 'Page actions' })
  await expect(actions).toBeVisible()
  const box = await actions.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('sidebar: a page with icon: in its frontmatter shows the glyph before its title', async ({ page }) => {
  await page.goto('/docs/guide/first')
  const nav = page.getByRole('navigation', { name: 'Documentation' })
  await expect(nav.getByRole('link', { name: 'First page' }).locator('.aiui-docs-navicon svg')).toHaveCount(1)
  await expect(nav.getByRole('link', { name: 'Second page' }).locator('.aiui-docs-navicon')).toHaveCount(0)
})

test('phone: the page head reads "Section › Page"; desktop shows the section only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/guide/first')
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(crumbs).toBeVisible()
  const current = crumbs.locator('[aria-current="page"]')
  await expect(current).toBeVisible()
  await expect(current).toHaveText('First page')
  await expect(crumbs).toContainText(/guide/i)
  const actions = page.getByRole('group', { name: 'Page actions' })
  const [c, a] = await Promise.all([crumbs.boundingBox(), actions.boundingBox()])
  expect(c!.x + c!.width).toBeLessThanOrEqual(a!.x) // the trail truncates before the actions
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(current).toBeHidden()
  await expect(crumbs).toBeVisible()
})

test('code blocks in an article have no 200px placeholder: the first frame lays them out at their real height', async ({ page }) => {
  await page.goto('/docs/markdown')
  const block = page.locator('#main-content article.aiui-doc [data-streamdown="code-block"]').first()
  await expect(block).toBeVisible()
  const style = await block.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { cv: cs.contentVisibility, cis: cs.containIntrinsicSize }
  })
  expect(style.cv).toBe('visible') // Streamdown's content-visibility: auto shifted everything below (CLS)
  expect(style.cis).toBe('none')
})

test('links and buttons show a 2px focus ring', async ({ page }) => {
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  const brand = page.locator('.aiui-docs-brand')
  await brand.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const ring = await brand.evaluate((el) => {
    const s = getComputedStyle(el)
    return { matches: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth }
  })
  expect(ring).toEqual({ matches: true, style: 'solid', width: '2px' })
})

test('phone: the drawer holds the nav and the page never scrolls sideways', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.locator('.aiui-docs-sidebar')).toBeHidden()
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[aria-current="page"]')).toHaveText('First page')
  await drawer.getByRole('link', { name: 'Second page' }).click()
  await expect(drawer).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/second$/)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  expect(errors.pageErrors).toEqual([])
})

test('the docs home has one URL: /docs and /docs/index move to /', async ({ page }) => {
  const errors = collectPageErrors(page)
  for (const path of ['/', '/docs', '/docs/', '/docs/index']) {
    await page.goto(path)
    await expect(page.locator('#main-content article').getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.locator('#main-content')).not.toContainText('Theme Configuration')
    // The sidebar's home entry links to the root.
    await expect(page.locator('.aiui-docs-sidebar a[aria-current="page"]')).toHaveAttribute('href', '/')
  }
  expect(errors.pageErrors).toEqual([])
})

test('a URL with no page shows "Page not found", never the config dump', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/no/such/page')
  const main = page.locator('#main-content')
  await expect(main.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible()
  await expect(main).toContainText('/docs/no/such/page')
  await expect(main).not.toContainText('Theme Configuration')
  await expect(main).not.toContainText('Available Presets')
  await expect(main.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  await expect(page).toHaveTitle(/Page not found/)
  await main.getByRole('button', { name: 'Search the docs' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('redirects: aiui serve answers 301 for exact and wildcard rules, keeping the query', async ({ page, request }) => {
  const exact = await request.get('/docs/start?x=1', { maxRedirects: 0 })
  expect(exact.status()).toBe(301)
  expect(exact.headers().location).toBe('/docs/guide/first?x=1')
  const errors = collectPageErrors(page)
  await page.goto('/docs/old-guide/second')
  expect(new URL(page.url()).pathname).toBe('/docs/guide/second')
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('a mistyped URL offers the closest page', async ({ page }) => {
  await page.goto('/docs/widgts')
  const similar = page.locator('#main-content').getByRole('navigation', { name: 'Similar pages' })
  await expect(similar.getByRole('link', { name: 'Widgets' })).toHaveAttribute('href', '/docs/widgets')
  await similar.getByRole('link', { name: 'Widgets' }).click()
  await expect(page.getByRole('heading', { name: 'Widgets', level: 1 })).toBeVisible()
})

test('preset paper: the Paper look, serif titles, self-hosted Paper fonts', async ({ page, baseURL }) => {
  const errors = collectPageErrors(page)
  // The fixture site is zinc; the reader's ui-config.json says paper.
  await page.route('**/ui-config.json', async (route) => {
    const res = await route.fetch()
    const json = await res.json()
    json.site.theme = { ...(json.site.theme ?? {}), preset: 'paper' }
    await route.fulfill({ response: res, json })
  })
  const fonts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url())
  })
  await setColorMode(page, 'light')
  await page.goto('/docs/markdown')
  const h1 = page.getByRole('heading', { name: 'Markdown sample', level: 1 })
  await expect(h1).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-aiui-look', 'paper')

  expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Newsreader"?,/)
  const body = page.locator('.aiui-docs')
  expect(await body.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Source Sans 3"?,/)
  const article = page.locator('#main-content article.aiui-doc > .aiui-markdown')
  const type = await article.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight])
  expect(type[0]).toBe('17px')
  expect(parseFloat(type[1]) / 17).toBeCloseTo(1.7, 1)
  // Paper's page and navy accent, light then dark.
  const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, bg)).toBe(await toRgb(page, '#f6f3ec'))
  const tile = await page.locator('.aiui-docs-header .aiui-docs-mark').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, tile)).toBe(await toRgb(page, '#1f1c17'))
  const primary = await body.evaluate((el) => getComputedStyle(el).getPropertyValue('--primary').trim())
  expect(await toRgb(page, primary)).toBe(await toRgb(page, '#2d4f86'))
  await setColorMode(page, 'dark')
  await page.reload()
  await expect(h1).toBeVisible()
  const darkBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await toRgb(page, darkBg)).toBe(await toRgb(page, '#1a1814'))

  expect(await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('17px "Source Sans 3"') && document.fonts.check('40px Newsreader')
  })).toBe(true)
  const paper = fonts.filter((url) => /newsreader|source-sans|jetbrains/i.test(url))
  expect(paper.length).toBeGreaterThan(0)
  for (const url of paper) expect(url.startsWith(baseURL!)).toBe(true)
  expect(fonts.some((url) => /googleapis|gstatic/.test(url))).toBe(false)
  expect(errors.pageErrors).toEqual([])
})

test('phone: the page does not shift as the article and "On this page" arrive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number }
    w.__cls = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.locator('.aiui-docs-mtoc')).toBeVisible()
  await page.waitForTimeout(600)
  // The folded TOC is drawn from the first frame, not a frame after the article.
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01)
})

for (const mode of ['light', 'dark'] as const) {
  test(`code blocks (${mode}): file name, highlighted lines, AA comments, code groups`, async ({ page }) => {
    const errors = collectPageErrors(page)
    await setColorMode(page, mode)
    await page.goto('/docs/markdown')
    await expect(page.getByRole('heading', { name: 'Code titles', level: 2 })).toBeVisible()

    // ```python title="app.py" {2}: the name in the header, line 2 tinted.
    const frame = page.locator('.aiui-code-frame[data-titled]').first()
    await frame.scrollIntoViewIfNeeded()
    await expect(frame.locator('.aiui-code-title')).toHaveText('app.py')
    const lines = frame.locator('[data-streamdown="code-block-body"] code > span')
    await expect(lines).toHaveCount(3)
    const bg = (i: number) => lines.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(1)).not.toBe(await bg(0))
    expect(await bg(2)).toBe(await bg(0))

    // Comments keep 4.5:1 on the code background.
    const comment = frame.locator('span[style*="#6A737D" i]').first()
    await expect(comment).toHaveText(/# a comment/)
    const fg = await comment.evaluate((el) => getComputedStyle(el).color)
    const codeBg = await frame.locator('[data-streamdown="code-block-body"]').evaluate((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
      }
      return 'rgb(255, 255, 255)'
    })
    expect(contrastRatio(await toRgb(page, fg), await toRgb(page, codeBg))).toBeGreaterThanOrEqual(4.5)

    // <CodeGroup>: one tab per fence, the copy button in the tab strip.
    const group = page.locator('.aiui-tabs').filter({ has: page.getByRole('tab', { name: 'uv' }) })
    await group.scrollIntoViewIfNeeded()
    await expect(group.getByRole('tab')).toHaveText(['pip', 'uv'])
    await expect(group.getByRole('tabpanel')).toContainText('pip install aiui')
    await group.getByRole('tab', { name: 'uv' }).click()
    await expect(group.getByRole('tabpanel', { includeHidden: false })).toContainText('uv pip install aiui')
    const copy = group.getByRole('button', { name: 'Copy Code' }).filter({ visible: true })
    await expect(copy).toBeVisible()
    const [strip, button] = await Promise.all([group.getByRole('tablist').boundingBox(), copy.boundingBox()])
    expect(button!.y).toBeGreaterThanOrEqual(strip!.y)
    expect(button!.y + button!.height).toBeLessThanOrEqual(strip!.y + strip!.height)
    expect(errors.pageErrors).toEqual([])
  })
}

test('components: callout, steps, cards, accordion, frame and image zoom', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Components', level: 2 })).toBeVisible()
  const article = page.locator('#main-content article')

  await expect(article.getByRole('note', { name: 'Component note' })).toHaveAttribute('data-type', 'note')

  const steps = article.locator('ol.aiui-steps > li.aiui-step')
  await expect(steps).toHaveCount(2)
  await expect(steps.nth(1).locator('.aiui-step-title')).toHaveText('Run')
  expect(await steps.nth(1).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('counter(aiui-step)')

  // A card with a page link is one link, resolved like a Markdown link; an external one opens a new tab.
  const card = article.getByRole('link', { name: /First page/ })
  await expect(card).toHaveAttribute('href', '/docs/guide/first')
  await expect(article.getByRole('link', { name: /Elsewhere/ })).toHaveAttribute('target', '_blank')
  expect(await article.locator('.aiui-cards').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2)

  const accordion = article.locator('details.aiui-admonition[data-type="accordion"]')
  await expect(accordion).not.toHaveAttribute('open', '')
  await accordion.locator('summary').click()
  await expect(accordion).toContainText('Hidden until opened.')

  await expect(article.locator('figure.aiui-frame figcaption')).toHaveText('A sample image.')
  const img = article.locator('figure.aiui-frame img')
  await expect(img).toHaveAttribute('role', 'button')
  await img.focus()
  await page.keyboard.press('Enter')
  const zoom = page.getByRole('dialog', { name: /A blue box with a diagonal line/ })
  await expect(zoom).toBeVisible()
  await expect(zoom.locator('img')).toHaveAttribute('src', /sample\.png$/)
  await page.keyboard.press('Escape')
  await expect(zoom).toBeHidden()
  await expect(img).toBeFocused()

  await card.click()
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('component tags anywhere: one line, inside a list, unknown tags, comments, {#id}', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/markdown#tags-anywhere')
  const heading = page.getByRole('heading', { name: 'Tags anywhere', level: 2 })
  await expect(heading).toHaveAttribute('id', 'tags-anywhere')
  const article = page.locator('#main-content article')
  await expect(article.locator('[data-type="tip"]')).toContainText('A one-line tip.')
  // The callout stays inside the first list item; the list keeps both items.
  const list = article.locator('ol').filter({ hasText: 'Install the package.' })
  await expect(list.locator(':scope > li')).toHaveCount(2)
  await expect(list.locator(':scope > li').first().locator('[data-type="warning"]')).toContainText('Inside the first step.')
  await expect(article).toContainText('Text inside an unknown component.')
  await expect(article.locator('pre', { hasText: 'Text inside an unknown component.' })).toHaveCount(0)
  await expect(article).not.toContainText('MDX comment')
  await expect(article).not.toContainText('{#')
  expect(errors.pageErrors).toEqual([])
})

test('phone: cards stack in one column and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Components', level: 2 })).toBeVisible()
  expect(await page.locator('.aiui-cards').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('page footer: was this page helpful, edit this page', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  const foot = page.locator('footer.aiui-docs-pagefoot')
  await expect(foot).toBeVisible()
  await expect(foot.getByRole('link', { name: 'Edit this page' })).toHaveAttribute('href', 'https://github.com/acme/site/edit/main/docs/guide/first.md')
  // Dates come from git and are left out in a shallow clone; when shown, they are a <time>.
  const time = foot.locator('time')
  if (await time.count()) await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/)

  await expect(foot.getByText('Was this page helpful?')).toBeVisible()
  await foot.getByRole('button', { name: 'No' }).click()
  const issue = foot.getByRole('link', { name: 'Tell us what was missing' })
  const href = new URL((await issue.getAttribute('href'))!)
  expect(href.origin + href.pathname).toBe('https://github.com/acme/site/issues/new')
  expect(href.searchParams.get('title')).toBe('Docs: First page')
  await expect(issue).toHaveAttribute('target', '_blank')
  await expect(foot.getByRole('status')).toContainText('Thanks.')

  await page.goto('/')
  await expect(page.locator('.aiui-docs-pagefoot')).toHaveCount(1) // the fixture home is a plain page
  expect(errors.pageErrors).toEqual([])
})
