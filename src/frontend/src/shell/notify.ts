/**
 * Shell notifications. sonner (and its Toaster) is NOT on the boot path: the
 * first notify() loads it and asks the shell to mount <ShellToaster>.
 * sonner replays active toasts to a Toaster that subscribes later, so a toast
 * raised before the Toaster has mounted is still shown.
 *
 * Other modules (plugin loader, chat, legacy bridges) should call notify()
 * rather than importing `sonner` statically, which would pull it into their
 * static closure and leave no Toaster mounted to show the toast.
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

/** Ask the shell to mount the (lazy) Toaster. */
export function requestToaster(): void {
  if (toasterRequested) return
  toasterRequested = true
  for (const fn of [...listeners]) fn()
}

/** True once anything asked for a toast; the shell then renders <ShellToaster>. */
export function useToasterRequested(): boolean {
  return useSyncExternalStore(subscribe, getRequested, getRequested)
}

/** Show a toast. Returns the sonner toast id once sonner has loaded. */
export function notify(message: string, opts: NotifyOptions = {}): Promise<string | number | undefined> {
  requestToaster()
  const { type = 'default', ...rest } = opts
  return import('sonner').then(
    ({ toast }) => (type === 'default' ? toast(message, rest) : toast[type](message, rest)),
    (err: unknown) => {
      console.warn('[aiui shell] could not load notifications', err, message)
      return undefined
    },
  )
}
