/**
 * Try it on an endpoint page (fixtures/docs-site/openapi.yaml, one x-hidden
 * operation): the endpoint bar, the request form (lazy chunk) with servers,
 * variables, parameters and a prefilled body, the live curl command, sending
 * with fetch and the response. The API is mocked with page.route.
 */
import { expect, test, type Page, type Request } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode } from './support'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function mockApi(page: Page, sent: Request[]) {
  await page.route(/^https:\/\/(api|eu|us)\.example\.test\//, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    sent.push(route.request())
    return route.fulfill({ status: 201, headers: { ...CORS, 'access-control-expose-headers': 'x-request-id', 'content-type': 'application/json', 'x-request-id': 'r-1' }, body: '{"ok":true,"id":8}' })
  })
}

async function openTryIt(page: Page) {
  await page.goto('/docs/api-reference/update-pet')
  const bar = page.locator('#main-content article .aiui-endpoint')
  await expect(bar.locator('.aiui-endpoint-method')).toHaveText('POST')
  await expect(bar.locator('.aiui-endpoint-path')).toHaveText('/pets/{petId}')
  await bar.getByRole('button', { name: 'Try it' }).click()
  const dialog = page.getByRole('dialog', { name: '/pets/{petId}' })
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeVisible()
  return dialog
}

for (const mode of ['light', 'dark'] as const) {
  test(`Try it (${mode}): prefilled form, servers and variables, live curl, send and response`, async ({ page }) => {
    const errors = collectPageErrors(page)
    const sent: Request[] = []
    await mockApi(page, sent)
    await setColorMode(page, mode)
    await page.setViewportSize({ width: 1440, height: 900 })
    const dialog = await openTryIt(page)
    const request = dialog.getByRole('region', { name: 'Request' }).locator('pre')

    // Prefilled from the spec: the path example, x-default on a header, the body example.
    await expect(dialog.getByLabel('petId')).toHaveValue('7')
    await expect(dialog.getByLabel('X-Trace')).toHaveValue('t-1')
    await expect(dialog.getByLabel('Request body')).toHaveValue(/"name": "Rex"/)
    await expect(request).toContainText("--url 'https://api.example.test/v1/pets/7'")

    // The curl command follows the inputs: another server, its variable, a query value.
    await dialog.getByLabel('Server').selectOption({ label: 'Regional: https://{region}.example.test/v1' })
    await dialog.getByLabel('region').selectOption('us')
    await dialog.getByLabel('petId').fill('8')
    await dialog.getByLabel('verbose').selectOption('true')
    await expect(request).toContainText("--url 'https://us.example.test/v1/pets/8?verbose=true'")
    await expect(request).toContainText("--header 'X-Trace: t-1'")

    await dialog.getByRole('button', { name: 'Send' }).click()
    const response = dialog.getByRole('region', { name: 'Response' })
    await expect(response.locator('.aiui-try-code-pill')).toContainText('201')
    await expect(response.locator('pre')).toContainText('"id": 8')
    await response.getByText(/^Headers/).click()
    await expect(response).toContainText('x-request-id')
    expect(sent).toHaveLength(1)
    expect(sent[0].url()).toBe('https://us.example.test/v1/pets/8?verbose=true')
    expect(sent[0].headers()['x-trace']).toBe('t-1')
    expect(sent[0].postDataJSON()).toEqual({ name: 'Rex' })

    const tint = (l: typeof dialog) => l.evaluate((e) => getComputedStyle(e).backgroundColor)
    expect(await tint(response.locator('.aiui-try-code-pill'))).not.toBe(await tint(dialog)) // the success token

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(errors.pageErrors).toEqual([])
  })
}

test('Try it at 390 px: full screen, no sideways scroll; names an empty required field and an unreachable API', async ({ page }) => {
  await page.route(/example\.test/, (route) => route.abort())
  await page.setViewportSize({ width: 390, height: 844 })
  const dialog = await openTryIt(page)
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(380)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  await dialog.getByLabel('petId').fill('')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Fill in petId.')
  await dialog.getByLabel('petId').fill('7')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('alert')).toContainText('CORS')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
})
