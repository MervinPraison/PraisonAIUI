/**
 * Reading order of the docs nav: the previous / next page links under an
 * article, and the section an active page sits in (its eyebrow).
 */
import { normalizeDocPath } from '../pathUtils'
import type { DocsNav, NavItem } from '../types'

/** Whether a sidebar item shows: hidden pages never, a group only with a page that shows. */
export function navItemShown(item: NavItem): boolean {
    if (item.children?.length) return item.children.some(navItemShown)
    return !item.hidden
}

/** Every page (an item with a path and no children) in sidebar order; hidden pages unless `keep` says otherwise. */
export function docPages(nav: DocsNav, keep: (page: NavItem) => boolean = (p) => !p.hidden): NavItem[] {
    const pages: NavItem[] = []
    const walk = (items: NavItem[]) => {
        for (const item of items) {
            if (item.children?.length) walk(item.children)
            else if (item.path && keep(item)) pages.push(item)
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

/** Title of the nav group that holds `path` (the closest parent with children), or null at the top level. */
export function docSection(nav: DocsNav, path: string): string | null {
    const target = normalizeDocPath(path)
    const find = (items: NavItem[], parent: NavItem | null): string | null | undefined => {
        for (const item of items) {
            if (item.children?.length) {
                const hit = find(item.children, item)
                if (hit !== undefined) return hit
            } else if (item.path && normalizeDocPath(item.path) === target) {
                return parent?.title ?? null
            }
        }
        return undefined
    }
    return find(nav.items ?? [], null) ?? null
}

/** Pages grouped by top-level section for search; top-level pages first, under "Pages".
 *  `noindex` pages (and hidden ones, which the build marks noindex unless `seo.indexing: all`) are left out. */
export function docSearchGroups(nav: DocsNav): { title: string; pages: NavItem[] }[] {
    const searchable = (p: NavItem) => !p.noindex
    const loose: NavItem[] = []
    const groups: { title: string; pages: NavItem[] }[] = []
    for (const item of nav.items ?? []) {
        if (item.children?.length) {
            const pages = docPages({ items: item.children }, searchable)
            if (pages.length) groups.push({ title: item.title, pages })
        } else if (item.path && searchable(item)) {
            loose.push(item)
        }
    }
    return loose.length ? [{ title: 'Pages', pages: loose }, ...groups] : groups
}
