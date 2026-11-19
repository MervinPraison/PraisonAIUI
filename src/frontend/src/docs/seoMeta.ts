// Page-level SEO values the docs App sets on client navigation; they match
// what `aiui build` writes into each page (compiler/publish.py).
import type { SEOConfig } from '../types'

/** The robots meta: `noindex` alone for a noindex page (its links are still followed), else `seo.robots`. */
export function robotsContent(noindex: boolean | undefined, robots: SEOConfig['robots']): string {
    const follow = robots?.follow === false ? 'nofollow' : 'follow'
    if (noindex || robots?.index === false) return follow === 'follow' ? 'noindex' : 'noindex, nofollow'
    return `index, ${follow}`
}

/** A page's canonical URL; with `seo.trailingSlash` it ends in `/`. */
export function pageUrl(origin: string, path: string, seo: SEOConfig | undefined): string {
    const url = `${origin}${path}`
    return seo?.trailingSlash && !url.endsWith('/') ? `${url}/` : url
}

// The head tags of a page; mirrors compiler/seo.py merge() and render(), so the
// tags after client navigation match the ones `aiui build` wrote.
const URL_KEYS = new Set(['canonical', 'og:url', 'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image'])
const NOINDEX = /\b(noindex|none)\b/i
const PROPERTY = /^(og|article|fb|book|profile|music|video):/
/** A page's translation (compiler/languages.py): `hreflang:fr` is `<link rel="alternate" hreflang="fr">`. */
const HREFLANG = 'hreflang:'

/**
 * `defaults` with `overrides` (`seo.metatags`, then the page's `seo`) on top: `og:url`
 * follows the canonical and `twitter:image` the `og:image` unless set themselves,
 * `twitter:card` is `summary_large_image` with an image, and a noindex page stays noindex.
 */
export function mergeTags(
    defaults: Record<string, string>,
    overrides: Record<string, string>,
    absolute: (path: string) => string,
): Record<string, string> {
    const tags = { ...defaults }
    for (const [key, value] of Object.entries(overrides)) {
        tags[key] = (URL_KEYS.has(key) || key.startsWith(HREFLANG)) && value.startsWith('/') && !value.startsWith('//') ? absolute(value) : value
    }
    if (!('og:url' in overrides)) tags['og:url'] = tags.canonical
    if (!('twitter:image' in overrides) && tags['og:image']) tags['twitter:image'] = tags['og:image']
    tags['twitter:card'] ??= tags['twitter:image'] ? 'summary_large_image' : 'summary'
    if (NOINDEX.test(defaults.robots ?? '') && !NOINDEX.test(tags.robots ?? '')) tags.robots = defaults.robots
    return tags
}

// Keys written on an earlier page, removed when the next page does not set them.
let written = new Set<string>()

/** Writes `tags` into `doc.head`: the canonical link, the translations' alternate links and one
 *  `<meta>` per other key (`property=` for Open Graph). Alternates the page does not name go. */
export function applyHeadTags(doc: Document, tags: Record<string, string>): void {
    const find = (key: string) =>
        key === 'canonical'
            ? doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
            : key.startsWith(HREFLANG)
              ? doc.head.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${CSS.escape(key.slice(HREFLANG.length))}"]`)
              : doc.head.querySelector<HTMLMetaElement>(`meta[name="${key}"], meta[property="${key}"]`)
    doc.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => {
        if (!(`${HREFLANG}${el.getAttribute('hreflang')}` in tags)) el.remove()
    })
    for (const key of written) if (!(key in tags)) find(key)?.remove()
    written = new Set(Object.keys(tags))
    for (const [key, value] of Object.entries(tags)) {
        const link = key === 'canonical' || key.startsWith(HREFLANG)
        let el = find(key)
        if (!el) {
            el = doc.createElement(link ? 'link' : 'meta')
            if (key.startsWith(HREFLANG)) el.setAttribute('hreflang', key.slice(HREFLANG.length))
            el.setAttribute(link ? 'rel' : PROPERTY.test(key) ? 'property' : 'name', key === 'canonical' ? key : link ? 'alternate' : key)
            doc.head.appendChild(el)
        }
        el.setAttribute(link ? 'href' : 'content', value)
    }
}
