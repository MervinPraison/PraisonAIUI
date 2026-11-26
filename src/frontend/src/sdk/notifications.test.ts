import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRelativeTime } from '@/builtin/notificationTime'
import {
  isSafeNotificationHref,
  notifications,
  type NotificationSource,
} from '@/sdk/notifications'
import { notify } from '@/sdk/notify'

beforeEach(() => {
  notifications.reset()
})

test('push, deduplication, ring-buffer cap, and pinned preservation', () => {
  notifications.configure({ maxItems: 3 })
  const pinned = notifications.push({ title: 'Pinned', pinned: true, createdAt: 1000 })
  const oldRead = notifications.push({ title: 'Old read', read: true, createdAt: 2000 })
  const job = notifications.push({ title: 'Job queued', dedupeKey: 'job:1', createdAt: 3000 })
  assert.equal(notifications.unreadCount(), 2)

  // Dedupe updates in place without duplicating or inflating count
  const updated = notifications.push({ title: 'Job done', dedupeKey: 'job:1', type: 'success', createdAt: 3500 })
  assert.equal(updated.id, job.id)
  assert.equal(notifications.get().items.length, 3)
  assert.equal(notifications.get().items[0].title, 'Job done')

  // Overflow evicts oldest read unpinned item first
  notifications.push({ title: 'Newest', createdAt: 4000 })
  const ids = new Set(notifications.get().items.map((x) => x.id))
  assert.equal(ids.has(oldRead.id), false)
  assert.equal(ids.has(pinned.id), true)

  // Clear preserves pinned by default
  assert.equal(notifications.clear(), 2)
  assert.deepEqual(notifications.get().items.map((x) => x.id), [pinned.id])
  assert.equal(notifications.clear({ includePinned: true }), 1)
  assert.equal(notifications.get().items.length, 0)
})

test('markRead, markUnread, markAllRead idempotency, and remove', () => {
  const a = notifications.push({ title: 'One', createdAt: 1000 })
  const b = notifications.push({ title: 'Two', createdAt: 2000 })
  assert.equal(notifications.unreadCount(), 2)

  assert.equal(notifications.markRead(a.id), true)
  assert.equal(notifications.markRead(a.id), false, 'marking already-read returns false')
  assert.equal(notifications.unreadCount(), 1)

  assert.equal(notifications.markUnread(a.id), true)
  assert.equal(notifications.unreadCount(), 2)

  assert.equal(notifications.markAllRead(), 2)
  assert.equal(notifications.markAllRead(), 0, 'idempotent when already 0 unread')
  assert.equal(notifications.unreadCount(), 0)

  assert.equal(notifications.remove(b.id), true)
  assert.equal(notifications.remove('missing'), false)
  assert.equal(notifications.get().items.length, 1)
})

test('DRY bridge: notify() records in notifications by default and supports record:false', () => {
  void notify('Saved settings', { type: 'success', description: 'All changes applied', category: 'config' })
  assert.equal(notifications.get().items.length, 1)
  assert.equal(notifications.get().items[0].title, 'Saved settings')
  assert.equal(notifications.get().items[0].category, 'config')
  assert.equal(notifications.get().items[0].type, 'success')

  void notify('Transient hint', { record: false })
  assert.equal(notifications.get().items.length, 1, 'record:false skips the notification center')

  // push({ toast: true }) does not recurse infinitely
  notifications.push({ title: 'Alert', type: 'warning', toast: true })
  assert.equal(notifications.get().items.length, 2)
})

test('pluggable registerSource receives optimistic lifecycle callbacks and cleans up', () => {
  const events: string[] = []
  let disconnected = false
  const src: NotificationSource = {
    connect(ctx) {
      ctx.sync(
        [
          { id: 'srv-1', title: 'Server 1', createdAt: 1000 },
          { id: 'srv-2', title: 'Server 2', createdAt: 2000 },
        ],
        { source: 'server', replaceSource: true },
      )
      return () => {
        disconnected = true
      }
    },
    onMarkRead(id) {
      events.push(`read:${id}`)
    },
    onMarkAllRead() {
      events.push('read_all')
    },
    onRemove(id) {
      events.push(`remove:${id}`)
    },
    onClear() {
      events.push('clear')
    },
  }

  const dispose = notifications.registerSource('test-server', src)
  assert.equal(notifications.get().items.length, 2)
  notifications.markRead('srv-1')
  notifications.markAllRead()
  notifications.remove('srv-1')
  notifications.clear()
  assert.deepEqual(events, ['read:srv-1', 'read_all', 'remove:srv-1', 'clear'])

  dispose()
  assert.equal(disconnected, true)
})

test('isSafeNotificationHref rejects javascript:, data: and protocol-relative URLs', () => {
  assert.equal(isSafeNotificationHref('/logs'), true)
  assert.equal(isSafeNotificationHref('https://example.com/run/1'), true)
  assert.equal(isSafeNotificationHref('http://localhost:8000/page'), true)
  assert.equal(isSafeNotificationHref('javascript:alert(1)'), false)
  assert.equal(isSafeNotificationHref('data:text/html,<h1>hi</h1>'), false)
  assert.equal(isSafeNotificationHref('//evil.example/phish'), false)
  assert.equal(isSafeNotificationHref(''), false)
})

test('formatRelativeTime formats seconds, minutes, hours, and days concisely', () => {
  const now = 1_700_000_000_000
  assert.equal(formatRelativeTime(now - 10_000, now), 'Just now')
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago')
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), '3h ago')
  assert.equal(formatRelativeTime(now - 2 * 86400_000, now), '2d ago')
})
