// Full-text docs search: the index `aiui build` writes (search-index.json,
// compiler/search_index.py) and the ranking the search dialog shows. Pure
// functions plus one cached fetch; imported only by the lazy DocsSearch chunk,
// so it imports nothing of the App's (that would merge the App into this chunk).
import type { NavItem } from '../types'
import { scoreDocMatch } from './searchRank'

/** One section of a page: heading, its anchor, level (1 = the intro) and text. */
export interface IndexSection { h: string; a: string; l: number; x: string }
export interface IndexPage { p: string; t: string; d?: string; s: IndexSection[] }
export interface SearchIndex { version: number; pages: IndexPage[] }

export type ResultKind = 'page' | 'section' | 'text'
export interface SearchResult {
    kind: ResultKind
    page: NavItem
    /** The nav group the page sits in. */
    group: string
    /** Heading of the matched section ('' for the page itself). */
    heading: string
    /** Heading id to open at ('' for the top of the page). */
    anchor: string
    /** Text around the first match (sections and text), else the page's description. */
    snippet: string
    score: number
}

let cached: Promise<SearchIndex | null> | null = null

/**
 * The site's search index, fetched once; null when the site has none (title
 * search only). A network failure is not kept: the next open tries again.
 */
export function loadSearchIndex(url = '/search-index.json'): Promise<SearchIndex | null> {
    cached ??= fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: SearchIndex | null) => (j && Array.isArray(j.pages) ? j : null))
        .catch(() => {
            cached = null
            return null
        })
    return cached
}

/** For tests: forget the cached index. */
export function resetSearchIndexCache(): void {
    cached = null
}

/** pathUtils.normalizeDocPath, kept here so this chunk stays apart from the App's. */
const normalizeDocPath = (path: string) => (path || '/').replace(/\/+$/, '') || '/'

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Every word appears in `text` (case-insensitive). */
function hasAll(text: string, ws: string[]): boolean {
    const t = text.toLowerCase()
    return ws.every((w) => t.includes(w))
}

/** About `width` characters of `text` around the first query word, cut at word edges. */
export function snippetAround(text: string, query: string, width = 140): string {
    if (text.length <= width) return text
    const t = text.toLowerCase()
    const hits = words(query).map((w) => t.indexOf(w)).filter((i) => i >= 0)
    const at = hits.length ? Math.min(...hits) : 0
    let start = Math.max(0, at - Math.floor(width / 3))
    if (start > 0) start = text.indexOf(' ', start) + 1 || start
    let end = Math.min(text.length, start + width)
    if (end < text.length) {
        const space = text.lastIndexOf(' ', end)
        if (space > start) end = space
    }
    return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '')
}

/** Split `text` into plain and matched runs for highlighting (rendered as text, never HTML). */
export function highlightRuns(text: string, query: string): { text: string; hit: boolean }[] {
    const ws = words(query).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    if (!ws.length) return [{ text, hit: false }]
    // A capturing split puts the matches at the odd indices.
    return text
        .split(new RegExp(`(${ws.join('|')})`, 'gi'))
        .map((part, i) => ({ text: part, hit: i % 2 === 1 }))
        .filter((run) => run.text)
}

/**
 * Rank pages, sections and section text for `query`. Titles use the title
 * rank (searchRank.ts); a heading that holds every word ranks next, then a
 * section whose text holds every word. A page appears once per section at
 * most, and `limit` caps the list.
 */
export function searchDocs(
    index: SearchIndex | null,
    groups: { title: string; pages: NavItem[] }[],
    query: string,
    limit = 24,
): SearchResult[] {
    const ws = words(query)
    if (!ws.length) return []
    const byPath = new Map<string, { page: NavItem; group: string }>()
    for (const g of groups) for (const page of g.pages) byPath.set(normalizeDocPath(page.path ?? ''), { page, group: g.title })
    const out: SearchResult[] = []
    const seenPages = new Set<string>()
    for (const [path, { page, group }] of byPath) {
        const s = scoreDocMatch(page.title, group, query)
        if (s > 0) {
            seenPages.add(path)
            out.push({ kind: 'page', page, group, heading: '', anchor: '', snippet: page.description ?? '', score: 2 + s })
        }
    }
    for (const entry of index?.pages ?? []) {
        const path = normalizeDocPath(entry.p)
        const known = byPath.get(path)
        if (!known) continue
        for (const sec of entry.s) {
            if (sec.h && hasAll(sec.h, ws)) {
                const exact = sec.h.toLowerCase().startsWith(ws[0]) ? 0.2 : 0
                out.push({ kind: 'section', page: known.page, group: known.group, heading: sec.h, anchor: sec.a, snippet: snippetAround(sec.x, query), score: 1.5 + exact - sec.l * 0.05 })
            } else if (hasAll(sec.x, ws) || (sec.h && hasAll(`${sec.h} ${sec.x}`, ws))) {
                if (!sec.h && seenPages.has(path)) continue
                out.push({ kind: 'text', page: known.page, group: known.group, heading: sec.h, anchor: sec.a, snippet: snippetAround(sec.x, query), score: 1 - sec.l * 0.05 })
            }
        }
    }
    // One result per page section (a heading may repeat on a page).
    const seen = new Set<string>()
    return out
        .sort((a, b) => b.score - a.score)
        .filter((r) => {
            const key = `${normalizeDocPath(r.page.path ?? '')}#${r.anchor}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .slice(0, limit)
}
