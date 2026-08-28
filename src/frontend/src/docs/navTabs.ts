import type { NavItem, NavTabConfig } from '../types'

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
    return normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`${suffix}/index`)
}

/** Whether a sidebar group belongs to the given navigation tab (from topnav plugin logic). */
export function navItemBelongsToTab(item: NavItem, tab: NavTabConfig): boolean {
    if (!tab.groups?.length) return false

    const header = sectionTitle(item)
    const paths = collectPaths(item)

    for (const grp of tab.groups) {
        const groupName = grp.group.toLowerCase()
        if (header === groupName) return true

        if (grp.prefix) {
            const prefix = grp.prefix.toLowerCase()
            if (header === prefix || header === prefix.replace(/-/g, ' ')) return true

            const prefixPath = `/docs/${prefix}`
            if (paths.some((path) => path === prefixPath || path.startsWith(`${prefixPath}/`))) {
                return true
            }
        }

        if (grp.pages?.some((page) => paths.some((path) => pathMatchesPage(path, page)))) {
            return true
        }

        if (!item.children?.length && grp.pages?.some((page) => {
            const slug = page.split('/').pop()?.replace(/-/g, ' ') ?? ''
            return header === slug || header === page.toLowerCase()
        })) {
            return true
        }
    }

    return false
}

/** Pick the active tab index from the current URL path. */
export function detectActiveTabIndex(tabs: NavTabConfig[], path: string): number {
    const normalized = path.toLowerCase()
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

export function filterNavByTab(items: NavItem[], tab: NavTabConfig | undefined): NavItem[] {
    if (!tab) return items
    return items.filter((item) => navItemBelongsToTab(item, tab))
}
