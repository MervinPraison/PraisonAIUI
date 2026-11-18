/**
 * Reading order of the docs nav: the previous / next page links under an
 * article, and the section an active page sits in (its eyebrow).
 */
import { normalizeDocPath } from '../pathUtils'
import type { DocsNav, NavItem, NavTabConfig, SearchGroup } from '../types'
import { navItemTabGroupIndex } from './navTabs'

/** Whether a sidebar item shows: hidden pages never, a group only with a page that shows. */
export function navItemShown(item: NavItem): boolean {
    if (item.children?.length) return item.children.some(navItemShown)
    return !item.hidden
}

/** Every page (an item with a path; a group's own `root` page comes before its pages) in sidebar order; hidden pages unless `keep` says otherwise. */
export function docPages(nav: DocsNav, keep: (page: NavItem) => boolean = (p) => !p.hidden): NavItem[] {
    const pages: NavItem[] = []
    const walk = (items: NavItem[]) => {
        for (const item of items) {
            if (item.path && keep(item)) pages.push(item)
            if (item.children?.length) walk(item.children)
        }
    }
    walk(nav.items ?? [])
    return pages
}

/** The pages before and after `path` in reading order (null at either end, or when the page is not in the nav). */
export function docNeighbours(nav: DocsNav, path: string): { prev: NavItem | null; next: NavItem | null } {
    const pages = docPages(nav)
    const target = normalizeDocPath(path)
    const i = pages.findIndex((p) => normalizeDocPath(p.path ?? '') === target)
    if (i < 0) return { prev: null, next: null }
    return { prev: pages[i - 1] ?? null, next: pages[i + 1] ?? null }
}

/** The groups that hold `path`, outermost first (a group's own page sits in the groups around it); [] at the top level. */
export function docTrail(nav: DocsNav, path: string): NavItem[] {
    const target = normalizeDocPath(path)
    const find = (items: NavItem[], trail: NavItem[]): NavItem[] | null => {
        for (const item of items) {
            if (item.path && normalizeDocPath(item.path) === target) return trail
            const hit = item.children?.length ? find(item.children, [...trail, item]) : null
            if (hit) return hit
        }
        return null
    }
    return find(nav.items ?? [], []) ?? []
}

/** Title of the nav group that holds `path` (the closest parent with children), or null at the top level. */
export function docSection(nav: DocsNav, path: string): string | null {
    return docTrail(nav, path).at(-1)?.title ?? null
}

/** Whether `item` is, or holds, the sidebar's active entry (`activeItem`: a path, or a title). */
export function navItemHolds(item: NavItem, activeItem: string): boolean {
    return (item.path || item.title) === activeItem || !!item.children?.some((c) => navItemHolds(c, activeItem))
}

/** Pages grouped by top-level section for search; top-level pages first, under "Pages".
 *  `noindex` pages (and hidden ones, which the build marks noindex unless `seo.indexing: all`)
 *  and `searchable: false` pages are left out. With header `tabs`, each group carries the tab
 *  that holds it and that YAML group's `boost` (the sidebar's own rule, navTabs). */
export function docSearchGroups(nav: DocsNav, tabs: NavTabConfig[] = []): SearchGroup[] {
    const searchable = (p: NavItem) => !p.noindex && p.searchable !== false
    const placeOf = (item: NavItem): Pick<SearchGroup, 'tab' | 'boost'> => {
        for (const tab of tabs) {
            const i = navItemTabGroupIndex(item, tab)
            if (i >= 0) return { tab: tab.tab, boost: tab.groups?.[i]?.boost }
        }
        return {}
    }
    const loose = new Map<string, SearchGroup>()
    const groups: SearchGroup[] = []
    for (const item of nav.items ?? []) {
        if (item.children?.length) {
            const pages = docPages({ items: [item] }, searchable)
            if (pages.length) groups.push({ title: item.title, pages, ...placeOf(item) })
        } else if (item.path && searchable(item)) {
            const place = placeOf(item)
            const key = `${place.tab ?? ''}|${place.boost ?? ''}`
            if (!loose.has(key)) loose.set(key, { title: 'Pages', pages: [], ...place })
            loose.get(key)!.pages.push(item)
        }
    }
    return [...loose.values(), ...groups]
}

// Groups a reader folded or opened, per site (wrapped: blocked storage keeps them for the page only).
const OPEN_KEY = 'aiui-docs-nav-open'
let openMemory: Record<string, boolean> = {}

/** The reader's last choice for the group `key` (its titles joined by "/"), or undefined. */
export function rememberedOpen(key: string): boolean | undefined {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
        if (v && typeof v === 'object') openMemory = v as Record<string, boolean>
    } catch { /* storage blocked or corrupt: the in-page memory stands */ }
    return typeof openMemory[key] === 'boolean' ? openMemory[key] : undefined
}

export function rememberOpen(key: string, open: boolean): void {
    openMemory = { ...openMemory, [key]: open }
    try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(openMemory))
    } catch { /* storage blocked: remembered for this page only */ }
}
