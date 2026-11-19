// Tabs, tab menus, sidebar anchors and the dropdown switcher (docs/features/navigation.md)
// on the built fixture site, with docs-nav.json and ui-config.json replaced.
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors } from './support'

const NAV = {
  items: [
    { title: 'Guide', children: [{ title: 'First page', path: '/docs/guide/first' }, { title: 'Second page', path: '/docs/guide/second' }] },
    { title: 'Reference', children: [{ title: 'Markdown', path: '/docs/markdown' }] },
    { title: 'Search', children: [{ title: 'Search page', path: '/docs/search' }] },
    { title: 'Widgets', children: [{ title: 'Widgets page', path: '/docs/widgets' }] },
    { title: 'Layout', children: [{ title: 'Layout page', path: '/docs/layout' }] },
  ],
}

const NAVIGATION = {
  tabs: [
    { tab: 'Guides', icon: 'book-open', groups: [{ group: 'Guide' }] },
    { tab: 'API', menu: [
      { item: 'Reference', description: 'Every component', groups: [{ group: 'Reference' }] },
      { item: 'Search', groups: [{ group: 'Search' }] },
    ] },
    { tab: 'GitHub', href: 'https://github.com/example/site' },
  ],
  anchors: [
    { anchor: 'Community', icon: 'users', href: 'https://example.com/chat' },
    { anchor: 'Widgets', icon: 'blocks', groups: [{ group: 'Widgets' }] },
  ],
  dropdowns: [
    { dropdown: 'Docs', description: 'Guides and API', groups: [{ group: 'Guide' }] },
    { dropdown: 'Layouts', description: 'Page layouts', groups: [{ group: 'Layout' }] },
  ],
}

async function withNavigation(page: Page) {
  await page.route('**/docs-nav.json', (route) => route.fulfill({ json: NAV }))
  await page.route('**/ui-config.json', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), navigation: NAVIGATION } })
  })
}

const sidebar = (page: Page) => page.locator('.aiui-docs-sidebar')
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Documentation sections' })

test('a tab opens its first page, a menu tab lists its items, anchors and the switcher swap the sidebar', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await withNavigation(page)
  await page.goto('/docs/guide/second')
  await expect(tabs(page).getByRole('link', { name: 'Guides' })).toHaveAttribute('aria-current', 'true')
  await expect(sidebar(page).getByRole('link', { name: 'Markdown' })).toHaveCount(0)
  // A link-out tab opens a new tab.
  await expect(tabs(page).getByRole('link', { name: /GitHub/ })).toHaveAttribute('target', '_blank')

  // The API tab is a menu; an item opens its section's first page.
  await tabs(page).getByRole('button', { name: 'API' }).click()
  await expect(page.getByRole('menuitem', { name: /Reference/ })).toContainText('Every component')
  await page.getByRole('menuitem', { name: /Search/ }).click()
  await expect(page).toHaveURL(/\/docs\/search$/)
  await expect(tabs(page).getByRole('button', { name: 'API' })).toHaveAttribute('data-active', '')
  await expect(sidebar(page).getByRole('link', { name: 'Search page' })).toHaveAttribute('aria-current', 'page')

  // Anchors sit above the tree on every page: a link out, and one with its own sidebar.
  const anchors = sidebar(page).getByRole('navigation', { name: 'Anchors' })
  await expect(anchors.getByRole('link', { name: /Community/ })).toHaveAttribute('href', 'https://example.com/chat')
  await anchors.getByRole('link', { name: 'Widgets' }).click()
  await expect(page).toHaveURL(/\/docs\/widgets$/)
  await expect(anchors.getByRole('link', { name: 'Widgets' })).toHaveAttribute('aria-current', 'true')

  // The switcher names the open dropdown; picking another opens its first page.
  await page.goto('/docs/guide/first')
  const switcher = sidebar(page).locator('.aiui-docs-switcher')
  await expect(switcher).toContainText('Docs')
  await switcher.click()
  await page.getByRole('menuitem', { name: /Layouts/ }).click()
  await expect(page).toHaveURL(/\/docs\/layout$/)
  await expect(switcher).toContainText('Layouts')
  await expect(sidebar(page).getByRole('link', { name: 'Layout page' })).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('at 390 px the drawer holds the tabs, the open tab menu, the switcher and the anchors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withNavigation(page)
  await page.goto('/docs/markdown')
  await expect(tabs(page)).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const drawer = page.getByRole('dialog')
  const sections = drawer.getByRole('group', { name: 'Documentation sections' })
  await expect(sections.getByRole('link', { name: 'API' })).toHaveAttribute('aria-current', 'true')
  await expect(drawer.getByRole('navigation', { name: 'Section menu' }).getByRole('link', { name: 'Reference' })).toHaveAttribute('aria-current', 'true')
  // A tab in the drawer swaps the drawer's sidebar without leaving the page.
  await sections.getByRole('link', { name: 'Guides' }).click()
  await expect(drawer.getByRole('link', { name: 'First page' })).toBeVisible()
  await expect(page).toHaveURL(/\/docs\/markdown$/)
  await expect(drawer.getByRole('navigation', { name: 'Anchors' }).getByRole('link', { name: 'Widgets' })).toBeVisible()
  await expect(drawer.locator('.aiui-docs-switcher')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
