/**
 * What the page-not-found view (DocsNotFound.tsx) does with a URL that has no
 * page: follow a `redirects:` rule from ui-config.json, or suggest the closest
 * pages from the nav. Loaded only on that view, so it adds nothing to a page
 * that exists.
 *
 * `matchRedirect` is the browser copy of `match` in
 * src/praisonaiui/compiler/redirects.py: `:name` matches one path segment and
 * a final `:name*` the rest of the path (none included); the destination
 * reuses the names. A static host has no server rules, so this is what makes
 * a wildcard rule work on GitHub Pages (its 404.html is the app).
 */
import type { NavItem, RedirectRule } from '../types'

const PARAM = /:([A-Za-z_]\w*)(\*)?/g

function norm(path: string): string {
    const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
    return trimmed ? `/${trimmed}` : '/'
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function pattern(source: string): RegExp {
    const src = norm(source)
    let out = ''
    let pos = 0
    for (const m of src.matchAll(PARAM)) {
        const literal = src.slice(pos, m.index)
        out += m[2]
            ? `${escape(literal.replace(/\/+$/, ''))}(?:/(?<${m[1]}>.*))?`
            : `${escape(literal)}(?<${m[1]}>[^/]+)`
        pos = (m.index ?? 0) + m[0].length
    }
    return new RegExp(`^${out}${escape(src.slice(pos))}$`)
}

function expand(destination: string, params: Record<string, string | undefined>): string {
    const out = destination.replace(PARAM, (_, name: string) => params[name] ?? '')
    if (!out.startsWith('/') || out.startsWith('//')) return out
    const cut = out.search(/[?#]/)
    const path = cut < 0 ? out : out.slice(0, cut)
    const rest = cut < 0 ? '' : out.slice(cut)
    return (path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/') + rest
}

/** The destination of the first rule matching `path` (an app path), or null. */
export function matchRedirect(rules: RedirectRule[] | undefined, path: string): string | null {
    const target = norm(path)
    for (const rule of rules ?? []) {
        if (typeof rule?.source !== 'string' || typeof rule.destination !== 'string') continue
        const found = pattern(rule.source).exec(target)
        if (found) return expand(rule.destination, found.groups ?? {})
    }
    return null
}

/** Whether a destination is a path on this site (gets the base path), not a full URL. */
export function isInternal(url: string): boolean {
    return url.startsWith('/') && !url.startsWith('//')
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** Edit distance, for a mistyped last segment (`/docs/instal`). */
function distance(a: string, b: string): number {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const row = [i]
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        prev = row
    }
    return prev[b.length]
}

/**
 * Up to `limit` pages close to a path with no page, best first: the last
 * segment spelled almost the same, then shared words in the path and title.
 * `pages` is the nav in reading order (docPages), so ties keep that order.
 */
export function suggestPages(pages: NavItem[], path: string, limit = 3): NavItem[] {
    const target = norm(path)
    const last = target.split('/').pop() ?? ''
    // A word in every page's path (`docs`) says nothing about which page was meant.
    const paths = pages.filter((p) => p.path).map((p) => new Set(words(p.path ?? '')))
    const wanted = new Set(words(target).filter((w) => !paths.length || !paths.every((p) => p.has(w))))
    const scored: { page: NavItem; score: number }[] = []
    for (const page of pages) {
        if (!page.path || norm(page.path) === target) continue
        const slug = norm(page.path).split('/').pop() ?? ''
        const near = last && slug ? distance(last, slug) : Infinity
        let score = near <= Math.max(1, Math.floor(Math.max(last.length, slug.length) / 4)) ? 4 - Math.min(near, 3) : 0
        const have = new Set([...words(page.path), ...words(page.title)])
        for (const w of wanted) if (have.has(w)) score += w === last ? 2 : 1
        if (score > 0) scored.push({ page, score })
    }
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.page)
}
