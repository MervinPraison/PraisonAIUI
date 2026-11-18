// The API Reference page (src/app-pages/api-reference) against the server's
// own OpenAPI document. Runs in the `layouts-host` project (app shell).
import { expect, test } from '@playwright/test'
import { collectPageErrors } from './support'

test('api reference: lists the live routes, searches, and sends a request', async ({ page, request }) => {
  const doc = await (await request.get('/api/openapi.json')).json()
  expect(doc.openapi).toBe('3.1.0')
  const errors = collectPageErrors(page)
  await page.goto('/api-reference')
  const routes = page.getByRole('navigation', { name: 'Routes' })
  await expect(page.locator('#aiui-main').getByRole('heading', { name: "This server's API" })).toBeVisible()
  await expect(routes.getByRole('button', { name: /\/api\/openapi\.json/ })).toBeVisible()

  await routes.getByRole('searchbox', { name: 'Search routes' }).fill('get health ready')
  await expect(routes.getByRole('button')).toHaveCount(2) // /health/ready and /api/health/ready
  await routes.getByRole('button', { name: /\/api\/health\/ready/ }).click()
  await expect(page).toHaveURL(/[?&]op=get_api_health_ready/)
  const detail = page.getByRole('article', { name: 'GET /api/health/ready' })
  await expect(detail).toContainText('Public: no sign-in needed.')
  await detail.getByRole('button', { name: 'Send request' }).click()
  await expect(detail.getByRole('status')).toContainText(/^200/)

  // A path parameter is required before sending, and goes into the URL.
  await page.goto('/api-reference?op=get_v1_models_model_id')
  const model = page.getByRole('article', { name: 'GET /v1/models/{model_id}' })
  await expect(model.getByRole('button', { name: 'Send request' })).toBeDisabled()
  await model.getByRole('textbox').first().fill('gpt-4o-mini')
  await expect(model.getByRole('button', { name: 'Send request' })).toBeEnabled()
  expect(errors.pageErrors).toEqual([])
})
