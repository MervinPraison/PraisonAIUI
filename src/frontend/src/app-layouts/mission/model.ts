/**
 * Mission Control's frame model (pure; mission.test.ts): which page fills
 * the frame, the nav counts, the phone tabs and the frame shortcuts.
 */
import type { LayoutNav, LayoutNavItem } from '@/sdk/layouts'
import type { ShellLayoutSpec, ShellPage } from '@/sdk/manifest'

/** The chat page the ops column sits beside, and New chat opens. */
export const CHAT_PAGE = 'chat'
/** The page that lists every approval (the Review link, the bell). */
export const APPROVALS_PAGE = 'approvals'
/** The run history page ("Open runs" in the chat header). */
export const RUNS_PAGE = 'runs'
/** The catalog page standing in for `overview` while Mission is on screen (`replaces: overview`). */
export const OPS_PAGE = 'ops-overview'
/** Mission's home when the manifest does not say (the catalog record: `home="overview"`). */
export const DEFAULT_HOME = 'overview'

/** Phone bottom tabs: the first primary destinations, then More (design: Overview, Agents, Approvals, Chat, More). */
export const PHONE_TABS = 4

export const SHORTCUTS = Object.freeze({
  /** Start a new chat and open it. */
  newChat: 'mod+n',
  /** Move focus to the waiting approval's Approve button. */
  approval: 'mod+j',
})

export function missionSpec(available: readonly ShellLayoutSpec[], id: string): ShellLayoutSpec | undefined {
  return available.find((s) => s.id === id)
}

/** `layout.options.mission.environment` ("prod", "staging"), trimmed to 16 characters. */
export function environmentOf(spec: Pick<ShellLayoutSpec, 'options'> | undefined): string | undefined {
  const v = spec?.options?.environment
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 16) : undefined
}

export type FrameContent = 'ops' | 'chat' | 'page'

/**
 * What the frame shows for the routed page: the ops overview (the
 * `ops-overview` page, or Mission's home while no catalog page replaces
 * it), the chat with the ops column beside it, or any other page.
 */
export function frameContent(pageId: string, page: Pick<ShellPage, 'id' | 'replaces'> | undefined, home: string): FrameContent {
  if (page?.id === OPS_PAGE) return 'ops'
  if (pageId === home && !page?.replaces) return 'ops'
  return (page?.id ?? pageId) === CHAT_PAGE ? 'chat' : 'page'
}

export interface NavCounts {
  agents?: number
  runs?: number
  approvals: number
}

/** The count at a nav row's end: agents and runs today in mono, waiting approvals as a warning badge. */
export function navCount(item: Pick<LayoutNavItem, 'id'>, counts: NavCounts): { value: number; warn: boolean; label: string } | null {
  if (item.id === APPROVALS_PAGE) return counts.approvals > 0 ? { value: counts.approvals, warn: true, label: `${counts.approvals} waiting` } : null
  if (item.id === 'agents' && counts.agents) return { value: counts.agents, warn: false, label: `${counts.agents} agents` }
  if (item.id === RUNS_PAGE && counts.runs) return { value: counts.runs, warn: false, label: `${counts.runs} runs today` }
  return null
}

/** The phone's tabs (the first primary items) and what goes behind More (the rest). */
export function phoneNav(nav: Pick<LayoutNav, 'primary' | 'groups' | 'footer'>): {
  tabs: readonly LayoutNavItem[]
  more: readonly LayoutNavItem[]
  groups: LayoutNav['groups']
} {
  return { tabs: nav.primary.slice(0, PHONE_TABS), more: [...nav.primary.slice(PHONE_TABS), ...nav.footer], groups: nav.groups }
}

/** Whether any nav list holds `pageId`. */
export function hasPage(nav: Pick<LayoutNav, 'primary' | 'groups' | 'footer'>, pageId: string): boolean {
  return [...nav.primary, ...nav.footer, ...nav.groups.flatMap((g) => g.items)].some((i) => i.id === pageId)
}

export type HealthState = 'ok' | 'degraded' | 'unknown'

/**
 * The nav groups Mission lists under its primary pages: the ones an operator
 * works in (Control: logs, jobs, traces; Settings), plus whichever group
 * holds the page on screen, opened. Every other page is one search away
 * (More pages, ⌘K), so the sidebar is not six folded headings.
 */
export const MISSION_GROUPS: readonly string[] = ['control', 'settings']

export function missionGroups(groups: LayoutNav['groups']): { name: string; folded: boolean; items: LayoutNav['groups'][number]['items'] }[] {
  return groups
    .map((g) => ({ ...g, active: g.items.some((i) => i.active) }))
    .filter((g) => g.items.length && (g.active || MISSION_GROUPS.includes(g.name.toLowerCase())))
    .map(({ active, ...g }) => ({ ...g, folded: !active }))
}

/** `/api/provider/health` → the top bar's pill: the one status word Mission shows ("Connected", as every layout says it). */
export function healthOf(body: unknown): { state: HealthState; label: string; agents?: number } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const status = typeof b.status === 'string' ? b.status.toLowerCase() : ''
  const agents = typeof b.agents === 'number' ? b.agents : undefined
  if (status === 'ok' || status === 'healthy') return { state: 'ok', label: 'Connected', agents }
  if (!status || status === 'unknown') return { state: 'unknown', label: 'Status unknown', agents }
  return { state: 'degraded', label: 'Provider degraded', agents }
}
