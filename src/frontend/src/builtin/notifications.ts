/**
 * builtin.notifications: first-party Notification Center plugin.
 *
 * Contributes purely through `@aiui/sdk` (R2, R3):
 * - Registers a lightweight `<NotificationBell>` trigger in the `header:actions`
 *   slot (appears in Classic and every selectable layout frame).
 * - Lazily loads `./NotificationPanel` (Radix Popover) on hover/focus/click and
 *   `./notificationServerSource` (REST + SSE sync) after activation so zero
 *   heavy code sits on the boot path (R10).
 * - Bridges `window` custom event `aiui:notification` into the single DRY SDK
 *   store (`sdk.notifications`) and adds command-palette actions.
 */
import { createElement } from 'react'
import type { PushNotificationInput } from '@/sdk/notifications'
import { NotificationBell } from './NotificationBell'
import type { BuiltinPlugin } from './types'

export const NOTIFICATION_EVENT = 'aiui:notification'
const SERVER_SOURCE_ID = 'builtin.server'

let openListeners = new Set<() => void>()

/** Register an active bell opener callback; returns an unsubscribe function. */
export function registerNotificationPanelOpener(fn: () => void): () => void {
  openListeners.add(fn)
  return () => {
    openListeners.delete(fn)
  }
}

/** Programmatically open the active header Notification Center popover (e.g. from ⌘K). */
export function openNotificationsPanel(): void {
  for (const fn of [...openListeners]) fn()
}

export function resetNotificationsPluginForTests(): void {
  openListeners = new Set()
}

function NotificationBellSlot() {
  return createElement(NotificationBell)
}

export const notificationsBuiltin: BuiltinPlugin = {
  name: 'builtin.notifications',
  pages: [],
  always: true,
  activate(sdk) {
    sdk.registerSlot('header:actions', NotificationBellSlot, {
      id: 'builtin.notifications',
      order: 90,
    })
    sdk.registerCommand({
      id: 'notifications.open',
      title: 'Open notifications',
      group: 'Notifications',
      keywords: ['bell', 'alerts', 'messages', 'unread'],
      run: () => openNotificationsPanel(),
    })
    sdk.registerCommand({
      id: 'notifications.markAllRead',
      title: 'Mark all notifications as read',
      group: 'Notifications',
      keywords: ['clear', 'unread', 'bell'],
      run: () => {
        sdk.notifications.markAllRead()
      },
    })

    // Load REST + SSE sync chunk asynchronously so boot stays lean (R10).
    if (typeof window !== 'undefined' && 'location' in window) {
      void import('./notificationServerSource')
        .then(({ createServerNotificationSource }) => {
          sdk.notifications.registerSource(SERVER_SOURCE_ID, createServerNotificationSource(sdk))
        })
        .catch(() => undefined)
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener(NOTIFICATION_EVENT, (ev: Event) => {
        const detail = (ev as CustomEvent<unknown>).detail
        if (detail && typeof detail === 'object') {
          const r = detail as Record<string, unknown>
          const title = typeof r.title === 'string' ? r.title : typeof r.message === 'string' ? r.message : ''
          if (title.trim()) {
            sdk.notifications.push({ ...(r as unknown as PushNotificationInput), title })
          }
        }
      })
    }
  },
}
