/**
 * The navigation model a layout frame receives (ADR 0003 §1.3, LayoutNav).
 * Pure, data only: layout-owned pages and replacements are read from the
 * manifest (`page.layouts`, `page.replaces`), never from ids.
 *
 *   - A page with `layouts` is listed only while one of those layouts is
 *     active (its URL renders under any layout, the classic frame included).
 *   - A page with `replaces: X` stands in for page X while a layout it lists
 *     is active: the nav item at X's place shows it, and `/X` renders it.
 *   - `primary` is the layout's `primary` list (YAML `layout.primary` wins on
 *     the server) intersected with the listed pages, at most 7; everything
 *     else is in `groups` (the "More" list) or `footer`.
 */
import type { LayoutNav, LayoutNavItem } from '@/sdk/layouts'
import type { ShellLayoutSpec, ShellPage } from '@/sdk/manifest'
import { footerPages, groupPages, isFooterPage, type NavGroupsConfig } from './nav'
import { pathForPage } from './router'

/** Id of the main landmark a frame renders (the skip link's target). */
export const MAIN_ID = 'aiui-main'

/** Most primary items a frame gets (the designs show at most 7 destinations). */
export const MAX_PRIMARY = 7

function ownedBy(page: ShellPage, layoutId: string): boolean {
  return !page.layouts || (!!layoutId && page.layouts.includes(layoutId))
}

/** The page standing in for `pageId` under `layoutId`, if one does. */
function replacementFor(pages: readonly ShellPage[], pageId: string, layoutId: string): ShellPage | undefined {
  if (!layoutId || !pageId) return undefined
  return pages.find((p) => p.replaces === pageId && p.id !== pageId && !!p.layouts?.includes(layoutId))
}

/**
 * The page `/<pageId>` renders under `layoutId` ('' = classic): its
 * replacement when one applies, else the manifest page (which may be
 * layout-owned: a URL always renders).
 */
export function resolveRoutePage(
  pages: readonly ShellPage[],
  pageId: string,
  layoutId: string,
): ShellPage | undefined {
  return replacementFor(pages, pageId, layoutId) ?? pages.find((p) => p.id === pageId)
}

/**
 * The pages the nav lists under `layoutId` ('' = classic), in manifest order.
 * A replacement takes the replaced page's id (its URL stays) and its own
 * title and icon; a replacement whose target is not in the manifest is
 * listed as itself.
 */
export function navPagesForLayout(pages: readonly ShellPage[], layoutId: string): ShellPage[] {
  const ids = new Set(pages.map((p) => p.id))
  const out: ShellPage[] = []
  for (const page of pages) {
    if (!ownedBy(page, layoutId)) continue
    const isActiveReplacement = !!page.replaces && !!layoutId && !!page.layouts?.includes(layoutId)
    if (isActiveReplacement && ids.has(page.replaces!) && page.replaces !== page.id) continue
    const stand = replacementFor(pages, page.id, layoutId)
    out.push(stand ? { ...stand, id: page.id, group: page.group, order: page.order } : page)
  }
  return out
}

function toItem(page: ShellPage, activeId: string): LayoutNavItem {
  const item: LayoutNavItem = {
    id: page.id,
    title: page.title,
    group: page.group || 'Other',
    href: pathForPage(page.id),
    active: page.id === activeId,
  }
  if (page.navIcon) item.navIcon = page.navIcon
  if (page.icon) item.icon = page.icon
  return item
}

export interface LayoutNavInput {
  pages: readonly ShellPage[]
  groups: NavGroupsConfig
  /** The active layout's manifest entry. */
  spec: Pick<ShellLayoutSpec, 'id' | 'primary'>
  /** The routed page id (the URL's first segment). */
  activeId: string
  go(pageId: string): void
  /**
   * Group names plugins declared (registerNavGroup, nav_groups()): their
   * groups get `declared: true`, as do the manifest's `groups.shown`.
   */
  declared?: readonly string[]
}

export function buildLayoutNav({ pages, groups, spec, activeId, go, declared = [] }: LayoutNavInput): LayoutNav {
  const listed = navPagesForLayout(pages, spec.id)
  const byId = new Map(listed.map((p) => [p.id, p] as const))
  const primaryIds: string[] = []
  for (const id of spec.primary ?? []) {
    const page = byId.get(id)
    if (!page || isFooterPage(page) || primaryIds.includes(id)) continue
    primaryIds.push(id)
    if (primaryIds.length === MAX_PRIMARY) break
  }
  const rest = listed.filter((p) => !primaryIds.includes(p.id))
  const folded = groups.folded ?? []
  return {
    primary: primaryIds.map((id) => toItem(byId.get(id)!, activeId)),
    groups: groupPages(rest, groups).map((g) => ({
      name: g.name,
      folded: folded.includes(g.name),
      ...(declared.includes(g.name) || groups.shown?.includes(g.name) ? { declared: true } : {}),
      items: g.pages.map((p) => toItem(p, activeId)),
    })),
    footer: footerPages(rest).map((p) => toItem(p, activeId)),
    activeId,
    go,
  }
}
