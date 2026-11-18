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
