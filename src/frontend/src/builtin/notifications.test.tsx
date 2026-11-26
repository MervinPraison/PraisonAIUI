import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationBell } from '@/builtin/NotificationBell'
import {
  notificationsBuiltin,
  resetNotificationsPluginForTests,
} from '@/builtin/notifications'
import { createServerNotificationSource } from '@/builtin/notificationServerSource'
import { NotificationPanelBody } from '@/builtin/NotificationPanel'
import { sdkApi } from '@/sdk/install'
import type { ShellManifest } from '@/sdk/manifest'
import { notifications } from '@/sdk/notifications'
import { getSlot } from '@/sdk/registry'
import { getCommands, resetServicesForTests } from '@/sdk/services'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
}

beforeEach(() => {
  notifications.reset()
  resetNotificationsPluginForTests()
  resetServicesForTests()
})

test('NotificationBell renders accessible label, unread badge, 99+ cap, and polite live region', () => {
  const emptyHtml = renderToStaticMarkup(createElement(NotificationBell))
  assert.match(emptyHtml, /aria-label="Notifications"/)
  assert.match(emptyHtml, /aria-live="polite"/)
  assert.match(emptyHtml, /data-unread-count="0"/)

  notifications.push({ title: 'New message', type: 'info' })
  notifications.push({ title: 'Approval needed', type: 'warning' })
  const unreadHtml = renderToStaticMarkup(createElement(NotificationBell))
  assert.match(unreadHtml, /aria-label="Notifications, 2 unread"/)
  assert.match(unreadHtml, /data-unread-count="2"/)
  assert.match(unreadHtml, />2<\/span>/)

  // 99+ cap
  notifications.configure({ maxItems: 150 })
  for (let i = 0; i < 105; i += 1) notifications.push({ title: `Item ${i}` })
  const cappedHtml = renderToStaticMarkup(createElement(NotificationBell))
  assert.match(cappedHtml, />99\+<\/span>/)
})

test('NotificationPanelBody renders items, category pills, disambiguated controls, and empty state', () => {
  const emptyHtml = renderToStaticMarkup(createElement(NotificationPanelBody, { onClose: () => {} }))
  assert.match(emptyHtml, /You are all caught up/)

  notifications.push({
    title: 'Deploy finished',
    description: 'Release v0.3.181 is live',
    type: 'success',
    category: 'deploy',
    action: { label: 'View logs', page: 'logs' },
  })
  const html = renderToStaticMarkup(createElement(NotificationPanelBody, { onClose: () => {} }))
  assert.match(html, /Deploy finished/)
  assert.match(html, /Release v0\.3\.181 is live/)
  assert.match(html, /Mark all read/)
  assert.match(html, /View logs/)
  assert.match(html, /aria-label="Mark &quot;Deploy finished&quot; as read"/)
  assert.match(html, /aria-label="Dismiss &quot;Deploy finished&quot;"/)
  assert.match(html, />deploy<\/button>/)
})

test('createServerNotificationSource syncs, reconciles mutations, and stops quietly on 404', async () => {
  const calls: string[] = []
  const src = createServerNotificationSource(
    {
      async fetchJson<T>(url: string, opts?: { method?: string }): Promise<T> {
        calls.push(`${opts?.method ?? 'GET'} ${url}`)
        if (url === '/api/notifications' && !opts?.method) {
          return {
            notifications: [{ id: 'n-1', title: 'Server hello', type: 'info', createdAt: 1000, read: false }],
          } as T
        }
        return {} as T
      },
    },
    { EventSource: undefined, pollMs: 0 },
  )

  const dispose = notifications.registerSource('srv', src)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(notifications.get().items.length, 1)
  assert.equal(notifications.get().items[0].title, 'Server hello')

  notifications.markRead('n-1')
  notifications.remove('n-1')
  assert.ok(calls.includes('POST /api/notifications/n-1/read'))
  assert.ok(calls.includes('DELETE /api/notifications/n-1'))
  dispose()

  // 404 stops gracefully without throwing or sending follow-up mutations
  const calls404: string[] = []
  const src404 = createServerNotificationSource(
    {
      async fetchJson(url: string) {
        calls404.push(url)
        throw Object.assign(new Error('Not Found'), { status: 404 })
      },
    },
    { EventSource: undefined, pollMs: 0 },
  )
  const dispose404 = notifications.registerSource('srv404', src404)
  await new Promise((r) => setTimeout(r, 10))
  notifications.markAllRead()
  assert.deepEqual(calls404, ['/api/notifications'])
  dispose404()
})

test('notificationsBuiltin registers header:actions slot and command palette entries', () => {
  const manifest: ShellManifest = {
    sdk: 1,
    version: '0.0.0',
    style: 'app',
    site: {},
    layout: {},
    pages: [],
    blocks: [],
    toolRenderers: [],
    plugins: [],
    legacy: { customJs: null, viewsBase: '/plugins/views/' },
  }
  notificationsBuiltin.activate(sdkApi, { manifest, pageIds: [] })
  assert.ok(getSlot('header:actions'), 'registers bell into header:actions slot')
  const ids = getCommands().map((c) => c.id)
  assert.ok(ids.includes('notifications.open'))
  assert.ok(ids.includes('notifications.markAllRead'))
})
