import type { NavItem, NavTabConfig } from '../types'
import { pageRoute } from './docSource'

function sectionTitle(item: NavItem): string {
    return item.title.trim().toLowerCase()
}

function collectPaths(item: NavItem): string[] {
    const paths: string[] = []
    if (item.path) paths.push(item.path.toLowerCase())
    for (const child of item.children ?? []) {
        paths.push(...collectPaths(child))
    }
    return paths
}

function pathMatchesPage(docPath: string, page: string): boolean {
    const normalizedPage = page.replace(/^\/+/, '').toLowerCase()
    const normalizedPath = docPath.replace(/\/+$/, '').toLowerCase()

    if (normalizedPage === 'index') {
        return normalizedPath.endsWith('/index') || normalizedPath === '/docs'
    }

    const suffix = `/${normalizedPage}`
    if (normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`${suffix}/index`)) return true

    // The page's own route, as the build names it (pageRoute): `protocols/adp/README`
    // is served at /docs/protocols/adp, `adr/0003-x` at /docs/adr/x. Without this a
    // README or index page belongs to no tab and the header falls back to the first.
    const route = pageRoute(`/docs/${normalizedPage}.md`).toLowerCase()
    return route !== '/' && route !== '/docs' && normalizedPath.endsWith(route)
}

/** Index of the first group of `tab` a sidebar item belongs to, or -1 (from topnav plugin logic). */
export function navItemTabGroupIndex(item: NavItem, tab: NavTabConfig): number {
    if (!tab.groups?.length) return -1

    const header = sectionTitle(item)
    const paths = collectPaths(item)

    for (const [index, grp] of tab.groups.entries()) {
        const groupName = grp.group.toLowerCase()
        if (header === groupName) return index

        if (grp.prefix) {
            const prefix = grp.prefix.toLowerCase()
            if (header === prefix || header === prefix.replace(/-/g, ' ')) return index

            const prefixPath = `/docs/${prefix}`
            if (paths.some((path) => path === prefixPath || path.startsWith(`${prefixPath}/`))) {
                return index
            }
        }

        if (grp.pages?.some((page) => paths.some((path) => pathMatchesPage(path, page)))) {
            return index
        }

        if (!item.children?.length && grp.pages?.some((page) => {
            const slug = page.split('/').pop()?.replace(/-/g, ' ') ?? ''
            return header === slug || header === page.toLowerCase()
        })) {
            return index
        }
    }

    return -1
}

/** Whether a sidebar group belongs to the given navigation tab. */
export function navItemBelongsToTab(item: NavItem, tab: NavTabConfig): boolean {
    return navItemTabGroupIndex(item, tab) >= 0
}

/** Pick the active tab index from the current URL path: the tab whose groups list the page, else the longest folder prefix. */
export function detectActiveTabIndex(tabs: NavTabConfig[], path: string): number {
    const normalized = path.toLowerCase()
    const docPath = normalized.replace(/\/+$/, '')
    if (docPath && docPath !== '/') {
        const listed = tabs.findIndex((tab) => tab.groups?.some((grp) => grp.pages?.some((page) => pathMatchesPage(docPath, page))))
        if (listed >= 0) return listed
    }
    let bestMatch = -1
    let bestMatchLen = 0

    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]
        for (const grp of tab.groups ?? []) {
            if (!grp.prefix) continue
            const needle = `/${grp.prefix.toLowerCase()}/`
            if (normalized.includes(needle) && needle.length > bestMatchLen) {
                bestMatch = i
                bestMatchLen = needle.length
            }
        }
    }

    if (bestMatch >= 0) return bestMatch
    return 0
}

/** The sidebar items of one tab, in the order the tab lists its groups (stable within a group). */
export function filterNavByTab(items: NavItem[], tab: NavTabConfig | undefined): NavItem[] {
    if (!tab) return items
    return items
        .map((item, i) => ({ item, i, group: navItemTabGroupIndex(item, tab) }))
        .filter((entry) => entry.group >= 0)
        .sort((a, b) => a.group - b.group || a.i - b.i)
        .map((entry) => entry.item)
}
