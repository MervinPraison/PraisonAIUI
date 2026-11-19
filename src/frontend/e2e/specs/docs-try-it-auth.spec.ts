/**
 * Try it with authentication, a file upload and a streamed response
 * (fixtures/docs-site/openapi.yaml, the x-hidden "Upload a photo" operation):
 * the Authorization inputs (masked in the curl command, kept in this tab's
 * sessionStorage), a multipart file part and server-sent events shown as a list.
 * The API is mocked with page.route.
 */
import { expect, test, type Page, type Request } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const EVENTS = 'event: progress\ndata: {"done":50}\n\nevent: progress\ndata: {"done":100}\n\n'

async function mockApi(page: Page, sent: Request[]) {
  await page.route(/^https:\/\/api\.example\.test\//, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    sent.push(route.request())
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: EVENTS })
  })
}

async function openTryIt(page: Page) {
  await page.goto('/docs/api-reference/upload-photo')
  await page.locator('#main-content article .aiui-endpoint').getByRole('button', { name: 'Try it' }).click()
  const dialog = page.getByRole('dialog', { name: '/photos' })
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeVisible()
  return dialog
}

for (const mode of ['light', 'dark'] as const) {
  test(`Try it auth (${mode}): masked credentials, a file part, streamed events`, async ({ page }) => {
    const errors = collectPageErrors(page)
    const sent: Request[] = []
    await mockApi(page, sent)
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = await openTryIt(page)
    const request = dialog.getByRole('region', { name: 'Request' }).locator('pre')

    // The page lists the schemes; the form asks for the chosen one and masks it in curl.
    await expect(page.locator('#main-content article h2#authorization')).toHaveText(/Authorization/)
    await expect(dialog.getByLabel('Token')).toHaveAttribute('type', 'password')
    await dialog.getByLabel('Token').fill('secret-1')
    await expect(request).toContainText("--header 'Authorization: Bearer ********'")
    await expect(request).not.toContainText('secret-1')
    await dialog.getByRole('button', { name: 'Show values' }).click()
    await expect(request).toContainText("--header 'Authorization: Bearer secret-1'")
    await expect(dialog.getByLabel('Token')).toHaveAttribute('type', 'text')

    // A file for the multipart part.
    await dialog.getByLabel('photo').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from('png') })
    await expect(request).toContainText("--form 'photo=@cat.png'")

    await dialog.getByRole('button', { name: 'Send' }).click()
    const response = dialog.getByRole('region', { name: 'Response' })
    await expect(response.locator('.aiui-try-events li')).toHaveCount(2)
    await expect(response.locator('.aiui-try-events')).toContainText('"done": 100')
    expect(sent).toHaveLength(1)
    expect(sent[0].headers()['authorization']).toBe('Bearer secret-1')
    expect(sent[0].postDataBuffer()!.toString()).toContain('filename="cat.png"')

    // The other scheme: an API key in the query. The token stays for this tab only.
    await dialog.getByLabel('Authorization method').selectOption('key')
    await dialog.getByRole('textbox', { name: /^key/ }).fill('k-9')
    await expect(request).toContainText('/photos?key=k-9')
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('aiui-try-auth:')).length)).toBe(1)
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('aiui-try-auth')))).toBe(false)
    await page.keyboard.press('Escape')
    const again = await openTryIt(page)
    await expect(again.getByLabel('Token')).toHaveValue('secret-1')
    expect(errors.pageErrors).toEqual([])
  })
}

test('Try it auth at 390 px: no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const dialog = await openTryIt(page)
  await expect(dialog.getByLabel('Authorization method')).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})
