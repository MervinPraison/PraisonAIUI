/**
 * The page actions menu (docs/PageActions.tsx) on the built fixture site, with
 * ui-config.json (`content.docs.pageActions`) and docs-nav.json (front matter
 * `pageActions`) replaced per test: the chosen actions in order, links of the
 * site's own, the Ctrl+C shortcut and "Listen to page".
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, withoutInlinedManifests } from './support'

async function withActions(page: Page, site?: unknown, first?: unknown) {
  if (site !== undefined) {
    await page.route('**/ui-config.json', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), pageActions: site } })
    })
  }
  if (first !== undefined) {
    await withoutInlinedManifests(page)
    await page.route('**/docs-nav.json', async (route) => {
      const response = await route.fetch()
      const nav = await response.json()
      const walk = (items: { path?: string; children?: unknown[] }[]): unknown[] =>
        items.map((i) => (i.path === '/docs/guide/first' ? { ...i, pageActions: first } : { ...i, children: i.children && walk(i.children as never) }))
      await route.fulfill({ response, json: { ...nav, items: walk(nav.items) } })
    })
  }
}

/** A stand-in for the browser's speech: records what it is asked to read. */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { spoken: string[]; speechState: string }
    w.spoken = []
    w.speechState = 'idle'
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (u: { text: string }) => { w.spoken.push(u.text); w.speechState = 'speaking' },
        cancel: () => { w.speechState = 'cancelled' },
        pause: () => { w.speechState = 'paused' },
        resume: () => { w.speechState = 'speaking' },
      },
    })
    ;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class { text: string; constructor(t: string) { this.text = t } }
  })
}

const actions = (page: Page) => page.getByRole('group', { name: 'Page actions' })

test('the site list picks and orders the actions; a link of its own gets the page filled in', async ({ page, baseURL }) => {
  const errors = collectPageErrors(page)
  await withActions(page, ['copy', 'perplexity', 'grok', { label: 'Ask support', href: 'https://support.acme.dev/new?page={url}&q={prompt}', icon: 'life-buoy' }])
  await page.goto('/docs/guide/first')
  await actions(page).getByRole('button', { name: 'More page actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText([/Copy page/, /Open in Perplexity/, /Open in Grok/, /Ask support/])
  const md = encodeURIComponent(`${baseURL}/docs/guide/first.md`)
  expect(await menu.getByRole('menuitem', { name: /Open in Perplexity/ }).getAttribute('href')).toMatch(new RegExp(`^https://www\\.perplexity\\.ai/search/new\\?q=Read%20${md.replace(/[.%]/g, '\\$&')}`))
  await expect(menu.getByRole('menuitem', { name: /Open in Grok/ })).toHaveAttribute('rel', 'noopener noreferrer')
  const own = menu.getByRole('menuitem', { name: /Ask support/ })
  const href = new URL((await own.getAttribute('href'))!)
  expect(href.searchParams.get('page')).toBe(`${baseURL}/docs/guide/first`)
  expect(href.searchParams.get('q')).toContain(`${baseURL}/docs/guide/first.md`)
  await expect(own).toHaveAttribute('target', '_blank')
  await expect(menu.getByRole('separator')).toHaveCount(2) // page | assistants | own links
  expect(errors.pageErrors).toEqual([])
})

test('front matter gives one page its own menu, or none', async ({ page }) => {
  await withActions(page, undefined, ['chatgpt', 'view'])
  await page.goto('/docs/guide/first')
  // No Copy page: the menu opens from a labelled button.
  await expect(actions(page).getByRole('button', { name: 'Copy page' })).toHaveCount(0)
  await actions(page).getByRole('button', { name: 'Page actions' }).click()
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([/Open in ChatGPT/, /View as Markdown/])
  await page.keyboard.press('Escape')
  // The next page keeps the site's menu.
  await page.goto('/docs/guide/second')
  await expect(actions(page).getByRole('button', { name: 'Copy page' })).toBeVisible()

  await page.unrouteAll()
  await withActions(page, undefined, false)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(actions(page)).toHaveCount(0)
})

test('Ctrl+C with nothing selected copies the page as Markdown; a selection copies as usual', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto('/docs/guide/first')
  const article = page.locator('#main-content article.aiui-doc')
  await expect(article.getByText('Some text for the setup section.')).toBeVisible()
  await page.evaluate(() => navigator.clipboard.writeText('before'))
  await article.locator('p', { hasText: 'Some text for the setup section.' }).evaluate((p) => window.getSelection()?.selectAllChildren(p))
  await page.keyboard.press('ControlOrMeta+c')
  // The browser's own copy of the selection; the page is not copied over it.
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Some text for the setup section.')
  await expect(actions(page).getByRole('status')).toHaveText('')

  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.keyboard.press('ControlOrMeta+c')
  await expect(actions(page).getByRole('status')).toHaveText('Page copied as Markdown')
  await expect(actions(page).getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# First page\n\n> The first guide page.')
})

test('Listen to page reads the article aloud (no code), with pause, resume and stop', async ({ page }) => {
  await fakeSpeech(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/markdown')
  await expect(page.getByRole('heading', { name: 'Markdown sample', level: 1 })).toBeVisible()
  await actions(page).getByRole('button', { name: 'More page actions' }).click()
  await page.getByRole('menuitem', { name: /Listen to page/ }).click()
  const pause = actions(page).getByRole('button', { name: 'Pause reading' })
  await expect(pause).toBeVisible()
  await expect(actions(page).getByRole('status')).toHaveText('Reading the page aloud')
  const spoken = await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)
  expect(spoken[0]).toBe('Markdown sample')
  expect(spoken.join(' ')).not.toContain('aiui serve --output')
  expect(spoken.every((s) => s.length <= 220)).toBe(true)
  const box = await actions(page).boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)

  await pause.click()
  expect(await page.evaluate(() => (window as unknown as { speechState: string }).speechState)).toBe('paused')
  await actions(page).getByRole('button', { name: 'Resume reading' }).click()
  await actions(page).getByRole('button', { name: 'Stop reading' }).click()
  await expect(actions(page).getByRole('button', { name: /reading/ })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { speechState: string }).speechState)).toBe('cancelled')
})

test('Listen to page is left out where the browser cannot speak', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Window.prototype as { speechSynthesis?: unknown }).speechSynthesis
    delete (window as Partial<Window> & { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
  })
  await page.goto('/docs/guide/first')
  await actions(page).getByRole('button', { name: 'More page actions' }).click()
  await expect(page.getByRole('menuitem', { name: /Download as PDF/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Listen to page/ })).toHaveCount(0)
})
