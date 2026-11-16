/**
 * The React Agents page (src/app-pages/agents) under the default layout,
 * against the real agents_crud API. Runs in the `app-pages` project (a server
 * of its own); tests run in order and each leaves no agent behind.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow } from './support'

test.describe.configure({ mode: 'serial' })

async function open(page: Page) {
  await page.goto('/agents?layout=chat-canvas')
  await page.locator('[data-aiui-page="agents"] [data-aiui-app-page="agents"]').waitFor()
}

const panel = (page: Page, name: string) => page.getByRole('complementary', { name })

test('empty state: one New agent action, no emoji, no legacy view', async ({ page }) => {
  const errors = collectPageErrors(page)
  await open(page)
  const area = page.locator('[data-aiui-page="agents"]')
  await expect(area.getByText('No agents yet')).toBeVisible()
  await expect(area.getByRole('button', { name: 'New agent' })).toHaveCount(1)
  await expect(area.locator('.aiui-legacy-host')).toHaveCount(0)
  expect(await area.innerText()).not.toMatch(/\p{Extended_Pictographic}/u)
  expect(errors.pageErrors).toEqual([])
})

test('create → detail → edit → delete', async ({ page }) => {
  const errors = collectPageErrors(page)
  await open(page)
  await page.getByRole('button', { name: 'New agent' }).click()
  const form = page.getByRole('form', { name: 'New agent' })
  await expect(form.getByLabel('Name')).toBeFocused()

  await form.getByRole('button', { name: 'Create agent' }).click()
  await expect(form.getByRole('alert')).toHaveText('Give the agent a name.')

  await form.getByLabel('Name').fill('Researcher')
  await form.getByLabel('Description').fill('Finds and summarises sources')
  await form.getByLabel('Model').click()
  await page.getByRole('option', { name: 'gpt-4o', exact: true }).click()
  await form.getByLabel('Instructions').fill('Cite every claim.')
  await form.getByRole('button', { name: 'Create agent' }).click()

  // The new agent is selected: its row and its detail panel.
  const detail = panel(page, 'Researcher')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('gpt-4o')
  await expect(detail).toContainText('Cite every claim.')
  const row = page.getByRole('table', { name: 'Agents' }).getByRole('row').filter({ hasText: 'Researcher' })
  await expect(row).toHaveAttribute('aria-selected', 'true')

  // Edit: the form is filled in; saving updates the row and the panel.
  await detail.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('form', { name: 'Edit agent' })
  await expect(edit.getByLabel('Name')).toHaveValue('Researcher')
  await edit.getByLabel('Name').fill('Lead researcher')
  await edit.getByLabel('Temperature').fill('0.3')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  const edited = panel(page, 'Lead researcher')
  await expect(edited).toContainText('0.3')
  expect((await (await page.request.get('/api/agents/definitions')).json()).agents.map((a: { name: string; temperature: number }) => [a.name, a.temperature])).toEqual([['Lead researcher', 0.3]])

  // Search filters the table.
  await page.getByRole('searchbox', { name: 'Search agents' }).fill('nothing like this')
  await expect(page.getByText('No agent matches these filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()

  // Delete asks first; Cancel keeps the agent, Delete removes it.
  await edited.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this agent?' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await edited.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No agents yet')).toBeVisible()
  expect((await (await page.request.get('/api/agents/definitions')).json()).count).toBe(0)
  expect(errors.pageErrors).toEqual([])
})

test('loading shows a skeleton; a failed read shows the error and Try again', async ({ page }) => {
  let fail = true
  let release = () => {}
  const held = new Promise<void>((r) => (release = r)) // the first read waits, so the skeleton shows
  await page.route('**/api/agents/definitions', async (route) => {
    await held
    if (fail) await route.fulfill({ status: 500, json: { error: 'Registry offline' } })
    else await route.continue()
  })
  await open(page)
  await expect(page.getByRole('status', { name: 'Loading agents' })).toBeVisible()
  await expect(page.locator('[data-aiui-page="agents"]')).not.toContainText('Loading…')
  release()
  const alert = page.locator('[data-aiui-page="agents"]').getByRole('alert')
  await expect(alert).toContainText('Agents could not be loaded')
  await expect(alert).toContainText('Registry offline')
  fail = false
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('No agents yet')).toBeVisible()
})

test('phone: the panel replaces the list, and Close goes back', async ({ page }) => {
  const { id } = await (await page.request.post('/api/agents/definitions', { data: { name: 'Writer', model: 'gpt-4o-mini' } })).json()
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    await page.locator(`tr[data-row-id="${id}"]`).click()
    const detail = panel(page, 'Writer')
    await expect(detail).toBeInViewport()
    await expect(page.getByRole('table', { name: 'Agents' })).toBeHidden()
    expect(await hasHorizontalOverflow(page)).toBe(false)
    await detail.getByRole('button', { name: 'Close details' }).click()
    await expect(page.getByRole('table', { name: 'Agents' })).toBeVisible()
    expect(await hasHorizontalOverflow(page)).toBe(false)
  } finally {
    await page.request.delete(`/api/agents/definitions/${id}`)
  }
})
