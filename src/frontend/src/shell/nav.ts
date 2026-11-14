/**
 * Pure navigation helpers: grouping, ordering, default page, layout flags.
 * No DOM access, so nav.test.ts runs them under plain node.
 */
import type { ShellManifest, ShellPage } from '@/sdk/manifest'

const DEFAULT_GROUP = 'Other'

/**
 * How the sidebar arranges its groups (manifest `layout.groups`, which the
 * server fills from builtin/catalog.py NAV_GROUPS and set_dashboard(groups=)):
 * `order` lists groups first, in that order; other groups follow in
 * first-appearance order; `last` is pinned at the end. `folded` groups start
 * collapsed. Without it, groups keep first-appearance order and none is folded.
 */
export interface NavGroupsConfig {
  order?: readonly string[]
  last?: string
  folded?: readonly string[]
}

function stringList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
}

/** The manifest's `layout.groups`, with anything malformed dropped. */
export function navGroups(manifest: Pick<ShellManifest, 'layout'>): NavGroupsConfig {
  const raw = (manifest.layout as Record<string, unknown> | undefined)?.groups
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const g = raw as Record<string, unknown>
  const out: NavGroupsConfig = {}
  const order = stringList(g.order)
  const folded = stringList(g.folded)
  if (order) out.order = order
  if (folded) out.folded = folded
  if (typeof g.last === 'string' && g.last) out.last = g.last
  return out
}

type PageWithPosition = ShellPage & { position?: string }

export function isFooterPage(page: ShellPage): boolean {
  return (page as PageWithPosition).position === 'footer'
}

/**
 * Whether a page's body owns the full viewport height (no padding, no page
 * scroll): iframes, and pages whose manifest entry says `layout: 'full-bleed'`
 * (the server sets it for chat, chat-canvas and code-studio). Never by id.
 */
export function isFullBleed(page: Pick<ShellPage, 'kind' | 'layout'> | undefined): boolean {
  return page?.kind === 'iframe' || page?.layout === 'full-bleed'
}

/** Kinds the shell renders itself; every other kind goes to the legacy view host. */
const HOSTED_KINDS: ReadonlySet<string> = new Set(['blocks', 'iframe', 'react'])

/** True when an unregistered page of this kind is rendered by LegacyViewHost. */
export function usesLegacyHost(page: Pick<ShellPage, 'kind'>): boolean {
  return !HOSTED_KINDS.has(page.kind)
}

/**
 * Whether warming the legacy runtime (dashboard.js) is worth it: some page
 * would be rendered by the legacy host, or the app ships a custom.js (which
 * only the legacy runtime evaluates). `isRegistered` reports pages a React
 * component is registered for; those never reach the legacy host.
 */
export function needsLegacyRuntime(
  manifest: Pick<ShellManifest, 'pages' | 'legacy'>,
  isRegistered: (pageId: string) => boolean = () => false,
): boolean {
  if (manifest.legacy.customJs) return true
  return manifest.pages.some((p) => usesLegacyHost(p) && !isRegistered(p.id))
}

function byOrder(a: ShellPage, b: ShellPage): number {
  return (a.order ?? 100) - (b.order ?? 100)
}

function groupRank(group: string, groups: NavGroupsConfig): number {
  const order = groups.order ?? []
  if (groups.last && group === groups.last) return order.length + 1
  const i = order.indexOf(group)
  return i >= 0 ? i : order.length // other groups: after the ordered ones, before `last`
}

export interface NavGroup {
  name: string
  pages: ShellPage[]
}

/**
 * Sidebar groups for the non-footer pages. Pages keep their manifest order
 * within a group (stable sort by `order`); groups are arranged by `groups`
 * (see NavGroupsConfig), else in first-appearance order.
 */
export function groupPages(pages: readonly ShellPage[], groups: NavGroupsConfig = {}): NavGroup[] {
  const byGroup = new Map<string, ShellPage[]>()
  for (const p of [...pages].sort(byOrder)) {
    if (isFooterPage(p)) continue
    const name = p.group || DEFAULT_GROUP
    let list = byGroup.get(name)
    if (!list) byGroup.set(name, (list = []))
    list.push(p)
  }
  return [...byGroup.entries()]
    .map(([name, list], appearance) => ({ name, pages: list, rank: groupRank(name, groups), appearance }))
    .sort((a, b) => a.rank - b.rank || a.appearance - b.appearance)
    .map(({ name, pages: list }) => ({ name, pages: list }))
}

/** Pages pinned to the sidebar bottom (`position: 'footer'`, e.g. inspector). */
export function footerPages(pages: readonly ShellPage[]): ShellPage[] {
  return [...pages].sort(byOrder).filter(isFooterPage)
}

/** Every page in sidebar display order (groups first, then footer pages). */
export function orderedPages(pages: readonly ShellPage[], groups: NavGroupsConfig = {}): ShellPage[] {
  return [...groupPages(pages, groups).flatMap((g) => g.pages), ...footerPages(pages)]
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/**
 * The page `/` redirects to: a configured default (`layout.default`,
 * `layout.defaultPage` or `site.defaultPage`) when it names a known page,
 * else the first page in sidebar order.
 */
export function defaultPageId(manifest: Pick<ShellManifest, 'pages' | 'layout' | 'site'>): string | null {
  const ids = new Set(manifest.pages.map((p) => p.id))
  const layout = manifest.layout as Record<string, unknown>
  const configured =
    stringField(layout, 'default', 'defaultPage') ?? stringField(manifest.site, 'defaultPage', 'default_page')
  if (configured && ids.has(configured)) return configured
  return orderedPages(manifest.pages, navGroups(manifest))[0]?.id ?? null
}

/** `layout.sidebar: false` (set_dashboard(sidebar=False)) hides the sidebar. */
export function showSidebar(manifest: Pick<ShellManifest, 'layout'>): boolean {
  return manifest.layout.sidebar !== false
}

/** `layout.pageHeader: false` (set_dashboard(page_header=False)) hides the header bar. */
export function showPageHeader(manifest: Pick<ShellManifest, 'layout'>): boolean {
  return manifest.layout.pageHeader !== false
}

export function siteTitle(manifest: Pick<ShellManifest, 'site'>): string {
  return stringField(manifest.site, 'title') ?? 'PraisonAI'
}

/** `site.logo`: an image URL/path, or a short text/emoji mark. */
export function siteLogo(manifest: Pick<ShellManifest, 'site'>): { kind: 'img' | 'text'; value: string } | null {
  const logo = stringField(manifest.site, 'logo')
  if (!logo) return null
  if (/^(https?:|data:image\/|\/)/.test(logo)) return { kind: 'img', value: logo }
  return logo.length <= 8 ? { kind: 'text', value: logo } : null
}

interface Box {
  top: number
  bottom: number
}

/**
 * Scroll `scroller` just enough to show `el` (the active sidebar link).
 * Deliberately not el.scrollIntoView(): Chromium moves the sequential focus
 * navigation starting point to the scrolled element, so after a deep link the
 * first Tab would skip "Skip to content" and land after the active link.
 */
export function revealInScroller(
  scroller: { scrollTop: number; getBoundingClientRect(): Box },
  el: { getBoundingClientRect(): Box },
  pad = 8,
): void {
  const box = scroller.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < box.top) scroller.scrollTop -= box.top - r.top + pad
  else if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom + pad
}

// ── collapsible sidebar groups ─────────────────────────────────────────

export const GROUP_STATE_KEY = 'aiui-sidebar-groups'

/**
 * Is a sidebar group expanded? The group of the current page always is.
 * `stored` maps group name → open, as the viewer left it; otherwise a group
 * starts folded when it is in `folded` (manifest `layout.groups.folded`).
 */
export function isGroupOpen(
  name: string,
  hasActivePage: boolean,
  stored: Readonly<Record<string, boolean>>,
  folded: readonly string[] = [],
): boolean {
  if (hasActivePage) return true
  if (Object.prototype.hasOwnProperty.call(stored, name)) return stored[name] === true
  return !folded.includes(name)
}

export function readGroupState(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Record<string, boolean> {
  try {
    const raw = storage?.getItem(GROUP_STATE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function writeGroupState(state: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(GROUP_STATE_KEY, JSON.stringify(state))
  } catch {
    /* per-viewer convenience only */
  }
}
