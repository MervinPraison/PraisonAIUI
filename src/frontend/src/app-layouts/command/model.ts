/**
 * The Command Deck's frame model (pure): the icon rail with its G-prefix
 * keys, the session tabs (⌘1–9), today's usage line and the shortcut list.
 * No React, no DOM.
 */
import type { LayoutNavItem } from '@/sdk/layouts'
import type { RunSummary, SessionSummary } from '@/sdk/layoutTypes'

// ── icon rail ────────────────────────────────────────────────────────

/** Preferred G-prefix letters (G R is Runs in the design); other pages take a free letter of their title. */
const PREFERRED: Record<string, string> = { chat: 'c', runs: 'r', agents: 'a', jobs: 'j', config: 's', settings: 's', sessions: 'e', logs: 'l', knowledge: 'k', cron: 'o', overview: 'h' }

export interface RailItem extends LayoutNavItem {
  /** Second key of the G sequence (`g r`), or undefined when no letter is free. */
  go?: string
}

/** The rail: the primary pages (at most 7), each with a unique G letter. */
export function railItems(primary: readonly LayoutNavItem[]): RailItem[] {
  const used = new Set<string>()
  const take = (c: string | undefined) => {
    if (!c || !/^[a-z]$/.test(c) || used.has(c)) return undefined
    used.add(c)
    return c
  }
  const items = primary.slice(0, 7)
  const out: RailItem[] = items.map((item) => ({ ...item, go: take(PREFERRED[item.id]) }))
  for (const item of out) {
    if (item.go) continue
    for (const ch of item.title.toLowerCase()) {
      const got = take(ch)
      if (got) {
        item.go = got
        break
      }
    }
  }
  return out
}

/** How long the second key of a G sequence may wait (ms). */
export const GO_TIMEOUT_MS = 1500

/**
 * A G-prefix sequence: `press('g')` arms it, the next letter within
 * GO_TIMEOUT_MS returns the matching item (or undefined) and disarms it.
 */
export function createGoSequence(items: () => readonly RailItem[], clock: () => number = Date.now) {
  let armedAt = -Infinity
  return {
    /** True while the key is part of a sequence (the caller prevents its default). */
    press(key: string): { handled: boolean; item?: RailItem } {
      const k = key.toLowerCase()
      const now = clock()
      if (now - armedAt <= GO_TIMEOUT_MS) {
        armedAt = -Infinity
        const item = items().find((i) => i.go === k)
        return { handled: !!item, item }
      }
      if (k === 'g') {
        armedAt = now
        return { handled: true }
      }
      return { handled: false }
    },
    get armed() {
      return clock() - armedAt <= GO_TIMEOUT_MS
    },
    reset() {
      armedAt = -Infinity
    },
  }
}

// ── session tabs ─────────────────────────────────────────────────────

export const MAX_TABS = 9

export interface SessionTab {
  /** null: the new, unsaved chat. */
  id: string | null
  title: string
  active: boolean
  running: boolean
  /** An approval waits in this session. */
  waiting: boolean
  /** 1–9: the ⌘ number. */
  key: number
}

/**
 * The tabs: the newest sessions (the feed's order), at most nine, with the
 * open one always among them (a new chat first; an older session in the
 * last place).
 */
export function sessionTabs(
  sessions: readonly SessionSummary[],
  activeId: string | null,
  runningIds: ReadonlySet<string>,
  waitingIds: ReadonlySet<string> = new Set(),
): SessionTab[] {
  const list: { id: string | null; title: string }[] = sessions.slice(0, MAX_TABS).map((s) => ({ id: s.id, title: s.title }))
  if (activeId === null) {
    list.unshift({ id: null, title: 'New chat' })
    list.length = Math.min(list.length, MAX_TABS)
  } else if (!list.some((t) => t.id === activeId)) {
    const s = sessions.find((x) => x.id === activeId)
    const tab = { id: activeId, title: s?.title ?? 'Chat' }
    if (list.length >= MAX_TABS) list[MAX_TABS - 1] = tab
    else list.push(tab)
  }
  return list.map((t, i) => ({
    id: t.id,
    title: t.title,
    active: t.id === activeId,
    running: t.id !== null && runningIds.has(t.id),
    waiting: t.id !== null && waitingIds.has(t.id),
    key: i + 1,
  }))
}

/** `ses_8f2a91`-style short id for the tab bar. */
export const shortSessionId = (id: string | null | undefined): string => (id ? (id.length > 12 ? id.slice(0, 10) : id) : '')

// ── today's usage (status bar) ───────────────────────────────────────

export interface TodayUsage {
  runs: number
  tokens: number
  cost: number
}

/** Runs started since local midnight, with their tokens and cost summed. */
export function todayUsage(runs: readonly Pick<RunSummary, 'startedAt' | 'tokens' | 'cost'>[], now: number = Date.now()): TodayUsage {
  const d = new Date(now)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = runs.filter((r) => r.startedAt >= midnight && r.startedAt <= now)
  return {
    runs: today.length,
    tokens: today.reduce((n, r) => n + (r.tokens ?? 0), 0),
    cost: Math.round(today.reduce((n, r) => n + (r.cost ?? 0), 0) * 1e6) / 1e6,
  }
}

/** `1 run active · 2 approvals`. */
export function activityText(activeRuns: number, approvals: number): string {
  const runs = `${activeRuns} ${activeRuns === 1 ? 'run' : 'runs'} active`
  return approvals ? `${runs} · ${approvals} ${approvals === 1 ? 'approval' : 'approvals'}` : runs
}

// ── the shortcut sheet (⌘/) ──────────────────────────────────────────

export interface ShortcutRow {
  keys: string[]
  label: string
}

/** Every shortcut of the frame, the bar and the inspector, as keycaps (`mod` → ⌘ or Ctrl). */
export function shortcutRows(rail: readonly RailItem[], mac: boolean): { title: string; rows: ShortcutRow[] }[] {
  const mod = mac ? '⌘' : 'Ctrl'
  return [
    {
      title: 'Anywhere',
      rows: [
        { keys: [mod, 'K'], label: 'Commands and pages' },
        { keys: ['/'], label: 'Focus the command bar' },
        { keys: [mod, 'N'], label: 'New chat' },
        { keys: [mod, '1–9'], label: 'Switch session tab' },
        { keys: [mod, 'I'], label: 'Show or hide the run panel' },
        { keys: [mod, '/'], label: 'All shortcuts' },
      ],
    },
    {
      title: 'Go to',
      rows: rail.filter((r) => r.go).map((r) => ({ keys: ['G', r.go!.toUpperCase()], label: r.title })),
    },
    {
      title: 'Run panel',
      rows: [
        { keys: ['J', 'K'], label: 'Next or previous step' },
        { keys: ['↵'], label: 'Expand the step' },
        { keys: ['A'], label: 'Approve' },
        { keys: ['D'], label: 'Deny' },
        { keys: ['F'], label: 'Files touched' },
        { keys: ['⌃', 'C'], label: 'Stop the run' },
      ],
    },
  ]
}
