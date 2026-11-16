/**
 * The React chat style (`style: chat`, what `aiui run app.py` serves): the
 * first reply in a new conversation stays on screen after the stream ends.
 * A new conversation gets its session id mid-stream; the end-of-stream reload
 * must use that id, not the null captured when the message was sent.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors } from './support'

const SYSTEM_URL = process.env.AIUI_E2E_CHAT_SYSTEM_URL || ''

test('the first reply of a new conversation stays after the stream ends', async ({ page }) => {
  expect(SYSTEM_URL, 'AIUI_E2E_CHAT_SYSTEM_URL (set by playwright.config.ts)').not.toBe('')
  const errors = collectPageErrors(page)
  await page.goto(`${SYSTEM_URL}/`)
  const box = page.getByPlaceholder('Type a message...')
  await expect(box).toBeVisible()

  const ended = page.waitForResponse((r) => r.url().endsWith('/run') && r.request().method() === 'POST')
  await box.fill('plain first reply')
  await box.press('Enter')
  await (await ended).finished()

  const reply = page.getByText('You said:', { exact: false })
  await expect(reply).toBeVisible()
  // The reply is the persisted message, not the stream, and it does not vanish.
  await page.waitForTimeout(1500)
  await expect(reply).toBeVisible()
  await expect(page.getByText('plain first reply').first()).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})
