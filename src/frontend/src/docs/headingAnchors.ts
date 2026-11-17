// Section links in docs articles: every ## to #### heading with an id gets a
// copy-link anchor after its text. Added from the docs side, so the markdown
// chunk the chat shares does not change; one delegated click handler serves
// them all. The headings are watched rather than awaited: they render after
// `aiui:content-loaded` (lazy renderer) and a re-render replaces them.
import { useEffect } from 'react'

const SVG_NS = 'http://www.w3.org/2000/svg'
// lucide "link-2", drawn here so no icon module is shared with other chunks.
const LINK_PATHS = ['M9 17H7A5 5 0 0 1 7 7h2', 'M15 7h2a5 5 0 1 1 0 10h-2', 'M8 12h8']
const ANCHOR = 'aiui-heading-anchor'
const COPIED_MS = 1500

function linkGlyph(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg')
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
        svg.setAttribute(k, v)
    }
    for (const d of LINK_PATHS) {
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', d)
        svg.appendChild(path)
    }
    return svg
}

const label = (text: string, copied: boolean) => (copied ? `Link to ${text} copied` : `Copy link to ${text}`)

/** Add the anchor to every section heading in `root` that has an id and none yet. */
export function addHeadingAnchors(root: ParentNode): number {
    let added = 0
    root.querySelectorAll<HTMLElement>('h2[id], h3[id], h4[id]').forEach((h) => {
        if (!h.id || h.querySelector(`:scope > .${ANCHOR}`)) return
        const text = (h.textContent ?? '').trim()
        const a = document.createElement('a')
        a.className = ANCHOR
        a.href = `#${h.id}`
        a.dataset.text = text
        a.setAttribute('aria-label', label(text, false))
        a.appendChild(linkGlyph())
        h.appendChild(a)
        added += 1
    })
    return added
}

/** The delegated click: `#id` in the address bar, the heading to the top, its URL copied. */
export function onAnchorClick(e: MouseEvent): void {
    const a = (e.target as Element | null)?.closest?.(`a.${ANCHOR}`) as HTMLAnchorElement | null
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    const id = (a.getAttribute('href') ?? '').slice(1) // the raw heading id set above
    window.history.replaceState(window.history.state, '', `#${encodeURIComponent(id)}`)
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
    const text = a.dataset.text ?? ''
    navigator.clipboard?.writeText(window.location.href).then(
        () => {
            a.dataset.copied = ''
            a.setAttribute('aria-label', label(text, true))
            window.setTimeout(() => {
                delete a.dataset.copied
                a.setAttribute('aria-label', label(text, false))
            }, COPIED_MS)
        },
        () => undefined,
    )
}

/** Anchors on every docs article as its headings render, and their click handler. */
export function useHeadingAnchors(active: boolean): void {
    useEffect(() => {
        if (!active) return
        let frame = 0
        const scan = () => {
            if (frame) return // at most one pass per frame
            frame = window.requestAnimationFrame(() => {
                frame = 0
                const article = document.querySelector('#main-content article.aiui-doc')
                if (article) addHeadingAnchors(article)
            })
        }
        const observer = new MutationObserver(scan)
        observer.observe(document.body, { childList: true, subtree: true })
        scan()
        document.addEventListener('click', onAnchorClick)
        return () => {
            observer.disconnect()
            window.cancelAnimationFrame(frame)
            document.removeEventListener('click', onAnchorClick)
        }
    }, [active])
}
