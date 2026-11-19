// The split search index `aiui build` writes beside search-index.json
// (compiler/search_index.py write_shards), so the search dialog downloads only
// what a query needs: search-index/meta.json (pages, section headings and word
// counts, the sorted word list) on first open, then the word files a query's
// words fall in and the section text of the pages it lists. Ranking runs
// through searchIndex.ts on the parts loaded, so it matches the whole file
// exactly. A site without the folder, or a part that fails (a newer deploy
// removed it), falls back to search-index.json. Lazy DocsSearch chunk only.
import { loadSearchIndex, prepare, type Doc, type IndexPage, type PartialIndex, type Prepared, type SearchIndex } from './searchIndex'
import { termMatch, tokenize } from './searchRank'

/** compiler/search_index.py SHARDS_DIR and SHARDS_VERSION. */
const DIR = 'search-index'
const VERSION = 2

/** search-index/meta.json: sections are [heading, anchor, word count]; `shards[n]` is word file n's first word. */
export interface ShardMeta {
    version: number
    key: string
    pages: { p: string; k?: string[]; b?: number; s: [string, string, number][] }[]
    words: string[]
    shards: number[]
}

type FetchJson = (url: string) => Promise<unknown>

const fetchJson: FetchJson = async (url) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
}

/** `"<gap>[:<count>],…"` (base 36, compiler/search_index.py _postings) → section id → count. */
export function decodePostings(text: string): Map<number, number> {
    const out = new Map<number, number>()
    let id = 0
    for (const part of text.split(',')) {
        const [gap, tf] = part.split(':')
        id += parseInt(gap, 36)
        out.set(id, tf ? parseInt(tf, 36) : 1)
    }
    return out
}

function isMeta(value: unknown): value is ShardMeta {
    const m = value as ShardMeta | null
    return !!m && m.version === VERSION && typeof m.key === 'string' && Array.isArray(m.pages) && Array.isArray(m.words) && Array.isArray(m.shards)
}

export class ShardedIndex implements PartialIndex {
    readonly version = VERSION
    pages: IndexPage[]
    private readonly docs: Doc[] = []
    private readonly avgLen: number
    private readonly postings = new Map<string, Map<number, number>>()
    private readonly pageAt = new Map<string, number>()
    /** Word file or page text URL → its load (true once in). */
    private readonly parts = new Map<string, Promise<boolean>>()
    private readonly done = new Set<string>()
    private readonly matches = new Map<string, number[]>()
    /** search-index.json, once a part failed. */
    private full: SearchIndex | null = null
    private fallingBack: Promise<boolean> | null = null

    private readonly meta: ShardMeta
    private readonly dir: string
    private readonly fullUrl: string
    private readonly get: FetchJson

    /** `dir`: the URL of the key's folder (ends in /); `fullUrl`: search-index.json, the fallback. */
    constructor(meta: ShardMeta, dir: string, fullUrl: string, get: FetchJson = fetchJson) {
        this.meta = meta
        this.dir = dir
        this.fullUrl = fullUrl
        this.get = get
        let total = 0
        this.pages = meta.pages.map((m, i) => {
            const page: IndexPage = { p: m.p, t: '', s: m.s.map(([h, a]) => ({ h, a, l: 0, x: '' })), ...(m.k ? { k: m.k } : {}), ...(m.b ? { b: m.b } : {}) }
            page.s.forEach((sec, j) => {
                const len = m.s[j][2]
                this.docs.push({ page, sec, len, head: tokenize(sec.h) })
                total += len
            })
            this.pageAt.set(m.p, i)
            return page
        })
        this.avgLen = total / Math.max(1, this.docs.length) || 1
    }

    /** The word files holding the words `terms` match (each word list is scanned once per query). */
    private shardsFor(terms: string[]): number[] {
        const key = terms.join(' ')
        let found = this.matches.get(key)
        if (!found) {
            const { words, shards } = this.meta
            const set = new Set<number>()
            let shard = 0
            words.forEach((word, i) => {
                while (shard + 1 < shards.length && shards[shard + 1] <= i) shard += 1
                if (!set.has(shard) && terms.some((t) => termMatch(t, word) > 0)) set.add(shard)
            })
            found = [...set]
            this.matches.set(key, found)
        }
        return found
    }

    private wordUrl = (n: number) => `${this.dir}w${n}.json`
    private textUrl = (i: number) => `${this.dir}p${i}.json`

    /** Load one part once; a failure switches to search-index.json. */
    private part(url: string, apply: (data: unknown) => void): Promise<boolean> {
        let p = this.parts.get(url)
        if (!p) {
            p = this.get(url).then(
                (data) => {
                    apply(data)
                    this.done.add(url)
                    return true
                },
                () => this.fallBack(),
            )
            this.parts.set(url, p)
        }
        return p
    }

    private fallBack(): Promise<boolean> {
        this.fallingBack ??= this.get(this.fullUrl).then(
            (full) => {
                this.full = full && Array.isArray((full as SearchIndex).pages) ? (full as SearchIndex) : null
                return Boolean(this.full)
            },
            () => false,
        )
        return this.fallingBack
    }

    /** Whether every word file `terms` need is in (or the whole index is). */
    ready(terms: string[]): boolean {
        return Boolean(this.full) || this.shardsFor(terms).every((n) => this.done.has(this.wordUrl(n)))
    }

    /** Load the word files `terms` need; true when anything new arrived (search again). */
    async need(terms: string[]): Promise<boolean> {
        if (this.full || !terms.length) return false
        const todo = this.shardsFor(terms).filter((n) => !this.done.has(this.wordUrl(n)))
        const loaded = await Promise.all(todo.map((n) => this.part(this.wordUrl(n), (data) => {
            const start = this.meta.shards[n]
            ;(data as string[]).forEach((text, j) => this.postings.set(this.meta.words[start + j], decodePostings(text)))
        })))
        return loaded.some(Boolean)
    }

    /** Load the section text of the pages at `paths` (for snippets); true when anything new arrived. */
    async needText(paths: string[]): Promise<boolean> {
        if (this.full) return false
        const todo = [...new Set(paths)].map((p) => this.pageAt.get(p)).filter((i): i is number => i !== undefined && !this.done.has(this.textUrl(i)))
        const loaded = await Promise.all(todo.map((i) => this.part(this.textUrl(i), (data) => {
            ;(data as string[]).forEach((x, j) => { if (this.pages[i].s[j]) this.pages[i].s[j].x = x })
        })))
        return loaded.some(Boolean)
    }

    prepared(terms: string[]): Prepared | null {
        if (this.full) return prepare(this.full)
        return this.ready(terms) ? { docs: this.docs, postings: this.postings, avgLen: this.avgLen } : null
    }
}

let opened: Promise<SearchIndex | ShardedIndex | null> | null = null

/**
 * The site's search index: the split one when the site has it, else
 * search-index.json (`url`), else null (title search only). Opened once; a
 * failure is not kept, so the next open tries again.
 */
export function openSearchIndex(url = '/search-index.json', get: FetchJson = fetchJson): Promise<SearchIndex | ShardedIndex | null> {
    const base = url.slice(0, url.lastIndexOf('/') + 1)
    opened ??= get(`${base}${DIR}/meta.json`)
        .then((meta) => (isMeta(meta) ? new ShardedIndex(meta, `${base}${DIR}/${meta.key}/`, url, get) : loadSearchIndex(url)))
        .catch(() => loadSearchIndex(url))
        .then((index) => {
            if (!index) opened = null
            return index
        })
    return opened
}

/** For tests: forget the opened index. */
export function resetOpenedIndex(): void {
    opened = null
}
