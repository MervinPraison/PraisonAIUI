// The React Cron page (src/app-pages/cron) under a layout against the real schedules API.
// Runs in the `layouts-host` project (app shell, layouts on).
import { expect, test } from '@playwright/test'
import { collectPageErrors } from './support'

test('cron: empty, create, list, detail, run, toggle and delete', async ({ page, request }) => {
  for (const s of (await (await request.get('/api/schedules')).json()).schedules) await request.delete(`/api/schedules/${s.id}`)
  const errors = collectPageErrors(page)
  await page.goto('/cron?layout=chat-canvas')
  const root = page.locator('[data-aiui-page="cron"] [data-aiui-app-page="cron"]')
  await expect(root.getByRole('heading', { name: 'No scheduled jobs yet' })).toBeVisible()

  await root.getByRole('button', { name: 'New schedule' }).last().click()
  const form = page.getByRole('dialog', { name: 'New schedule' })
  await form.getByLabel('Name').fill('Morning briefing')
  await form.getByLabel('Prompt').fill('Summarise yesterday')
  await form.getByRole('combobox', { name: 'Repeat' }).click()
  await page.getByRole('option', { name: 'Custom (cron)' }).click()
  await form.getByLabel('Cron expression').fill('0 25 * * *')
  await expect(form.getByText('The hour field “25” is not valid.')).toBeVisible()
  await form.getByLabel('Cron expression').fill('30 8 * * 1-5')
  await expect(form.getByText('Weekdays at 08:30 UTC')).toBeVisible()
  await expect(form.getByText(/^Next runs, your time: /)).toBeVisible()
  await form.getByRole('button', { name: 'Create schedule' }).click()
  await expect(form).toBeHidden()

  const row = root.getByRole('row', { name: /Morning briefing/ })
  await expect(row).toContainText('Weekdays at 08:30 UTC')
  await expect(row).toContainText('30 8 * * 1-5')
  const detail = root.getByRole('complementary', { name: 'Morning briefing' })
  await expect(detail).toContainText('Summarise yesterday')

  await detail.getByRole('button', { name: 'Run now' }).click()
  await expect(detail.getByRole('region', { name: 'Recent runs' }).getByRole('listitem')).toHaveCount(1)
  await expect(detail).toContainText(/Runs\s*1/)

  await row.getByRole('switch', { name: 'Pause Morning briefing' }).click()
  await expect(row.getByRole('switch', { name: 'Enable Morning briefing' })).toHaveAttribute('aria-checked', 'false')
  await expect(row).toContainText('Paused')
  await expect.poll(async () => (await (await request.get('/api/schedules')).json()).schedules[0].enabled).toBe(false)

  await detail.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog', { name: 'Delete this schedule?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(root.getByRole('heading', { name: 'No scheduled jobs yet' })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})
