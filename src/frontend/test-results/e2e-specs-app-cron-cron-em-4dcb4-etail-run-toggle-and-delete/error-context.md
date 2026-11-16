# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/specs/app-cron.spec.ts >> cron: empty, create, list, detail, run, toggle and delete
- Location: e2e/specs/app-cron.spec.ts:6:1

# Error details

```
TypeError: apiRequestContext.get: Invalid URL
```

# Test source

```ts
  1  | // The React Cron page (src/app-pages/cron) under a layout against the real schedules API.
  2  | // Runs in the `layouts-host` project (app shell, layouts on).
  3  | import { expect, test } from '@playwright/test'
  4  | import { collectPageErrors } from './support'
  5  | 
  6  | test('cron: empty, create, list, detail, run, toggle and delete', async ({ page, request }) => {
> 7  |   for (const s of (await (await request.get('/api/schedules')).json()).schedules) await request.delete(`/api/schedules/${s.id}`)
     |                                         ^ TypeError: apiRequestContext.get: Invalid URL
  8  |   const errors = collectPageErrors(page)
  9  |   await page.goto('/cron?layout=chat-canvas')
  10 |   const root = page.locator('[data-aiui-page="cron"] [data-aiui-app-page="cron"]')
  11 |   await expect(root.getByRole('heading', { name: 'No scheduled jobs yet' })).toBeVisible()
  12 | 
  13 |   await root.getByRole('button', { name: 'New schedule' }).last().click()
  14 |   const form = page.getByRole('dialog', { name: 'New schedule' })
  15 |   await form.getByLabel('Name').fill('Morning briefing')
  16 |   await form.getByLabel('Prompt').fill('Summarise yesterday')
  17 |   await form.getByRole('combobox', { name: 'Repeat' }).click()
  18 |   await page.getByRole('option', { name: 'Custom (cron)' }).click()
  19 |   await form.getByLabel('Cron expression').fill('0 25 * * *')
  20 |   await expect(form.getByText('The hour field “25” is not valid.')).toBeVisible()
  21 |   await form.getByLabel('Cron expression').fill('30 8 * * 1-5')
  22 |   await expect(form.getByText('Weekdays at 08:30 UTC')).toBeVisible()
  23 |   await expect(form.getByText(/^Next runs, your time: /)).toBeVisible()
  24 |   await form.getByRole('button', { name: 'Create schedule' }).click()
  25 |   await expect(form).toBeHidden()
  26 | 
  27 |   const row = root.getByRole('row', { name: /Morning briefing/ })
  28 |   await expect(row).toContainText('Weekdays at 08:30 UTC')
  29 |   const detail = root.getByRole('complementary', { name: 'Morning briefing' })
  30 |   await expect(detail).toContainText('Summarise yesterday')
  31 |   await expect(detail).toContainText('30 8 * * 1-5')
  32 |   // Beside the panel the table fits: its switch is inside the list's visible box.
  33 |   const box = (await root.locator('.aiui-tpl-list-main').boundingBox())!
  34 |   const sw = (await row.getByRole('switch').boundingBox())!
  35 |   expect(sw.x + sw.width).toBeLessThanOrEqual(box.x + box.width)
  36 |   await detail.getByRole('button', { name: 'Close details' }).click()
  37 |   await expect(row).toContainText('30 8 * * 1-5')
  38 |   await row.click()
  39 | 
  40 |   await detail.getByRole('button', { name: 'Run now' }).click()
  41 |   await expect(detail.getByRole('region', { name: 'Recent runs' }).getByRole('listitem')).toHaveCount(1)
  42 |   await expect(detail).toContainText(/Runs\s*1/)
  43 | 
  44 |   await row.getByRole('switch', { name: 'Pause Morning briefing' }).click()
  45 |   await expect(row.getByRole('switch', { name: 'Enable Morning briefing' })).toHaveAttribute('aria-checked', 'false')
  46 |   await expect(row).toContainText('Paused')
  47 |   await expect.poll(async () => (await (await request.get('/api/schedules')).json()).schedules[0].enabled).toBe(false)
  48 | 
  49 |   await detail.getByRole('button', { name: 'Delete' }).click()
  50 |   await page.getByRole('dialog', { name: 'Delete this schedule?' }).getByRole('button', { name: 'Delete' }).click()
  51 |   await expect(root.getByRole('heading', { name: 'No scheduled jobs yet' })).toBeVisible()
  52 |   expect(errors.pageErrors).toEqual([])
  53 | })
  54 | 
```