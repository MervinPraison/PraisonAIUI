/**
 * A built docs site behind auth (fixtures/docs-auth: `create_app(static_dir)`
 * with AUTH_ENFORCE, what `aiui run --config` serves). Page content (the .md
 * files, the search index) needs credentials; the pages themselves are the app
 * shell. A signed-in reader reads pages as on an open site; a signed-out
 * reader gets the sign-in prompt, never the content and never a broken page.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const KEY = 'e2e-docs-key' // fixtures/docs-auth/serve.py E2E_DOCS_KEY
const TOKEN_KEY = 'aiui_gateway_token' // src/lib/auth.ts TOKEN_STORAGE_KEY
const BODY = 'Some text for the setup section.' // fixtures/docs-site/docs/guide/first.md

async function signIn(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.sessionStorage.setItem(key, value),
    [TOKEN_KEY, KEY] as const,
  )
}

test('a signed-in reader reads a docs page, and its markdown goes out with the token', async ({ page }) => {
  const errors = collectPageErrors(page)
  await signIn(page)
  const md = page.waitForRequest((r) => r.url().endsWith('/docs/guide/first.md'))
  await page.goto('/docs/guide/first')
  expect(await (await md).headerValue('authorization')).toBe(`Bearer ${KEY}`)
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.getByText(BODY)).toBeVisible()
  await expect(page.getByText('Sign in to this server')).toHaveCount(0)

  // Moving to another page fetches it with the token too.
  await page.locator('aside a[data-nav-path][href="/docs/guide/second"]').first().click()
  await expect(page.getByRole('heading', { name: 'Second page', level: 1 })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('a signed-out reader gets the sign-in prompt, never the page content', async ({ page, request }) => {
  // The server never hands the content out without credentials.
  const html = await (await request.get('/docs/guide/first', { headers: { Accept: 'text/html' } })).text()
  expect(html).not.toContain(BODY)
  expect((await request.get('/docs/guide/first.md')).status()).toBe(401)
  expect((await request.get('/search-index.json')).status()).toBe(401)

  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'Sign in to this server' })).toBeVisible()
  await expect(page.getByText(BODY)).toHaveCount(0)

  // A wrong token is refused; the right one opens the page.
  const field = page.getByLabel('Access token')
  await field.fill('not-the-key')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toContainText('did not accept')
  await field.fill(KEY)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.getByText(BODY)).toBeVisible()
})
