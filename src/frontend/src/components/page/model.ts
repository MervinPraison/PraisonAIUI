/**
 * Pure logic of the page templates (components/page): list keyboard
 * selection, board moves, log filtering and search. No React, no DOM, so it
 * is unit tested directly and shared by the templates.
 */

// ── list + detail ───────────────────────────────────────────────────

/**
 * The row id after moving `delta` rows from `current` (clamped to the list).
 * With nothing selected, down picks the first row and up the last.
 */
export function moveSelection(ids: readonly string[], current: string | null | undefined, delta: number): string | null {
  if (ids.length === 0) return null
  const at = current == null ? -1 : ids.indexOf(current)
  if (at === -1) return delta >= 0 ? ids[0] : ids[ids.length - 1]
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))]
}

/** "1–8 of 42" for a page of a list (1-based `page`). */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const p = Math.min(Math.max(1, page), pages)
  if (total === 0) return { from: 0, to: 0, pages }
  return { from: (p - 1) * pageSize + 1, to: Math.min(total, p * pageSize), pages }
}

// ── board ───────────────────────────────────────────────────────────

export interface MovableColumn<C extends { id: string }> {
  id: string
  cards: readonly C[]
}

/** Where a card is: column index and position, or null. */
export function findCard<C extends { id: string }>(
  columns: readonly MovableColumn<C>[],
  cardId: string,
): { col: number; index: number } | null {
  for (let col = 0; col < columns.length; col++) {
    const index = columns[col].cards.findIndex((c) => c.id === cardId)
    if (index !== -1) return { col, index }
  }
  return null
}

/**
 * The columns with `cardId` moved to `toColumn` at `index` (clamped). Returns
 * the input unchanged when the card or column is unknown or nothing moves.
 */
export function moveCard<C extends { id: string }, K extends MovableColumn<C>>(
  columns: readonly K[],
  cardId: string,
  toColumn: string,
  index: number,
): readonly K[] {
  const from = findCard(columns, cardId)
  const to = columns.findIndex((c) => c.id === toColumn)
  if (!from || to === -1) return columns
  const card = columns[from.col].cards[from.index]
  const without = columns.map((c, i) =>
    i === from.col ? { ...c, cards: c.cards.filter((_, j) => j !== from.index) } : c,
  )
  const target = without[to].cards
  const at = Math.min(Math.max(0, index), target.length)
  if (from.col === to && at === from.index) return columns
  return without.map((c, i) => (i === to ? { ...c, cards: [...target.slice(0, at), card, ...target.slice(at)] } : c))
}

/** A card being moved with the keyboard: where it would drop. */
export interface GrabState {
  cardId: string
  col: number
  index: number
}

/**
 * The next drop position for an arrow key while a card is picked up.
 * Left/right change column (keeping the position, clamped to the end);
 * up/down move within the target column. `sizes` are the column card counts
 * without the grabbed card.
 */
export function stepGrab(state: GrabState, key: string, sizes: readonly number[]): GrabState {
  let { col, index } = state
  if (key === 'ArrowLeft') col = Math.max(0, col - 1)
  else if (key === 'ArrowRight') col = Math.min(sizes.length - 1, col + 1)
  else if (key === 'ArrowUp') index -= 1
  else if (key === 'ArrowDown') index += 1
  else return state
  index = Math.min(Math.max(0, index), sizes[col] ?? 0)
  return { ...state, col, index }
}

// ── log viewer ──────────────────────────────────────────────────────

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** A level name from any logger spelling (WARNING, err, CRITICAL, trace…). */
export function normalizeLevel(level: unknown): LogLevel {
  const s = String(level ?? '').toLowerCase()
  if (s.startsWith('err') || s === 'critical' || s === 'fatal') return 'error'
  if (s.startsWith('warn')) return 'warn'
  if (s === 'debug' || s === 'trace' || s === 'verbose') return 'debug'
  return 'info'
}

export function countLevels<E extends { level: unknown }>(entries: readonly E[]): Record<LogLevel, number> {
  const out: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const e of entries) out[normalizeLevel(e.level)] += 1
  return out
}

/** Case-insensitive text match of a log entry (message and source). */
export function entryMatches(entry: { message: string; source?: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return entry.message.toLowerCase().includes(q) || (entry.source ?? '').toLowerCase().includes(q)
}

/** The entries to show: enabled levels, and only matches when `onlyMatches`. */
export function filterEntries<E extends { level: unknown; message: string; source?: string }>(
  entries: readonly E[],
  enabled: ReadonlySet<LogLevel>,
  query: string,
  onlyMatches: boolean,
): E[] {
  return entries.filter(
    (e) => enabled.has(normalizeLevel(e.level)) && (!onlyMatches || !query.trim() || entryMatches(e, query)),
  )
}

/** `text` split into plain and matching parts (case-insensitive), for <mark>. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim()
  if (!q) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { text: string; match: boolean }[] = []
  let at = 0
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
    if (i > at) parts.push({ text: text.slice(at, i), match: false })
    parts.push({ text: text.slice(i, i + needle.length), match: true })
    at = i + needle.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false })
  return parts.length ? parts : [{ text, match: false }]
}

/** Step through matches: the next index (wrapping), or -1 with none. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1
  if (current < 0) return delta >= 0 ? 0 : total - 1
  return (((current + delta) % total) + total) % total
}

// ── gallery / tabs ──────────────────────────────────────────────────

/** Roving focus in a tab list: the tab id after an arrow, Home or End key. */
export function stepTab(ids: readonly string[], current: string, key: string): string {
  if (ids.length === 0) return current
  const at = Math.max(0, ids.indexOf(current))
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(at + 1) % ids.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(at - 1 + ids.length) % ids.length]
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  return current
}

/** A one- or two-letter monogram for a tile ("GitHub Toolkit" → "GT"). */
export function monogram(title: string): string {
  const words = title.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]
  return letters.toUpperCase()
}

/** The edges of a box, as getBoundingClientRect() gives them. */
export interface Edges {
  top: number
  bottom: number
}

/**
 * True when `panel` sits under `main` (the stacked phone layout) rather than
 * beside it. Half a pixel of slack absorbs sub-pixel layout.
 */
export function isStackedBelow(panel: Edges, main: Edges): boolean {
  return panel.top >= main.bottom - 0.5
}
