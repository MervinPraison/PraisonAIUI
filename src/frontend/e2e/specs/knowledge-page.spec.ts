/**
 * The Knowledge page (app-pages/knowledge) under a layout, on the mock
 * server's in-memory store: empty → add text → upload a file → list →
 * detail → search (marked matches; relevance when the store scores) →
 * delete with a confirm; a failed read with Retry; the phone drill-in. Runs
 * in the `page-types` project and clears the store before each test.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow } from './support'

const ROOT = '[data-aiui-page="knowledge"] [data-aiui-app-page="knowledge"]'

async function open(page: Page) {
  await page.goto('/knowledge?layout=chat-canvas')
  await page.locator(ROOT).waitFor()
}

async function add(page: Page, what: 'Add text' | 'Upload files') {
  await page.getByRole('toolbar').getByRole('button', { name: 'Add knowledge' }).click()
  await page.getByRole('menuitem', { name: what }).click()
  return page.getByRole('dialog', { name: 'Add knowledge' })
}

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/knowledge')).ok()).toBe(true)
})

test('knowledge: empty → add text and a file → detail → search → delete', async ({ page }) => {
  const errors = collectPageErrors(page)
  await open(page)
  const root = page.locator(ROOT)
  await expect(root.getByText('No knowledge yet')).toBeVisible()
  const strip = root.getByRole('region', { name: 'Knowledge base summary' })
  await expect(strip).toContainText('In memory')
  await expect(strip).toContainText('Ready')
  await expect(root).not.toContainText('KnowledgeManager')

  for (const [title, text] of [['Refund policy', 'Customers get a full refund within 30 days of purchase.'], ['', 'Support hours are Monday to Friday.']]) {
    const dialog = await add(page, 'Add text')
    if (title) await dialog.getByRole('textbox', { name: /Title/ }).fill(title)
    await dialog.getByRole('textbox', { name: 'Text' }).fill(text)
    await dialog.getByRole('button', { name: 'Add knowledge' }).click()
    await expect(dialog).toHaveCount(0)
  }
  const dialog = await add(page, 'Upload files')
  await dialog.getByLabel('Choose files').setInputFiles({ name: 'shipping.md', mimeType: 'text/markdown', buffer: Buffer.from('# Shipping\nOrders ship in 2 days.') })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'shipping.md' })).toContainText('Added')
  await dialog.getByRole('button', { name: 'Done' }).click()

  const table = root.getByRole('table', { name: 'Knowledge' })
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await expect(table).toContainText('Markdown')
  await table.getByRole('row', { name: /Refund policy/ }).click()
  const detail = root.getByRole('complementary', { name: 'Refund policy' })
  await expect(detail).toContainText('full refund within 30 days')

  const box = root.getByRole('searchbox', { name: 'Search knowledge' })
  await box.fill('refund')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(table.locator('mark').first()).toHaveText(/refund/i)
  await expect(root).toContainText('1 result for “refund”')
  // A store that scores its hits gets a Relevance column.
  await page.route('**/api/knowledge/search', (route) => route.fulfill({ json: { results: [{ id: 'x1', text: 'Orders ship in 2 days.', score: 0.87 }], search_mode: 'vector' } }))
  await box.fill('delivery time')
  await expect(table.getByRole('columnheader', { name: 'Relevance' })).toBeVisible()
  await expect(table).toContainText('87%')
  await page.unroute('**/api/knowledge/search')
  await root.getByRole('button', { name: 'Clear search' }).click()
  await expect(table.locator('tbody tr')).toHaveCount(3)

  await table.getByRole('row', { name: /Refund policy/ }).click()
  await detail.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog', { name: 'Delete this knowledge?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await expect(table).not.toContainText('Refund policy')
  expect(errors.pageErrors).toEqual([])
})

test('knowledge: a failed read says so, and Retry reads again', async ({ page }) => {
  let fail = true
  await page.route('**/api/knowledge', (route) => (fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: 'store offline' } }) : route.fallback()))
  await open(page)
  const alert = page.locator(ROOT).getByRole('alert')
  await expect(alert).toContainText('store offline')
  fail = false
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator(ROOT).getByText('No knowledge yet')).toBeVisible()
})

test('knowledge on a phone: the detail replaces the list, Back returns to it', async ({ page, request }) => {
  await request.post('/api/knowledge', { data: { text: 'Support hours are Monday to Friday.', metadata: { title: 'Support hours' } } })
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const root = page.locator(ROOT)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  await root.getByRole('row', { name: /Support hours/ }).click()
  await expect(root.getByRole('table', { name: 'Knowledge' })).toBeHidden()
  await root.getByRole('button', { name: 'All knowledge' }).click()
  await expect(root.getByRole('table', { name: 'Knowledge' })).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('knowledge: an add the store did not save warns instead of "Knowledge added"', async ({ page }) => {
  const warning = 'Not saved to the vector store (offline). The entry is kept in memory and won\'t persist across restarts.'
  await page.route('**/api/knowledge', (route) => (route.request().method() === 'POST' ? route.fulfill({ json: { id: 'k1', persisted: false, warning } }) : route.fallback()))
  await open(page)
  const dialog = await add(page, 'Add text')
  await dialog.getByRole('textbox', { name: 'Text' }).fill('Support hours are Monday to Friday.')
  await dialog.getByRole('button', { name: 'Add knowledge' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(warning)).toBeVisible()
  await expect(page.getByText('Knowledge added')).toHaveCount(0)
})
