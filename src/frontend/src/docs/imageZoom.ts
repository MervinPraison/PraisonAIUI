// Click-to-zoom for images in docs articles: a modal <dialog> with the image
// at full size. Images get a button role and a label as the article renders,
// so the keyboard reaches them too. One
// delegated handler; nothing in the markdown chunk the chat shares.
import { useEffect } from 'react'

const ZOOMABLE = '#main-content article.aiui-doc img:not(.katex img, .aiui-card-img, .aiui-embed img)'
const DIALOG_ID = 'aiui-image-zoom'

/** Images worth zooming: not inside a link (a card or a linked badge), not marked `noZoom`, not tiny. */
function zoomable(img: HTMLImageElement): boolean {
    return !img.closest('a') && img.dataset.nozoom === undefined && (img.naturalWidth === 0 || img.naturalWidth > 160)
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
    // Copy and Download for every zoomed image: no per-image option to remember.
    const bar = document.createElement('div')
    bar.className = 'aiui-zoom-actions'
    bar.setAttribute('aria-live', 'polite')
    for (const [label, act] of [['Copy image', copyImage], ['Download', downloadImage]] as const) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.addEventListener('click', async (e) => {
            e.stopPropagation()
            const ok = await act(img)
            if (ok === undefined) return
            b.textContent = ok ? 'Copied' : 'Could not copy: use Download'
            setTimeout(() => (b.textContent = label), 2000)
        })
        bar.appendChild(b)
    }
    d.append(img, bar)
    // Any other click closes it (on the image too: the reader zoomed to look, not to act).
    d.addEventListener('click', () => d!.close())
    d.addEventListener('close', () => {
        img.removeAttribute('src')
        ;(d as HTMLDialogElement & { opener?: HTMLElement }).opener?.focus()
    })
    document.body.appendChild(d)
    return d
}

/** The image as PNG on the clipboard (drawn on a canvas: the clipboard takes PNG only). False when it cannot be copied. */
export async function copyImage(img: HTMLImageElement): Promise<boolean> {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        const png = new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('no image'))), 'image/png'))
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        return true
    } catch {
        return false // no clipboard (plain http), or an image from a site that does not allow it
    }
}

/** Saves the image under its own file name (an image on another site opens in a new tab). */
export function downloadImage(img: HTMLImageElement): void {
    const a = document.createElement('a')
    a.href = img.src
    a.download = decodeURIComponent(new URL(img.src, location.href).pathname.split('/').pop() || 'image')
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
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
        // Images arrive when the lazy renderer draws the article, after
        // aiui:content-loaded, and a re-render replaces them: watch the page,
        // at most one (idempotent) pass per frame, as headingAnchors does.
        let frame = 0
        const scan = () => {
            if (frame) return
            frame = window.requestAnimationFrame(() => {
                frame = 0
                markZoomableImages()
            })
        }
        const observer = new MutationObserver(scan)
        observer.observe(document.body, { childList: true, subtree: true })
        scan()
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
        document.addEventListener('click', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            observer.disconnect()
            window.cancelAnimationFrame(frame)
            document.removeEventListener('click', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [active])
}
