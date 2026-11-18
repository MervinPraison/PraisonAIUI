// Full-text docs search: the index `aiui build` writes (search-index.json,
// compiler/search_index.py) and the ranking the search dialog shows: BM25
// over each section's heading and text, with stems, prefixes and one-typo
// matches (searchRank.ts), tiered page title > heading > text and multiplied
// by the page's (or its nav group's) `boost` within a tier. Pure
// functions plus one cached fetch; imported only by the lazy DocsSearch chunk,
// so it imports nothing of the App's (that would merge the App into this chunk).
import type { NavItem, SearchGroup } from '../types'
import { bestMatch, queryTerms, scoreDocMatch, termMatch, tokenize } from './searchRank'

/** One section of a page: heading, its anchor, level (1 = the intro) and text. */
export interface IndexSection { h: string; a: string; l: number; x: string }
/** A page: path, title, description, sections, frontmatter `keywords` (matched, never shown) and `boost`. */
export interface IndexPage { p: string; t: string; d?: string; s: IndexSection[]; k?: string[]; b?: number }
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

const WORD = /[\p{L}\p{N}]+/gu

/** Whether a word of the page matches any query term. */
const matchesAny = (word: string, terms: string[]) => terms.some((t) => termMatch(t, word.toLowerCase()) > 0)

/** About `width` characters of `text` around the first matching word, cut at word edges. */
export function snippetAround(text: string, query: string, width = 140): string {
    if (text.length <= width) return text
    const terms = queryTerms(query)
    let at = 0
    for (const m of text.matchAll(WORD)) {
        if (matchesAny(m[0], terms)) {
            at = m.index
            break
        }
    }
    let start = Math.max(0, at - Math.floor(width / 3))
    if (start > 0) start = text.indexOf(' ', start) + 1 || start
    let end = Math.min(text.length, start + width)
    if (end < text.length) {
        const space = text.lastIndexOf(' ', end)
        if (space > start) end = space
    }
    return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '')
}

/** Split `text` into plain and matched runs (whole words) for highlighting; rendered as text, never HTML. */
export function highlightRuns(text: string, query: string): { text: string; hit: boolean }[] {
    const terms = queryTerms(query)
    const runs: { text: string; hit: boolean }[] = []
    const push = (text: string, hit: boolean) => text && runs.push({ text, hit })
    let from = 0
    for (const m of text.matchAll(WORD)) {
        if (!terms.length || !matchesAny(m[0], terms)) continue
        push(text.slice(from, m.index), false)
        push(m[0], true)
        from = m.index + m[0].length
    }
    push(text.slice(from), false)
    return runs.length ? runs : [{ text, hit: false }]
}

// BM25 constants (the usual ones) and the weight of a heading's words.
const K1 = 1.2
const B = 0.75
const HEADING_WEIGHT = 2

interface Doc { page: IndexPage; sec: IndexSection; len: number; head: string[] }
interface Prepared { docs: Doc[]; postings: Map<string, Map<number, number>>; avgLen: number }
const preparedIndexes = new WeakMap<SearchIndex, Prepared>()

/** An inverted index over every section (word → section → count), built once per loaded index. */
function prepare(index: SearchIndex): Prepared {
    const cached = preparedIndexes.get(index)
    if (cached) return cached
    const docs: Doc[] = []
    const postings = new Map<string, Map<number, number>>()
    let total = 0
    for (const page of index.pages) {
        for (const sec of page.s) {
            const head = tokenize(sec.h)
            const words = [...Array<string[]>(HEADING_WEIGHT).fill(head).flat(), ...tokenize(sec.x)]
            const id = docs.length
            docs.push({ page, sec, len: words.length, head })
            total += words.length
            for (const w of words) {
                let counts = postings.get(w)
                if (!counts) postings.set(w, (counts = new Map()))
                counts.set(id, (counts.get(id) ?? 0) + 1)
            }
        }
    }
    const prepared = { docs, postings, avgLen: total / Math.max(1, docs.length) || 1 }
    preparedIndexes.set(index, prepared)
    return prepared
}

/** BM25 score of every section holding a word that matches `term` (its best matching word counts). */
function termScores({ docs, postings, avgLen }: Prepared, term: string): Map<number, number> {
    const out = new Map<number, number>()
    for (const [word, counts] of postings) {
        const match = termMatch(term, word)
        if (!match) continue
        const idf = Math.log(1 + (docs.length - counts.size + 0.5) / (counts.size + 0.5))
        for (const [id, tf] of counts) {
            const norm = tf + K1 * (1 - B + (B * docs[id].len) / avgLen)
            const score = (match * idf * tf * (K1 + 1)) / norm
            if (score > (out.get(id) ?? 0)) out.set(id, score)
        }
    }
    return out
}

/** Sections that match every term, with their summed BM25 score. */
function bm25(prepared: Prepared, terms: string[]): Map<number, number> {
    const [first, ...rest] = terms.map((t) => termScores(prepared, t))
    for (const [id, s] of first) {
        const more = rest.map((m) => m.get(id))
        if (more.some((m) => m === undefined)) first.delete(id)
        else first.set(id, more.reduce<number>((a, b) => a + (b ?? 0), s))
    }
    return first
}

/** A score inside its tier: grows with `x`, always below 1, so a tier never overtakes the one above. */
const inTier = (x: number) => x / (x + 1)

export interface SearchOptions {
    /** Most results (default 24). */
    limit?: number
    /** Only pages of this header tab (groups carry their tab; docNav.docSearchGroups). */
    tab?: string
}

/**
 * Rank pages, sections and section text for `query`. A page whose title (or
 * keyword) matches ranks first, then a section whose heading holds every
 * word, then a section whose text does. A page's `boost` (else its nav
 * group's) multiplies its score within a tier. A page appears once per
 * section at most, and `limit` caps the list.
 */
export function searchDocs(
    index: SearchIndex | null,
    groups: SearchGroup[],
    query: string,
    { limit = 24, tab }: SearchOptions = {},
): SearchResult[] {
    const terms = queryTerms(query)
    if (!terms.length) return []
    const entries = new Map((index?.pages ?? []).map((e) => [normalizeDocPath(e.p), e]))
    const byPath = new Map<string, { page: NavItem; group: string; boost: number }>()
    for (const g of groups) {
        if (tab && g.tab !== tab) continue
        for (const page of g.pages) {
            const path = normalizeDocPath(page.path ?? '')
            byPath.set(path, { page, group: g.title, boost: entries.get(path)?.b ?? g.boost ?? 1 })
        }
    }
    const out: SearchResult[] = []
    const seenPages = new Set<string>()
    for (const [path, { page, group, boost }] of byPath) {
        const s = scoreDocMatch(page.title, group, query, entries.get(path)?.k)
        if (s > 0) {
            seenPages.add(path)
            out.push({ kind: 'page', page, group, heading: '', anchor: '', snippet: page.description ?? '', score: 3 + inTier(2 * s * boost) })
        }
    }
    if (index) {
        const prepared = prepare(index)
        for (const [id, score] of bm25(prepared, terms)) {
            const { page: entry, sec, head } = prepared.docs[id]
            const path = normalizeDocPath(entry.p)
            const known = byPath.get(path)
            if (!known) continue
            const inHeading = sec.h !== '' && terms.every((t) => bestMatch(t, head) > 0)
            if (!inHeading && !sec.h && seenPages.has(path)) continue
            out.push({
                kind: inHeading ? 'section' : 'text',
                page: known.page,
                group: known.group,
                heading: sec.h,
                anchor: sec.a,
                snippet: snippetAround(sec.x, query),
                score: (inHeading ? 2 : 1) + inTier(score * known.boost),
            })
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
