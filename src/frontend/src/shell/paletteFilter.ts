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
