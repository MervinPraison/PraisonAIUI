// Header link icons, the GitHub star count, footer socials and the banner on the built docs
// site: the YAML keys are added to /ui-config.json in flight; the GitHub API is stubbed.
import { expect, test, type Page } from '@playwright/test'
import { collectPageErrors, contrastRatio, hasHorizontalOverflow, setColorMode, toRgb } from './support'

const BANNER = { content: 'Version 2 is out. [Read the notes](/docs/guide/first)', dismissible: true, type: 'warning', id: 'v2notes' }

async function withChrome(page: Page, banner: Record<string, unknown> = BANNER) {
  await page.route('**/ui-config.json*', async (route) => {
    const response = await route.fetch()
    const config = await response.json()
    config.navbar = {
      links: [
        { label: 'Blog', href: 'https://example.com/blog', icon: 'newspaper' },
        { type: 'discord', href: 'https://discord.gg/acme' },
      ],
      primary: { type: 'github', href: 'https://github.com/acme/app' },
    }
    config.footer = {
      socials: { bluesky: 'https://bsky.app/profile/acme', community: 'https://discord.gg/acme', status: 'https://status.example.com' },
      links: [{ header: 'Company', items: [{ label: 'About', href: 'https://example.com/about' }] }],
    }
    config.banner = banner
    await route.fulfill({ response, json: config })
  })
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: { stargazers_count: 12345 } }))
}

test('the banner shows Markdown in its tone, and a dismissal lasts until the content changes', async ({ page }) => {
  const errors = collectPageErrors(page)
  await withChrome(page)
  await page.goto('/docs/guide/first')
  const banner = page.getByRole('region', { name: 'Announcement' })
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('link', { name: 'Read the notes' })).toHaveAttribute('href', '/docs/guide/first')
  // Above the header, at the top of the page.
  const [bannerBox, headerBox] = [await banner.boundingBox(), await page.locator('.aiui-docs-header').boundingBox()]
  expect(bannerBox!.y).toBe(0)
  expect(headerBox!.y).toBeGreaterThanOrEqual(bannerBox!.height - 1)

  await banner.getByRole('button', { name: 'Dismiss announcement' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'First page', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Announcement' })).toHaveCount(0)

  await page.unrouteAll({ behavior: 'wait' })
  await withChrome(page, { ...BANNER, content: 'Version 3 is out.', id: 'v3' })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Announcement' })).toContainText('Version 3 is out.')
  await page.emulateMedia({ media: 'print' }) // a printed page leaves the banner out
  await expect(page.getByRole('region', { name: 'Announcement' })).toBeHidden()
  expect(errors.pageErrors).toEqual([])
})

test('banner text reads in light and dark for every tone', async ({ page }) => {
  for (const [mode, type] of ['light', 'dark'].flatMap((m) => ['info', 'warning', 'success'].map((t) => [m, t] as const))) {
    await page.unrouteAll({ behavior: 'wait' })
    await setColorMode(page, mode as 'light' | 'dark')
    await withChrome(page, { content: 'Heads up', type, id: `${mode}-${type}` })
    await page.goto('/docs/guide/first')
    const banner = page.locator(`.aiui-docs-banner[data-type="${type}"]`)
    const [fg, bg] = await banner.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])
    expect(contrastRatio(await toRgb(page, fg), await toRgb(page, bg)), `${mode} ${type}`).toBeGreaterThanOrEqual(4.5)
  }
})

test('phone: navbar links and the GitHub button move into the drawer; nothing scrolls sideways', async ({ page }) => {
  await withChrome(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/guide/first')
  await expect(page.getByRole('region', { name: 'Announcement' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Site' })).toBeHidden()
  expect(await hasHorizontalOverflow(page)).toBe(false)
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('link', { name: 'Blog' })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Discord' })).toBeVisible()
  await expect(drawer.getByRole('link', { name: /GitHub/ })).toContainText('12.3k')
})

test('desktop: header link icons, a typed link as its mark, stars; footer socials named for their network', async ({ page }) => {
  await withChrome(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/docs/guide/first')
  const site = page.getByRole('navigation', { name: 'Site' })
  await expect(site.getByRole('link', { name: 'Blog' }).locator('svg.aiui-docs-linkicon')).toHaveCount(1)
  await expect(site.getByRole('link', { name: 'Discord' })).toHaveAttribute('target', '_blank')
  await expect(site.getByRole('link', { name: 'Discord' }).locator('svg path')).toHaveCount(1)
  await expect(page.locator('.aiui-docs-header .aiui-docs-cta')).toHaveAccessibleName(/GitHub.*12\.3k stars/)

  const socials = page.getByRole('list', { name: 'Social links' })
  await socials.scrollIntoViewIfNeeded()
  await expect(socials.getByRole('link', { name: 'Bluesky' }).locator('svg path')).toHaveCount(1)
  await expect(socials.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', 'https://discord.gg/acme')
  await expect(socials.getByRole('link', { name: 'status' }).locator('svg')).toHaveCount(1) // unknown key: a globe
  await expect(page.locator('.aiui-docs-footer-col h2')).toHaveText('Company')
})
