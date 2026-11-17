/**
 * Guided Studio's navigation model, from the LayoutNav the shell hands the
 * frame (pure: no React, no DOM; guided.test.tsx).
 *
 *   main      the layout's primary pages (Home, Chat, My agents, Templates)
 *             with plain titles, then Help
 *   settings  the settings page, pulled out of the other pages into its own
 *             row at the bottom (Pro: "Settings")
 *   more      every other page, by group, under a folded "More tools"
 *   tabs      the phone's four bottom tabs: Home, Chat, My agents, Help
 *
 * Help opens `layout.options.guided.helpUrl` when the server sets one
 * (YAML `layout: {options: {guided: {helpUrl: …}}}`), else the command
 * palette, so the tab is never a dead end.
 */
import type { LayoutNav, LayoutNavItem } from '@/sdk/layouts'

/** Pages Guided names: its own (start, templates) and the ones it relabels or places. */
export const PAGE = Object.freeze({
  home: 'start',
  chat: 'chat',
  agents: 'agents',
  templates: 'templates',
  sessions: 'sessions',
  settings: 'config',
})

/** Plain titles for pages whose manifest title is technical. */
const PLAIN_TITLES: Readonly<Record<string, string>> = Object.freeze({
  [PAGE.home]: 'Home',
  [PAGE.agents]: 'My agents',
  [PAGE.settings]: 'Settings',
})

export const HELP_ID = 'help'

export interface GuidedItem extends LayoutNavItem {
  /** Help: an external address (opens in a new tab); none: the frame opens the palette. */
  external?: string
}

export interface GuidedNav {
  main: GuidedItem[]
  settings: LayoutNavItem | null
  more: { name: string; items: LayoutNavItem[] }[]
  tabs: GuidedItem[]
  /** Every page the frame can go to, by id, with Guided's plain titles. */
  byId: ReadonlyMap<string, LayoutNavItem>
}

const plain = (item: LayoutNavItem): LayoutNavItem => {
  const title = PLAIN_TITLES[item.id]
  return title ? { ...item, title } : item
}

/** A safe Help address: http(s) or a same-site path; anything else is ignored. */
export function helpAddress(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('/') && !s.startsWith('//')) return s
  return undefined
}

export function guidedNav(nav: LayoutNav, opts: { helpUrl?: string } = {}): GuidedNav {
  const byId = new Map<string, LayoutNavItem>()
  const add = (i: LayoutNavItem) => {
    if (!byId.has(i.id)) byId.set(i.id, plain(i))
  }
  nav.primary.forEach(add)
  nav.groups.forEach((g) => g.items.forEach(add))
  nav.footer.forEach(add)

  const help: GuidedItem = {
    id: HELP_ID,
    title: 'Help',
    group: 'Main',
    href: opts.helpUrl ?? '#',
    active: false,
    ...(opts.helpUrl ? { external: opts.helpUrl } : {}),
  }
  const main: GuidedItem[] = [...nav.primary.filter((i) => i.id !== PAGE.settings).map((i) => byId.get(i.id)!), help]
  const shown = new Set(main.map((i) => i.id))
  const settings = byId.get(PAGE.settings) ?? null
  if (settings) shown.add(settings.id)

  // Groups a plugin declared are drawn on their own (kit DeclaredNavGroups), not under More tools.
  const more = [
    ...nav.groups.filter((g) => !g.declared).map((g) => ({ name: g.name, items: g.items.filter((i) => !shown.has(i.id)) })),
    { name: 'Other', items: nav.footer.filter((i) => !shown.has(i.id)) },
  ].filter((g) => g.items.length > 0)

  const tabOrder = [PAGE.home, PAGE.chat, PAGE.agents]
  const tabs: GuidedItem[] = [
    ...tabOrder.map((id) => byId.get(id)).filter((i): i is LayoutNavItem => !!i),
    help,
  ]
  return { main, settings, more, tabs, byId }
}

const DAY = 86_400_000

/**
 * When a chat was last used, the way a person says it: "Today, 2:14 pm",
 * "Yesterday", "Mon 10 Nov"; '' without a time.
 */
export function whenLabel(ts: number | undefined, now = Date.now(), locale?: string): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  try {
    if (ts >= today) {
      const t = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/i, (_, x: string) => ` ${x.toLowerCase()}m`)
      return `Today, ${t}`
    }
    if (ts >= today - DAY) return 'Yesterday'
    return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '')
  } catch {
    return ''
  }
}
