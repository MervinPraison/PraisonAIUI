// Click-to-zoom for images in docs articles: a modal <dialog> with the image
// at full size. Images get a button role and a label as the article renders,
// so the keyboard reaches them too. One
// delegated handler; nothing in the markdown chunk the chat shares.
import { useEffect } from 'react'

const ZOOMABLE = '#main-content article.aiui-doc img:not(.katex img)'
const DIALOG_ID = 'aiui-image-zoom'

/** Images worth zooming: not inside a link (a card or a linked badge), not tiny. */
function zoomable(img: HTMLImageElement): boolean {
    return !img.closest('a') && (img.naturalWidth === 0 || img.naturalWidth > 160)
}

export function markZoomableImages(root: ParentNode = document): number {
    let n = 0
    root.querySelectorAll<HTMLImageElement>(ZOOMABLE).forEach((img) => {
        if (img.dataset.zoom !== undefined || !zoomable(img)) return
        img.dataset.zoom = ''
        img.tabIndex = 0
        img.setAttribute('role', 'button')
        img.setAttribute('aria-label', `Zoom image${img.alt ? `: ${img.alt}` : ''}`)
        n += 1
    })
    return n
}

function dialog(): HTMLDialogElement {
    let d = document.getElementById(DIALOG_ID) as HTMLDialogElement | null
    if (d) return d
    d = document.createElement('dialog')
    d.id = DIALOG_ID
    d.className = 'aiui-zoom'
    const img = document.createElement('img')
    d.appendChild(img)
    // Any click closes it (on the image too: the reader zoomed to look, not to act).
    d.addEventListener('click', () => d!.close())
    d.addEventListener('close', () => {
        img.removeAttribute('src')
        ;(d as HTMLDialogElement & { opener?: HTMLElement }).opener?.focus()
    })
    document.body.appendChild(d)
    return d
}

export function openZoom(source: HTMLImageElement): void {
    const d = dialog() as HTMLDialogElement & { opener?: HTMLElement }
    const img = d.querySelector('img')!
    img.src = source.currentSrc || source.src
    img.alt = source.alt
    d.setAttribute('aria-label', source.alt ? `Image: ${source.alt}` : 'Image')
    d.opener = source
    if (!d.open) d.showModal()
}

function target(e: Event): HTMLImageElement | null {
    const el = e.target as Element | null
    return el instanceof HTMLImageElement && el.dataset.zoom !== undefined && el.matches(ZOOMABLE) ? el : null
}

/** Zoomable images on every docs article, and their click and key handlers. */
export function useImageZoom(active: boolean): void {
    useEffect(() => {
        if (!active) return
        // Images arrive when the lazy renderer draws the article, which can be
        // after aiui:content-loaded: mark them whenever the article changes.
        let frame = 0
        const onLoaded = () => {
            window.cancelAnimationFrame(frame)
            frame = window.requestAnimationFrame(() => markZoomableImages())
        }
        const observer = new MutationObserver(onLoaded)
        observer.observe(document.body, { childList: true, subtree: true })
        onLoaded()
        const onClick = (e: MouseEvent) => {
            const img = target(e)
            if (!img || e.button !== 0) return
            e.preventDefault()
            openZoom(img)
        }
        const onKey = (e: KeyboardEvent) => {
            const img = target(e)
            if (!img || (e.key !== 'Enter' && e.key !== ' ')) return
            e.preventDefault()
            openZoom(img)
        }
        window.addEventListener('aiui:content-loaded', onLoaded)
        document.addEventListener('click', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            observer.disconnect()
            window.cancelAnimationFrame(frame)
            window.removeEventListener('aiui:content-loaded', onLoaded)
            document.removeEventListener('click', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [active])
}
