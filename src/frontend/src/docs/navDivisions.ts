/**
 * Tabs, tab menus, sidebar anchors and the dropdown switcher (ui-config
 * `navigation`, docs/features/navigation.md). Each division with groups is a
 * section with its own sidebar (navTabs.filterNavByTab); its key places it:
 * t0 (first tab), t0.1 (its second menu item), a2 (third anchor), d1, d1.0
 * (a dropdown, that dropdown's first tab).
 */
import type { NavDivision, NavItem, NavTabConfig, NavigationConfig } from '../types'
import { docPages } from './docNav'
import { normalizeDocPath } from '../pathUtils'
import { detectActiveTabIndex, filterNavByTab } from './navTabs'

export interface NavSection extends NavTabConfig {
    key: string
}

/** One tab, menu item, anchor or dropdown as the header and sidebar draw it. */
export interface DivisionLink {
    key: string
    name: string
    icon?: string
    description?: string
    href?: string // a link out (`href`, or a tab's older `url`)
    page?: NavItem // else the first page it opens
    section: number // the index (in navSections) of the section it opens, or -1
    active: boolean
    menu?: DivisionLink[]
    tag?: string // a badge after the name (a version's "Latest")
}

export interface NavDivisions {
    tabs: DivisionLink[]
    anchors: DivisionLink[]
    dropdowns: DivisionLink[]
    /** The version switcher's entries (docs/versions.ts); empty without `navigation.versions`. */
    versions?: DivisionLink[]
    /** Go to the division's first page; `stay` (the phone drawer) only swaps the sidebar. */
    open: (link: DivisionLink, stay?: boolean) => void
}

export const divisionName = (d: NavDivision) => d.tab ?? d.item ?? d.anchor ?? d.dropdown ?? ''

/** Whether the division at `key` is, or holds, the one at `active`. */
export const inDivision = (active: string, key: string) => active === key || active.startsWith(`${key}.`)

/** Every division with groups, depth first. */
export function navSections(navigation?: NavigationConfig): NavSection[] {
    const out: NavSection[] = []
    const walk = (d: NavDivision, key: string) => {
        if (d.groups?.length) out.push({ ...d, tab: divisionName(d), key })
        ;[...(d.menu ?? []), ...(d.tabs ?? [])].forEach((c, i) => walk(c, `${key}.${i}`))
    }
    navigation?.tabs?.forEach((d, i) => walk(d, `t${i}`))
    navigation?.anchors?.forEach((d, i) => walk(d, `a${i}`))
    navigation?.dropdowns?.forEach((d, i) => walk(d, `d${i}`))
    return out
}

/** The pages a section's sidebar shows. */
export const sectionPages = (items: NavItem[], section: NavSection | undefined) =>
    section ? docPages({ items: filterNavByTab(items, section) }) : []

/** The section for `path`: the one the reader last opened (`picked`) while it holds the page,
 *  else the one the URL names (navTabs), else the first whose sidebar holds the page. */
export function activeSection(items: NavItem[], sections: NavSection[], path: string, picked = -1): number {
    const here = normalizeDocPath(path)
    const holds = (i: number) => sectionPages(items, sections[i]).some((p) => normalizeDocPath(p.path ?? '') === here)
    if (holds(picked)) return picked
    const named = detectActiveTabIndex(sections, path)
    if (holds(named)) return named
    const found = sections.findIndex((_, i) => holds(i))
    return found >= 0 ? found : named
}

/** The header tabs (with the active dropdown's own tabs after the top-level ones), anchors and dropdowns. */
export function divisionLinks(navigation: NavigationConfig | undefined, items: NavItem[], sections: NavSection[], activeKey: string) {
    const link = (d: NavDivision, key: string): DivisionLink => {
        let section = -1
        let page: NavItem | undefined
        for (const [i, s] of sections.entries()) {
            if (!inDivision(s.key, key)) continue
            if (section < 0) section = i
            page = sectionPages(items, s)[0]
            if (page) {
                section = i
                break
            }
        }
        return {
            key, name: divisionName(d), icon: d.icon, description: d.description, href: d.href ?? d.url,
            page, section, active: inDivision(activeKey, key), menu: d.menu?.map((m, i) => link(m, `${key}.${i}`)),
        }
    }
    const dropdowns = (navigation?.dropdowns ?? []).map((d, i) => link(d, `d${i}`))
    const open = dropdowns.findIndex((d) => d.active)
    return {
        tabs: [
            ...(navigation?.tabs ?? []).map((d, i) => link(d, `t${i}`)),
            ...(navigation?.dropdowns?.[open]?.tabs ?? []).map((d, j) => link(d, `d${open}.${j}`)),
        ],
        anchors: (navigation?.anchors ?? []).map((d, i) => link(d, `a${i}`)),
        dropdowns,
    }
}
