// "Related pages" under a docs article (docs/RelatedPages.tsx): the page's
// `related` entries from docs-nav.json (compiler/related.py) as links.
import { normalizeDocPath } from '../pathUtils'
import type { DocsNav, NavItem } from '../types'
import { docPages } from './docNav'

export interface RelatedLink {
    title: string
    href: string
    /** Leaves the site: opens in a new tab. */
    external?: boolean
}

/** The links of `item.related`; a page path takes its title from the nav, and a path the nav lacks is dropped. `toHref`: a docs path as a link. */
export function relatedLinks(nav: DocsNav | undefined, item: NavItem, toHref: (path: string) => string): RelatedLink[] {
    if (!item.related?.length) return []
    const titles = new Map<string, string>()
    for (const page of nav ? docPages(nav, () => true) : []) titles.set(normalizeDocPath(page.path ?? ''), page.pageTitle ?? page.title)
    const links: RelatedLink[] = []
    for (const entry of item.related) {
        if (typeof entry !== 'string' && entry.href) {
            if (/^https?:\/\//.test(entry.href)) links.push({ title: entry.title, href: entry.href, external: true })
            continue
        }
        const target = typeof entry === 'string' ? entry : entry.path ?? ''
        const [path, hash] = target.split('#', 2)
        const title = typeof entry === 'string' ? titles.get(normalizeDocPath(path)) : entry.title
        if (!path || !title) continue
        links.push({ title, href: toHref(path) + (hash ? `#${hash}` : '') })
    }
    return links
}
