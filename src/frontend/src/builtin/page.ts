/**
 * Where the app is, for built-ins, without reaching into the shell. Both are
 * public contracts: a page lives at `/<id>` (the URL `navigate(id)` produces),
 * and the shell dispatches `aiui:page-change` ({ pageId }) once a page is on
 * screen (ADR-0001 §5 window events).
 */

export const PAGE_CHANGE_EVENT = 'aiui:page-change'

/** The id of the page in the address bar (first path segment). */
export function currentPageId(): string {
  const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0] || ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/** Resolves once `pageId` is on screen, or after `timeoutMs` (never rejects). */
export function whenPageShown(pageId: string, timeoutMs = 5000): Promise<void> {
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
