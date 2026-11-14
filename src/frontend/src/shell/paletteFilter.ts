/**
 * Ranking for the ⌘K palette. cmdk's default scorer is a subsequence match,
 * so "log" picked Knowledge (k-n-o-w-L-edge … knOwledGe) over Logs. Here a
 * prefix of the title wins, then a word that starts with the query, then a
 * substring, then a keyword word-prefix (group, description); the fuzzy
 * subsequence score only breaks ties at the bottom.
 */
import { defaultFilter } from 'cmdk'

const WORDS = /[\s\-_/·:]+/

export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  const s = search.trim().toLowerCase()
  if (!s) return 1
  const v = value.toLowerCase()
  if (v.startsWith(s)) return 1
  if (v.split(WORDS).some((w) => w.startsWith(s))) return 0.9
  if (v.includes(s)) return 0.7
  if ((keywords ?? []).some((k) => k.toLowerCase().split(WORDS).some((w) => w.startsWith(s)))) return 0.5
  return defaultFilter(v, s) * 0.4
}

export interface PaletteSection<N = unknown> {
  key: string
  heading: string
  items: { key: string; value: string; keywords?: string[]; node: N }[]
}

/**
 * Order the groups by their best match while a query is typed. cmdk ranks
 * the items inside a group, but its own group ordering never applies (it
 * looks groups up by an internal id), so "log" kept the Agent group (a fuzzy
 * Knowledge) above Settings (an exact Logs). Ties keep the sidebar order.
 */
export function rankSections<S extends PaletteSection>(sections: S[], search: string): S[] {
  if (!search.trim()) return sections
  const best = (s: S) => Math.max(0, ...s.items.map((i) => paletteFilter(i.value, search, i.keywords)))
  return sections
    .map((section, index) => ({ section, index, score: best(section) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.section)
}

