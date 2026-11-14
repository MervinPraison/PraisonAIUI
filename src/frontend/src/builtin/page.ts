/**
 * When a page is on screen, for built-ins, without reaching into the shell:
 * the shell dispatches `aiui:page-change` ({ pageId }) once a page is mounted
 * (ADR-0001 §5 window events). Which page the URL names comes from the SDK
 * (`sdk.getPageId()`), which reads it the way the shell's router does.
 */

export const PAGE_CHANGE_EVENT = 'aiui:page-change'

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
