// Docs search on a built site (fixtures/docs-site/docs/search.md): body text,
// the ?q= deep link, and tab chips (header tabs injected into ui-config.json).
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

async function withTabs(page: Page) {
  await page.route('**/ui-config.json', async (route) => {
    const response = await route.fetch()
    const json = await response.json()
    json.navigation = {
      tabs: [
        { tab: 'Guides', groups: [{ group: 'Guide', prefix: 'guide' }] },
        { tab: 'Reference', groups: [{ group: 'Reference', pages: ['index', 'layout', 'markdown', 'api-fields', 'search'] }] },
      ],
    }
    json.search = { ...json.search, prompt: 'Ask the fixture docs' }
    await route.fulfill({ response, json })
  })
}

test('a word far into a section is found and opens the page at it', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  // A plural: the stem finds "quasar".
  await dialog.getByRole('combobox').fill('quasars')
  const option = dialog.getByRole('option').first()
  await expect(option).toContainText('Deep text')
  await expect(option).toContainText('the quasar word land here')
  await expect(option.locator('mark').first()).toHaveText('quasar')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/search#deep-text$/)
  expect(errors.pageErrors).toEqual([])
})

test('a ?q= link opens search prefilled; the address bar follows the field', async ({ page }) => {
  await page.goto('/docs/guide/first?q=quasar')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox')).toHaveValue('quasar')
  await expect(dialog.getByRole('option').first()).toContainText('Deep text')
  // Keywords match like a title.
  await dialog.getByRole('combobox').fill('lookup')
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName(/^Search fixture/)
  await expect(page).toHaveURL(/\/docs\/guide\/first\?q=lookup$/)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/docs\/guide\/first$/)
})

test('tab chips filter results; an empty tab offers every tab', async ({ page }) => {
  const errors = collectPageErrors(page)
  await withTabs(page)
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search documentation' }).first()).toContainText('Ask the fixture docs')
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Search documentation' })
  await expect(dialog.getByRole('combobox')).toHaveAttribute('placeholder', 'Ask the fixture docs')
  const chips = dialog.getByRole('group', { name: 'Filter by tab' })
  // The reader is in Guides, so search starts there.
  await expect(chips.getByRole('button', { name: 'Guides' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('combobox').fill('quasar')
  const widen = dialog.getByRole('option', { name: /Nothing in Guides\. Show 1 result in all tabs/ })
  await expect(widen).toBeVisible()
  await chips.getByRole('button', { name: 'Reference' }).click()
  await expect(chips.getByRole('button', { name: 'Reference' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('option').first()).toContainText('Deep text')
  // "usage" lives in Guides only.
  await dialog.getByRole('combobox').fill('usage')
  await expect(dialog.getByRole('option', { name: /Show \d+ results? in all tabs/ })).toBeVisible()
  await chips.getByRole('button', { name: 'All tabs' }).click()
  await expect(dialog.getByRole('option', { name: /Usage/ }).first()).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})
