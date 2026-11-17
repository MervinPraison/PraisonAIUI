// Open a docs page at a section: `/docs/page#heading-id`. The article renders
// after its Markdown arrives, so the browser's own jump to the hash finds
// nothing; scroll once the article is in (`aiui:content-loaded`, sent by
// Content.tsx) or at once when the page is already on screen.
import { useEffect } from 'react'

/** Scroll the element named by `hash` to the top of the reading area; false when it is not on the page. */
export function scrollToHash(hash: string = typeof window === 'undefined' ? '' : window.location.hash): boolean {
    let id = hash.replace(/^#/, '')
    if (!id || typeof document === 'undefined') return false
    try {
        id = decodeURIComponent(id)
    } catch {
        /* keep the raw id */
    }
    const el = document.getElementById(id)
    if (!el) return false
    // Headings carry a scroll-margin for the sticky header (docs.css).
    el.scrollIntoView({ block: 'start' })
    return true
}

/** Scroll to the URL's hash whenever a docs article finishes rendering. */
export function useHashScroll(active: boolean): void {
    useEffect(() => {
        if (!active) return
        const onLoaded = () => window.requestAnimationFrame(() => scrollToHash())
        window.addEventListener('aiui:content-loaded', onLoaded)
        return () => window.removeEventListener('aiui:content-loaded', onLoaded)
    }, [active])
}
