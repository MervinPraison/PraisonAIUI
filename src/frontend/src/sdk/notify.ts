/**
 * Notifications (`notify` in `@aiui/sdk`). sonner (and its Toaster) is NOT on
 * the boot path: the first notify() loads it and asks the host to mount its
 * Toaster (the shell renders <ShellToaster> once useToasterRequested() is
 * true). sonner replays active toasts to a Toaster that subscribes later, so a
 * toast raised before the Toaster has mounted is still shown.
 *
 * Everything (plugin loader, blocks, built-ins, plugins) calls notify() rather
 * than importing `sonner` statically, which would pull it into their static
 * closure and leave no Toaster mounted to show the toast.
 *
 * This module lives in sdk/ so the SDK never imports the shell.
 */
import { useSyncExternalStore } from 'react'
import type { ExternalToast } from 'sonner'
import { _setNotificationToastForwarder, notifications, type NotificationAction } from './notifications'

export type NotifyType = 'default' | 'info' | 'success' | 'warning' | 'error'
export interface NotifyOptions extends ExternalToast {
  type?: NotifyType
  /**
   * Record this toast in the Notification Center bell (default: true).
   * Pass `false` for purely ephemeral notices that should not persist in the center.
   */
  record?: boolean
  /** Optional category tag for filtering inside the Notification Center. */
  category?: string
  /** Optional source tag (defaults to `'toast'`). */
  source?: string
}

let toasterRequested = false
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const getRequested = () => toasterRequested

/** Ask the host to mount the (lazy) Toaster. */
export function requestToaster(): void {
  if (toasterRequested) return
  toasterRequested = true
  for (const fn of [...listeners]) fn()
}

/** True once anything asked for a toast; the host then renders its Toaster. */
export function useToasterRequested(): boolean {
  return useSyncExternalStore(subscribe, getRequested, getRequested)
}

/**
 * Close the toast with this id (the `id` passed to notify(), or the id it
 * resolved to); with no id, close every toast. Nothing to close until a toast
 * was raised, so sonner is never loaded just for this.
 */
export function dismiss(id?: string | number): Promise<void> {
  if (!toasterRequested) return Promise.resolve()
  return import('sonner').then(
    ({ toast }) => {
      toast.dismiss(id)
    },
    () => undefined,
  )
}

function toNotificationAction(action: ExternalToast['action']): NotificationAction | undefined {
  if (!action || typeof action !== 'object' || !('label' in action)) return undefined
  const label = typeof action.label === 'string' ? action.label : ''
  const onClick = typeof action.onClick === 'function' ? () => action.onClick({} as never) : undefined
  if (!label || !onClick) return undefined
  return { label, onClick }
}

/** Show a toast (and by default record it in the Notification Center). Returns the sonner toast id once loaded. */
export function notify(message: string, opts: NotifyOptions = {}): Promise<string | number | undefined> {
  requestToaster()
  const { type = 'default', record = true, category, source, ...rest } = opts
  if (record) {
    const id = rest.id !== undefined ? String(rest.id) : undefined
    notifications.push({
      id,
      dedupeKey: id,
      title: message,
      description: typeof rest.description === 'string' ? rest.description : undefined,
      type,
      category,
      source: source ?? 'toast',
      action: toNotificationAction(rest.action),
    })
  }
  return import('sonner').then(
    ({ toast }) => (type === 'default' ? toast(message, rest) : toast[type](message, rest)),
    (err: unknown) => {
      console.warn('[aiui sdk] could not load notifications', err, message)
      return undefined
    },
  )
}

_setNotificationToastForwarder((item) => {
  void notify(item.title, {
    id: item.dedupeKey ?? item.id,
    type: item.type,
    description: item.description,
    record: false,
  })
})
