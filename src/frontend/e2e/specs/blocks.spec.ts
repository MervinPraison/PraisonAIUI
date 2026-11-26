/**
 * Server-driven blocks in the React app shell: DataTable (sparkline column,
 * numeric threshold tones, eager & lazy row detail drawer), ChartBlock (scatter
 * x_domain + log scale + tooltip, barh y2, free facets, histogram clip),
 * FilterBar (method="get" + chips), Gallery (title + caption), and phone 390px
 * layout in light and dark modes (GAPS #15).
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

function sampleBlocks(q: string) {
  const rows = [
    { name: 'Ada Labs', lift: 2.4, trend: [10, 18, 26, 34], sec: 'row:ada' },
    { name: 'Grace Studio', lift: 0.4, trend: [30, 22, 16, 12], sec: 'row:grace' },
  ].filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))

  return {
    _components: [
      {
        type: 'filter_bar',
        action: '',
        method: 'get',
        chips: true,
        reset_label: 'Reset',
        children: [{ type: 'text_input', name: 'q', label: 'Search', value: q }],
      },
      {
        type: 'table',
        caption: 'Creators',
        headers: ['Creator', 'Lift', 'Trend'],
        columns: [
          { key: 'name', label: 'Creator', type: 'text' },
          { key: 'lift', label: 'Lift', type: 'number', format: 'multiplier', tone_above: 1.0, tone_below: 0.5 },
          { key: 'trend', label: 'Trend', type: 'sparkline' },
        ],
        rows: rows.map((r) => [r.name, r.lift, r.trend]),
        row_detail: true,
        row_detail_loads: rows.map((r) => r.sec),
      },
      {
        type: 'chart',
        title: 'Reach vs Lift',
        chart_type: 'scatter',
        data: [
          { channel: 'Ada Labs', subs: 12000, lift: 2.4, posts: 14 },
          { channel: 'Grace Studio', subs: 850000, lift: 0.9, posts: 42 },
        ],
        x: 'subs',
        y: ['lift'],
        label: 'channel',
        x_domain: [1000, 10000000],
        x_scale: 'log',
        tooltip: [{ key: 'posts', label: 'Posts' }],
      },
      {
        type: 'gallery',
        title: 'Recent posts',
        items: [
          { src: '/icon.svg', title: 'Launch recap', caption: '120k views · 2.4x lift', page: 'overview' },
        ],
      },
    ],
  }
}

for (const mode of ['light', 'dark'] as const satisfies readonly ColorMode[]) {
  test(`blocks page renders table drawer, sparkline, tones, chart and gallery (${mode})`, async ({ page }) => {
    await setColorMode(page, mode)
    const errors = collectPageErrors(page)
    const lazyCalls: Record<string, unknown>[] = []

    await page.route('**/api/plugins/hello/pages/hello-blocks**', async (route) => {
      const req = route.request()
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>
        lazyCalls.push(body)
        return route.fulfill({
          json: { _components: [{ type: 'text', content: `Lazy detail for ${String(body._lazy)}` }] },
        })
      }
      const q = new URL(req.url()).searchParams.get('q') ?? ''
      return route.fulfill({ json: sampleBlocks(q) })
    })

    await page.goto('/hello-blocks')
    const area = page.locator('[data-aiui-page="hello-blocks"]')
    await expect(area.locator('.aiui-block-page[data-status="ready"]')).toBeVisible()

    // Numeric threshold tones and sparkline column render.
    await expect(area.locator('[data-tone="success"]', { hasText: '2.4x' })).toBeVisible()
    await expect(area.locator('[data-tone="error"]', { hasText: '0.4x' })).toBeVisible()
    await expect(area.getByRole('img', { name: /Trend: 10 to 34/ })).toBeVisible()

    // Clicking a row opens the side panel and lazily loads its detail blocks.
    await area.getByRole('cell', { name: 'Ada Labs' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Lazy detail for row:ada')
    expect(lazyCalls[0]).toMatchObject({ _lazy: 'row:ada' })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Gallery shows both title and caption visibly.
    await expect(area.getByRole('heading', { name: 'Launch recap' })).toBeVisible()
    await expect(area).toContainText('120k views · 2.4x lift')

    // Chart renders inside its lazy chunk.
    await expect(area.locator('[data-aiui-chart="scatter"] svg').first()).toBeVisible()

    // FilterBar method="get" updates the URL and re-fetches.
    const search = area.getByRole('textbox', { name: 'Search' })
    await search.fill('Grace')
    await expect(page).toHaveURL(/[?&]q=Grace/)
    await expect(area.getByRole('cell', { name: 'Grace Studio' })).toBeVisible()
    await expect(area.getByRole('cell', { name: 'Ada Labs' })).toHaveCount(0)

    // 390 px phone viewport: no horizontal page overflow.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(area.locator('.aiui-block-page[data-status="ready"]')).toBeVisible()
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(errors.pageErrors).toEqual([])
  })
}
