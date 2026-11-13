/**
 * Path router for the React shell (ADR-0001 §3).
 *
 * The route key is the FIRST path segment: `/logs?x=1` and `/logs/detail`
 * both resolve to page `logs`, so a legacy view that only rewrites its query
 * string (skills, runs) with replaceState never remounts.
 *
 * history.pushState/replaceState are patched once to emit
 * `aiui:locationchange`, so navigations done by legacy views (overview, eval
 * and chat-canvas push `/runs?…`, `/canvas`) re-render the shell too.
 *
 * Everything reads `window` at call time (never at import), so router.test.ts
 * can install a minimal window/history fake.
 */
import { useSyncExternalStore } from 'react'

export const LOCATION_CHANGE_EVENT = 'aiui:locationchange'
export const PAGE_CHANGE_EVENT = 'aiui:page-change'

const PATCHED = Symbol.for('aiui.shell.historyPatched')

/** `/#/replay?run=1` (legacy deep links, e.g. `praisonai replay view`). */
const HASH_ROUTE = /^#\/([A-Za-z0-9_-]+)(\?[^#]*)?$/

/** Page id for a pathname: its first segment, URI-decoded. `/` maps to ''. */
export function pageIdFromPath(pathname: string): string {
  const seg = pathname.replace(/^\/+/, '').split('/')[0] || ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/** URL path for a page id. */
export function pathForPage(pageId: string): string {
  return `/${encodeURIComponent(pageId)}`
}

/**
 * Wrap history.pushState/replaceState so each call also dispatches
 * `aiui:locationchange` on window. Idempotent per history object.
 */
export function patchHistory(): void {
  const win = window
  const h = win.history as History & { [PATCHED]?: true }
  if (h[PATCHED]) return
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = h[method]
    h[method] = function patchedHistoryMethod(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      win.dispatchEvent(new Event(LOCATION_CHANGE_EVENT))
      return result
    }
  }
  h[PATCHED] = true
}

/**
 * Rewrite a legacy hash deep link (`/#/logs?x=1`) to its path form
 * (`/logs?x=1`) with replaceState. Only applies at the site root, like the
 * legacy dashboard. Returns true when the URL was rewritten.
 */
export function rewriteHashDeepLink(): boolean {
  const { location, history } = window
  if (location.pathname !== '/' && location.pathname !== '') return false
  const m = HASH_ROUTE.exec(location.hash)
  if (!m) return false
  history.replaceState(history.state, '', `${pathForPage(m[1])}${m[2] ?? ''}`)
  return true
}

/** Current page id (first path segment). */
export function getPageId(): string {
  return pageIdFromPath(window.location.pathname)
}

export interface NavigateOptions {
  /** replaceState instead of pushState (redirects). */
  replace?: boolean
}

/**
 * Go to a page. A no-op when the path already is `/<id>` (a query string on
 * the current page is kept). Legacy `window.aiui.selectPage` lands here via
 * setLegacyNavigator().
 */
export function navigate(pageId: string, opts: NavigateOptions = {}): void {
  const { location, history } = window
  const path = pathForPage(pageId)
  if (location.pathname === path) return
  if (opts.replace) history.replaceState({ pageId }, '', path)
  else history.pushState({ pageId }, '', path)
}

/** Subscribe to every URL change (back/forward, push/replace by anyone). */
export function subscribeLocation(cb: () => void): () => void {
  patchHistory()
  window.addEventListener('popstate', cb)
  window.addEventListener(LOCATION_CHANGE_EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(LOCATION_CHANGE_EVENT, cb)
  }
}

function serverPageId() {
  return ''
}

/** The current page id; re-renders only when the first path segment changes. */
export function usePageId(): string {
  return useSyncExternalStore(subscribeLocation, getPageId, serverPageId)
}

/**
 * Resolve once `aiui:page-change` reports `pageId` as mounted (dispatched by
 * LegacyViewHost and, for React pages, by the shell), or after `timeoutMs`.
 */
export function waitForPageChange(pageId: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener(PAGE_CHANGE_EVENT, onChange)
      resolve()
    }
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ pageId?: string } | null>).detail
      if (detail?.pageId === pageId) finish()
    }
    window.addEventListener(PAGE_CHANGE_EVENT, onChange)
    const timer = window.setTimeout(finish, timeoutMs)
  })
}

/** True for a primary-button click without modifiers (let the browser handle the rest). */
export function isPlainLeftClick(e: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}
