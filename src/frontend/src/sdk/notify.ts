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

export type NotifyType = 'default' | 'info' | 'success' | 'warning' | 'error'
export interface NotifyOptions extends ExternalToast {
  type?: NotifyType
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

/** Show a toast. Returns the sonner toast id once sonner has loaded. */
export function notify(message: string, opts: NotifyOptions = {}): Promise<string | number | undefined> {
  requestToaster()
  const { type = 'default', ...rest } = opts
  return import('sonner').then(
    ({ toast }) => (type === 'default' ? toast(message, rest) : toast[type](message, rest)),
    (err: unknown) => {
      console.warn('[aiui sdk] could not load notifications', err, message)
      return undefined
    },
  )
}
