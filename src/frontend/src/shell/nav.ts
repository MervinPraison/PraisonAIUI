/**
 * Pure navigation helpers: grouping, ordering, default page, layout flags.
 * No DOM access, so nav.test.ts runs them under plain node.
 */
import type { ShellManifest, ShellPage } from '@/sdk/manifest'

/** Built-in sidebar groups, in display order. Other groups sit before Settings. */
export const GROUP_ORDER = ['Agent', 'Work', 'Control', 'Settings'] as const
const LAST_GROUP = 'Settings'
const DEFAULT_GROUP = 'Other'

/** Pages whose body owns the full viewport height (no padding, no page scroll). */
const FULL_BLEED_IDS = new Set(['chat', 'chat-canvas', 'code-studio', 'explorer'])

type PageWithPosition = ShellPage & { position?: string }

export function isFooterPage(page: ShellPage): boolean {
  return (page as PageWithPosition).position === 'footer'
}

export function isFullBleed(page: ShellPage | undefined, pageId: string): boolean {
  if (page?.kind === 'iframe') return true
  return page?.layout === 'full-bleed' || FULL_BLEED_IDS.has(pageId)
}

function byOrder(a: ShellPage, b: ShellPage): number {
  return (a.order ?? 100) - (b.order ?? 100)
}

function groupRank(group: string): number {
  if (group === LAST_GROUP) return GROUP_ORDER.length + 1
  const i = (GROUP_ORDER as readonly string[]).indexOf(group)
  return i >= 0 ? i : GROUP_ORDER.length // unknown groups: after Control, before Settings
}

export interface NavGroup {
  name: string
  pages: ShellPage[]
}

/**
 * Sidebar groups for the non-footer pages. Pages keep their manifest order
 * within a group (stable sort by `order`); groups follow GROUP_ORDER, unknown
 * groups appear in first-appearance order before Settings.
 */
export function groupPages(pages: readonly ShellPage[]): NavGroup[] {
  const groups = new Map<string, ShellPage[]>()
  for (const p of [...pages].sort(byOrder)) {
    if (isFooterPage(p)) continue
    const name = p.group || DEFAULT_GROUP
    let list = groups.get(name)
    if (!list) groups.set(name, (list = []))
    list.push(p)
  }
  return [...groups.entries()]
    .map(([name, list], appearance) => ({ name, pages: list, rank: groupRank(name), appearance }))
    .sort((a, b) => a.rank - b.rank || a.appearance - b.appearance)
    .map(({ name, pages: list }) => ({ name, pages: list }))
}

/** Pages pinned to the sidebar bottom (`position: 'footer'`, e.g. inspector). */
export function footerPages(pages: readonly ShellPage[]): ShellPage[] {
  return [...pages].sort(byOrder).filter(isFooterPage)
}

/** Every page in sidebar display order (groups first, then footer pages). */
export function orderedPages(pages: readonly ShellPage[]): ShellPage[] {
  return [...groupPages(pages).flatMap((g) => g.pages), ...footerPages(pages)]
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
  return orderedPages(manifest.pages)[0]?.id ?? null
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
