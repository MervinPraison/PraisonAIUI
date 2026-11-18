/**
 * Docs media on a built page (fixtures/docs-site/docs/media.md, docs/DocsMedia.tsx):
 * a YouTube <iframe> that loads nothing from YouTube until play is pressed, other
 * hosts as a link, <video autoPlay>, noZoom, light/dark images that follow the
 * site's toggle (not the system setting), and Copy / Download in the zoom dialog.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow } from './support'

/** The site set to `site`, the system to the other mode. */
async function siteMode(page: import('@playwright/test').Page, site: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: site === 'dark' ? 'light' : 'dark' })
  await page.addInitScript((m) => localStorage.setItem('aiui-theme-preference', m), site)
}

test('a YouTube embed waits for play, then plays from youtube-nocookie in a sandbox', async ({ page }) => {
  const errors = collectPageErrors(page)
  const thirdParty: string[] = []
  page.on('request', (r) => { if (/youtube|ytimg|tracker\.example/.test(r.url())) thirdParty.push(r.url()) })
  await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ body: '<p>player</p>', contentType: 'text/html' }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/docs/media')
  const article = page.locator('#main-content article').first()
  const play = article.getByRole('button', { name: 'Play: Product tour' })
  await expect(play).toBeVisible()
  await expect(article.locator('iframe')).toHaveCount(0)
  expect(thirdParty).toEqual([])
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await play.click()
  const frame = article.locator('.aiui-embed iframe')
  await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/)
  await expect(frame).toHaveAttribute('title', 'Product tour')

  // Another host is a link, never an iframe.
  await expect(article.getByRole('link', { name: 'Other site' })).toHaveAttribute('href', 'https://tracker.example.com/widget')
  expect(thirdParty.filter((u) => u.includes('tracker'))).toEqual([])

  const video = article.locator('video.aiui-video')
  await expect(video).toHaveAttribute('src', /\/docs\/videos\/loop\.mp4$/)
  expect(await video.evaluate((v: HTMLVideoElement) => [v.autoplay, v.muted, v.loop, v.playsInline])).toEqual([true, true, true, true])
  expect(errors.pageErrors).toEqual([])
})

for (const mode of ['light', 'dark'] as const) {
  test(`images follow the site's ${mode} mode, not the system's`, async ({ page }) => {
    await siteMode(page, mode)
    await page.goto('/docs/media')
    const article = page.locator('#main-content article').first()
    const other = mode === 'light' ? 'dark' : 'light'
    await expect(article.getByAltText(`${mode === 'light' ? 'Light' : 'Dark'} only`)).toBeVisible()
    await expect(article.getByAltText(`${other === 'light' ? 'Light' : 'Dark'} only`)).toBeHidden()
    await expect(article.getByAltText('Dark by suffix')).toBeVisible({ visible: mode === 'dark' })
    await expect.poll(() => article.getByAltText('Picture').evaluate((i: HTMLImageElement) => i.currentSrc)).toMatch(mode === 'dark' ? /\?dark$/ : /\?light$/)
  })
}

test('noZoom keeps an image out of zoom; the zoom dialog offers Copy and Download', async ({ page }) => {
  await siteMode(page, 'light')
  await page.goto('/docs/media')
  const article = page.locator('#main-content article').first()
  const light = article.getByAltText('Light only')
  await expect(light).toHaveAttribute('role', 'button')
  await expect(article.getByAltText('No zoom')).not.toHaveAttribute('role', 'button')
  await article.getByAltText('No zoom').click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await light.click()
  const zoom = page.getByRole('dialog', { name: 'Image: Light only' })
  await expect(zoom).toBeVisible()
  const download = page.waitForEvent('download')
  await zoom.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe('sample.png')
  await expect(zoom).toBeVisible() // the actions do not close it
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await zoom.getByRole('button', { name: 'Copy image' }).click()
  await expect(zoom.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain('image/png')
})
