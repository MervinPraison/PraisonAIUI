/**
 * Has custom.js / a dashboard-plugin called `window.aiui.registerView(id)`?
 *
 * A registered view takes priority over the server's handler for the same
 * page (as in the legacy dashboard), so a `kind=blocks` page with a client
 * view is hosted by LegacyViewHost instead of BlockPage. Registrations made
 * before dashboard.js loads sit on `window.aiui.__queue` (the server's
 * custom.js stub); afterwards they live in `window.aiui.views`. A late call
 * dispatches `aiui:view-registered` (the legacy runtime's wrapper does it
 * after load; `watchQueuedRegistrations` makes the stub do it before).
 */
import { useCallback, useSyncExternalStore } from 'react'

export const VIEW_REGISTERED_EVENT = 'aiui:view-registered'

type QueueEntry = [string, ArrayLike<unknown>]
type RegisterFn = ((pageId: string, ...rest: unknown[]) => unknown) & { __aiuiQueueWatched?: true }
interface LegacyApi {
  views?: Record<string, unknown>
  __queue?: QueueEntry[]
  registerView?: RegisterFn
}

const api = (): LegacyApi | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { aiui?: LegacyApi }).aiui

export function hasLegacyView(pageId: string): boolean {
  const a = api()
  if (!a || !pageId) return false
  const views = a.views
  if (views && typeof views === 'object' && Object.prototype.hasOwnProperty.call(views, pageId)) return true
  return (a.__queue ?? []).some(([name, args]) => name === 'registerView' && args?.[0] === pageId)
}

/**
 * Make the queue stub announce registrations, so a page already on screen
 * switches to the client view without a reload. Only wraps the stub (a
 * function that is not dashboard.js's own); idempotent.
 */
export function watchQueuedRegistrations(): void {
  const a = api()
  const stub = a?.registerView
  if (!a || typeof stub !== 'function' || stub.__aiuiQueueWatched || a.views) return
  const wrapped: RegisterFn = (pageId, ...rest) => {
    const out = stub(pageId, ...rest)
    window.dispatchEvent(new CustomEvent(VIEW_REGISTERED_EVENT, { detail: { pageId } }))
    return out
  }
  wrapped.__aiuiQueueWatched = true
  a.registerView = wrapped
}

/**
 * Subscribe to legacy view registrations for `pageId`: wraps the queue stub
 * (so pre-load registrations announce themselves) and calls `onChange` for
 * every registration of this id (or an unspecified one).
 */
export function subscribeLegacyView(pageId: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  watchQueuedRegistrations()
  const on = (e: Event) => {
    const id = (e as CustomEvent<{ pageId?: unknown }>).detail?.pageId
    if (id === pageId || id === undefined) onChange()
  }
  window.addEventListener(VIEW_REGISTERED_EVENT, on)
  return () => window.removeEventListener(VIEW_REGISTERED_EVENT, on)
}

const noSubscribe = () => () => undefined
const never = () => false

/** True once a legacy view is registered for `pageId` (re-checked on every registration). */
export function useLegacyViewRegistered(pageId: string, enabled: boolean): boolean {
  const subscribe = useCallback((cb: () => void) => subscribeLegacyView(pageId, cb), [pageId])
  const snapshot = useCallback(() => hasLegacyView(pageId), [pageId])
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? snapshot : never, enabled ? snapshot : never)
}
