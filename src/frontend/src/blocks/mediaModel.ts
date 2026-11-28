/**
 * Pure helpers for the media, navigation and overlay blocks (mediaBlocks.tsx):
 * in-app page links and avatar initials.
 */
import type { MouseEvent } from 'react'
import { getManifest, navigate, pageHref, pageLinkProps } from '@/sdk/services'
import { paramsFromSearch, type PageParams } from './pageParams'

export { pageHref, pageLinkProps }

/**
 * Parse a relative or same-origin URL targeting a registered app page
 * (`/creator?creator=x`). Returns null for external URLs, sub-paths, hashes
 * or paths whose first segment is not a page in `pages`.
 */
export function resolveAppPageHref(
  href: string,
  pages: readonly { id: string }[] | undefined,
): { pageId: string; params: PageParams } | null {
  if (!pages || pages.length === 0 || typeof window === 'undefined') return null
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin || url.hash) return null
  const segs = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (segs.length !== 1) return null
  let pageId: string
  try {
    pageId = decodeURIComponent(segs[0])
  } catch {
    pageId = segs[0]
  }
  if (!pages.some((p) => p.id === pageId)) return null
  return { pageId, params: paramsFromSearch(url.search) }
}

/** Navigate in-app when `href` targets a registered shell page; returns true if handled. */
export function tryNavigateHref(href: string): boolean {
  const match = resolveAppPageHref(href, getManifest()?.pages)
  if (!match) return false
  navigate(match.pageId, { params: match.params })
  return true
}

/** Click handler for a non-external `<a>` so same-origin app page hrefs stay in the SPA shell. */
export function hrefLinkOnClick(href: string): (e: MouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return
    if (tryNavigateHref(href)) e.preventDefault()
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
