/**
 * Docs versions (ui-config `navigation.versions`, docs/features/navigation.md#versions;
 * built by compiler/versions.py). The default version is served at the docs root and
 * every other one under its `prefix` (`/docs/v1`); a page belongs to the version whose
 * prefix holds it. The sidebar, tabs and search show the open version only.
 */
import type { NavDivision, NavItem, NavTabConfig, NavigationConfig } from '../types'
import type { DivisionLink } from './navDivisions'
import { docPages } from './docNav'

const clean = (path: string) => (path || '/').replace(/\/+$/, '') || '/'
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
/** A folder's page by either name: `/docs` and `/docs/index`. */
const same = (a: string, b: string) => clean(a).replace(/\/index$/, '') === clean(b).replace(/\/index$/, '')

/** The index of the version `path` belongs to: the longest prefix that holds it, else the default (-1: no versions). */
export function versionAt(versions: NavDivision[], path: string): number {
    const p = clean(path)
    let best = -1
    versions.forEach((v, i) => {
        if (v.default || !v.prefix || !under(p, v.prefix)) return
        if (best < 0 || v.prefix.length > (versions[best].prefix ?? '').length) best = i
    })
    if (best >= 0 || !versions.length) return best
    return Math.max(0, versions.findIndex((v) => v.default))
}

export const firstPath = (item: NavItem): string | undefined => item.path || item.children?.map(firstPath).find(Boolean)

/** The sidebar entries of version `index` (an entry with no page, such as a link, goes with the default). */
export function versionItems(items: NavItem[], versions: NavDivision[], index: number): NavItem[] {
    if (index < 0) return items
    return items.filter((item) => versionAt(versions, firstPath(item) ?? '/') === index)
}

/** `navigation` as version `index` shows it: its own tabs, else (the default version) the top-level
 *  tabs and dropdowns; anchors show in every version. */
export function versionNavigation(navigation: NavigationConfig | undefined, index: number): NavigationConfig | undefined {
    const v = navigation?.versions?.[index]
    if (!navigation || !v) return navigation
    const tabs = v.tabs?.length ? (v.tabs as NavTabConfig[]) : v.default ? navigation.tabs : []
    return { ...navigation, tabs, dropdowns: v.default ? navigation.dropdowns : [] }
}

/** The switcher's entries: each version opens the page at the same path in it, else its first page. */
export function versionLinks(versions: NavDivision[], items: NavItem[], path: string, active: number): DivisionLink[] {
    const here = clean(path) === '/' ? '' : clean(path)
    const from = versions[active]?.prefix ?? ''
    const rest = from && under(here, from) ? here.slice(from.length) : here
    return versions.flatMap((v, i) => {
        if (v.hidden && i !== active) return []
        const pages = docPages({ items: versionItems(items, versions, i) })
        const target = `${v.prefix ?? ''}${rest}`
        const page = pages.find((p) => same(p.path ?? '', target)) ?? pages[0]
        return [{ key: `v${i}`, name: v.version ?? '', tag: v.tag, page, section: -1, active: i === active }]
    })
}
