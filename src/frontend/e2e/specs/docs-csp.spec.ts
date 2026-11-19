/**
 * The Content-Security-Policy of a built docs site (compiler/csp.py): every
 * page carries it as a <meta> and `aiui serve` sends it as a header, and the
 * site runs under it with no violation: the theme and URL scripts (hashed),
 * code highlighting, KaTeX, a Mermaid diagram, search, a YouTube embed, Try it
 * sending to the spec's servers and a redirect stub.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

type Violation = { directive: string; blocked: string; sample: string }

/** Every `securitypolicyviolation` the page raises, from its first script on. */
async function watchViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const seen: Violation[] = []
    ;(window as unknown as { __csp: Violation[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample })
    })
  })
  const logged: Violation[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) logged.push({ directive: 'console', blocked: '', sample: m.text().slice(0, 300) })
  })
  return async () => [...logged, ...(await page.evaluate(() => (window as unknown as { __csp?: Violation[] }).__csp ?? []))]
}

test('the policy is in every page and in the serve header, and is strict', async ({ page }) => {
  const response = await page.goto('/docs/markdown')
  const header = response?.headers()['content-security-policy'] ?? ''
  expect(header).toContain("script-src 'self' 'sha256-")
  expect(header).toContain("object-src 'none'")
  expect(header).toContain("frame-ancestors 'self'")
  expect(header).not.toContain("'unsafe-eval'")
  expect(header).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(meta).toBe(header.replace("; frame-ancestors 'self'", ''))
})

test('the docs app runs under the policy with no violation', async ({ page }) => {
  const errors = collectPageErrors(page)
  const violations = await watchViolations(page)
  await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ body: '<p>player</p>', contentType: 'text/html' }))
  await page.route(/^https:\/\/(api|eu|us)\.example\.test\//, (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{"ok":true}' }))

  // Shiki, KaTeX and Mermaid (lazy chunks, inline styles, SVG <style>)
  await page.goto('/docs/markdown')
  const article = page.locator('#main-content article').first()
  await expect(article.locator('.katex').first()).toBeVisible()
  await article.getByRole('heading', { name: 'Diagram' }).scrollIntoViewIfNeeded()  // diagrams render in view
  await expect(article.locator('svg[aria-roledescription^="flowchart"]')).toContainText('Start', { timeout: 30_000 })
  await expect(article.locator('[data-streamdown="code-block"] span[style*="--shiki-dark"]').first()).toBeVisible()
  expect(await violations(), 'markdown').toEqual([])

  // Search (the index fetch and the dialog)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  // A YouTube embed plays from youtube-nocookie (frame-src)
  await page.goto('/docs/media')
  await page.locator('#main-content article').getByRole('button', { name: 'Play: Product tour' }).click()
  await expect(page.locator('.aiui-embed iframe')).toBeVisible()
  expect(await violations(), 'media').toEqual([])

  // Try it sends to the spec's servers (connect-src)
  await page.goto('/docs/api-reference/update-pet')
  await page.locator('#main-content article .aiui-endpoint').getByRole('button', { name: 'Try it' }).click()
  const dialog = page.getByRole('dialog', { name: '/pets/{petId}' })
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('region', { name: 'Response' }).locator('.aiui-try-code-pill')).toContainText('200')
  expect(await violations(), 'try it').toEqual([])

  // Other page types, and a redirect stub's inline script (hashed)
  for (const path of ['/docs/widgets', '/docs/api-fields', '/docs/changelog', '/docs/layout', '/docs/index']) {
    await page.goto(path)
    await expect(page.locator('#main-content article').first()).toBeVisible()
    expect(await violations(), path).toEqual([])
  }
  await page.goto('/docs/start.html')
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  await expect(page.locator('#main-content article').first()).toBeVisible()

  expect(await violations()).toEqual([])
  expect(errors.pageErrors).toEqual([])
})
