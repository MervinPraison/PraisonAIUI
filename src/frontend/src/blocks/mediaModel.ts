/**
 * Pure helpers for the media, navigation and overlay blocks (mediaBlocks.tsx):
 * in-app page links and avatar initials.
 */
import type { MouseEvent } from 'react'
import { navigate } from '@/sdk/services'

/** URL path of an app page (`page_link("sync")` → `/sync`). */
export function pageHref(pageId: string): string {
  return `/${encodeURIComponent(pageId)}`
}

/**
 * `href` + `onClick` for a link to an app page: a plain left click moves
 * inside the shell without a reload; modified clicks (new tab, ...) and
 * middle clicks keep the browser's behaviour.
 */
export function pageLinkProps(pageId: string): { href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void } {
  return {
    href: pageHref(pageId),
    onClick: (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return
      e.preventDefault()
      navigate(pageId)
    },
  }
}

/** Up to two initials of a name ("Ada Lovelace" → "AL"); "?" for none. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
  return letters.join('').toUpperCase() || '?'
}
