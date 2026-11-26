/**
 * Notification Center E2E: header bell icon, live unread badge, lazy popover
 * panel, All/Unread/category filtering, Mark all read, dismiss, and 390px
 * phone width in light and dark modes.
 */
import { expect, test } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow, setColorMode, type ColorMode } from './support'

for (const mode of ['light', 'dark'] as const satisfies readonly ColorMode[]) {
  test(`notification bell receives live items, filters, marks all read, and fits 390px (${mode})`, async ({ page, request }) => {
    await setColorMode(page, mode)
    const errors = collectPageErrors(page)

    // Start from a clean server notification store
    await request.delete('/api/notifications?include_pinned=true')

    await page.goto('/overview')
    const bell = page.locator('[data-aiui-notifications-bell]').first()
    await expect(bell).toBeVisible()
    await expect(bell).toHaveAttribute('data-unread-count', '0')

    // Push two notifications through the real REST endpoint (received live over SSE)
    const res1 = await request.post('/api/notifications', {
      data: {
        title: 'Deployment succeeded',
        description: 'Production build v1.4 is live',
        type: 'success',
        category: 'deploy',
        action: { label: 'View logs', page: 'logs' },
      },
    })
    expect(res1.status()).toBe(201)

    const res2 = await request.post('/api/notifications', {
      data: {
        title: 'Agent finished report',
        description: 'Weekly summary is ready',
        type: 'info',
        category: 'chat',
      },
    })
    expect(res2.status()).toBe(201)

    // Unread count updates live on the bell trigger
    await expect(bell).toHaveAttribute('data-unread-count', '2', { timeout: 10_000 })
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread')

    // Open popover lazily and verify content
    await bell.click()
    const panel = page.locator('[data-aiui-notifications-panel]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Deployment succeeded')).toBeVisible()
    await expect(panel.getByText('Agent finished report')).toBeVisible()

    // Filter by category pill
    await panel.getByRole('button', { name: 'deploy', exact: true }).click()
    await expect(panel.getByText('Deployment succeeded')).toBeVisible()
    await expect(panel.getByText('Agent finished report')).toHaveCount(0)

    // Back to All, then Mark all read
    await panel.getByRole('button', { name: 'All', exact: true }).click()
    await panel.getByRole('button', { name: 'Mark all notifications as read' }).click()
    await expect(bell).toHaveAttribute('data-unread-count', '0')

    // Unread filter now shows empty state
    await panel.getByRole('button', { name: 'Unread', exact: true }).click()
    await expect(panel.getByText('No unread notifications')).toBeVisible()

    // Dismiss via Escape and check 390px phone viewport
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/overview')
    await expect(page.locator('[data-aiui-notifications-bell]').first()).toBeVisible()
    await page.locator('[data-aiui-notifications-bell]').first().click()
    await expect(page.locator('[data-aiui-notifications-panel]')).toBeVisible()
    expect(await hasHorizontalOverflow(page)).toBe(false)

    // Cleanup server state
    await request.delete('/api/notifications?include_pinned=true')
    expect(errors.consoleErrors).toEqual([])
    expect(errors.pageErrors).toEqual([])
  })
}
