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

/** Things a reader does that mean "leave my scroll position alone". */
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const

/** Longest wait for the heading to appear (the renderer chunk may still be loading). */
const WAIT_MS = 5000

/**
 * Scroll to the URL's hash once its element exists. The article can paint
 * before the lazy renderer has drawn its headings, so watch the page for it
 * (up to WAIT_MS), then scroll again when the web fonts are in: a face that
 * arrives late rewraps the text above. Stops as soon as the reader scrolls.
 */
function scrollWhenReady(isTouched: () => boolean): () => void {
    // When the web fonts are in, scroll once more: a late face rewraps the text above.
    const afterFonts = () => {
        void document.fonts?.ready.then(() => {
            if (!isTouched()) window.requestAnimationFrame(() => scrollToHash())
        })
    }
    if (scrollToHash()) {
        afterFonts()
        return () => {}
    }
    const observer = new MutationObserver(() => {
        if (isTouched()) stop()
        else if (scrollToHash()) {
            stop()
            afterFonts()
        }
    })
    const timer = window.setTimeout(() => stop(), WAIT_MS)
    function stop() {
        observer.disconnect()
        window.clearTimeout(timer)
    }
    observer.observe(document.getElementById('main-content') ?? document.body, { childList: true, subtree: true })
    return stop
}

/**
 * Scroll to the URL's hash whenever a docs article renders (and when the hook
 * starts, for an article that rendered first).
 */
export function useHashScroll(active: boolean): void {
    useEffect(() => {
        if (!active) return
        let touched = false
        let cancel = () => {}
        const onInput = () => {
            touched = true
        }
        const onLoaded = () => {
            if (!window.location.hash) return
            touched = false
            cancel()
            window.requestAnimationFrame(() => {
                cancel = scrollWhenReady(() => touched)
            })
        }
        window.addEventListener('aiui:content-loaded', onLoaded)
        for (const type of READER_INPUT) window.addEventListener(type, onInput, { passive: true })
        onLoaded()
        return () => {
            cancel()
            window.removeEventListener('aiui:content-loaded', onLoaded)
            for (const type of READER_INPUT) window.removeEventListener(type, onInput)
        }
    }, [active])
}
