/**
 * Ask AI (docs/AskAi.tsx) on the built fixture site. `aiui serve` answers
 * /api/docs/ask; here a route stands in for it (no model is ever called) and
 * ui-config.json gets starter questions. Covers the header button, ⌘I / Ctrl+I,
 * `?assistant=`, "Ask about this" on a selection, search's Ask AI row, cited
 * sections that open in the app, the no-model fallback and the 390 px sheet.
 */
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const SOURCES = [{ n: 1, title: 'First page', heading: 'Usage', path: '/docs/guide/first#usage', url: '/docs/guide/first#usage', snippet: 'Some text for the usage section.' }]

function sse(events: [string, unknown][]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/** Fake server: records each question and answers with `events`. */
async function fakeAssistant(page: Page, events: [string, unknown][]) {
  const asked: Record<string, unknown>[] = []
  await page.route('**/ui-config.json', async (route) => {
    const response = await route.fetch()
    const assistant = { url: '/api/docs/ask', ai: true, starters: ['How do I use it?'] }
    await route.fulfill({ response, json: { ...(await response.json()), assistant } })
  })
  await page.route('**/api/docs/ask', async (route) => {
    asked.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(events) })
  })
  return asked
}

const ANSWER: [string, unknown][] = [['sources', SOURCES], ['text', { text: 'Read the **usage** section ' }], ['text', { text: '[1].' }], ['done', {}]]
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Ask AI' })

test('the header button opens Ask AI; a starter is answered with a cited section that opens in the app', async ({ page }) => {
  const errors = collectPageErrors(page)
  const asked = await fakeAssistant(page, ANSWER)
  await page.goto('/docs/guide/second')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  await sheet(page).getByRole('button', { name: 'How do I use it?' }).click()
  const log = sheet(page).getByRole('log', { name: 'Answers' })
  await expect(log).toContainText('Read the usage section [1].')
  await expect(sheet(page).getByRole('list', { name: 'Sources' })).toContainText('First page › Usage')
  await expect(sheet(page).getByRole('button', { name: 'Copy answer' })).toBeVisible()
  expect(asked[0]).toMatchObject({ question: 'How do I use it?', page: '/docs/guide/second' })
  await log.getByRole('link', { name: '[1]' }).click()
  await expect(sheet(page)).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/first#usage$/)
  await expect(page.getByRole('heading', { level: 1, name: 'First page' })).toBeVisible()
  expect(errors).toEqual({ consoleErrors: [], pageErrors: [] })
})

test('a ?assistant= link asks at once and leaves the address bar clean; Ctrl+I reopens the conversation', async ({ page }) => {
  const asked = await fakeAssistant(page, ANSWER)
  await page.goto('/docs/guide/first?assistant=How%20do%20I%20start%3F')
  await expect(sheet(page).getByText('How do I start?')).toBeVisible()
  expect(asked).toHaveLength(1)
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toBeHidden()
  await page.keyboard.press('Control+i')
  await expect(sheet(page).getByText('How do I start?')).toBeVisible()
  expect(asked).toHaveLength(1)
})

test('"Ask about this" quotes the selected passage', async ({ page }) => {
  const asked = await fakeAssistant(page, ANSWER)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { level: 1, name: 'First page' })).toBeVisible()
  await page.getByText('Some text for the setup section.').selectText()
  await page.getByRole('button', { name: 'Ask about this' }).click()
  await expect(sheet(page).getByText('Some text for the setup section.')).toBeVisible()
  const field = sheet(page).getByRole('textbox', { name: 'Your question' })
  await expect(field).toBeFocused()
  await field.fill('What does this mean?')
  await field.press('Enter')
  await expect.poll(() => asked.length).toBe(1)
  expect(asked[0]).toMatchObject({ question: 'What does this mean?', context: 'Some text for the setup section.' })
})

test('search offers to ask the query', async ({ page }) => {
  const asked = await fakeAssistant(page, ANSWER)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { level: 1, name: 'First page' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog').getByRole('combobox').fill('install steps')
  await page.getByRole('option', { name: 'Ask AI: install steps' }).click()
  await expect(sheet(page).getByText('install steps')).toBeVisible()
  await expect.poll(() => asked[0]?.question).toBe('install steps')
})

test('when the model is unavailable the reader gets the matching sections; the sheet fits a 390 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await fakeAssistant(page, [['sources', SOURCES], ['unavailable', { message: 'AI answers are not set up on this site. These sections match your question.' }]])
  await page.goto('/docs/guide/first')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  const field = sheet(page).getByRole('textbox', { name: 'Your question' })
  await field.fill('usage')
  await sheet(page).getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(sheet(page).getByText('AI answers are not set up on this site.')).toBeVisible()
  await expect(sheet(page).getByRole('list', { name: 'Sources' })).toContainText('Some text for the usage section.')
  const box = await sheet(page).boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('a server with no model key shows no Ask AI', async ({ page }) => {
  await page.route('**/ui-config.json', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), assistant: { url: '/api/docs/ask', ai: false } } })
  })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { level: 1, name: 'First page' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0)
})
