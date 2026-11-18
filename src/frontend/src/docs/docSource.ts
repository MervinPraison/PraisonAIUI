/**
 * Docs page source fixes applied before the markdown renders (Content.tsx).
 *
 * - YAML frontmatter is page metadata (the nav builder reads it): it never
 *   shows as text.
 * - Relative link and image targets resolve against the page's own folder,
 *   the way MkDocs and GitHub read them. A page at /docs/a/b links
 *   `c.md` → /docs/a/c and `../img/x.png` → /docs/img/x.png; without this the
 *   renderer resolved them against the site root (broken images) or refused
 *   them ("[blocked]").
 *
 * Fenced code is never rewritten.
 */

import { normalizeDocPath } from '../pathUtils'
import { withBase } from '../lib/url'

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

/** Drop a leading YAML frontmatter block. */
export function stripFrontmatter(md: string): string {
    return md.replace(FRONTMATTER, '')
}

const FENCE = /^\s*(`{3,}|~{3,})/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Resolve one relative target against the folder of `docPath` (a /docs/... page
 * path). Root-absolute targets and resolved ones come back as browser URLs
 * (with the site's base path, lib/url.ts).
 */
export function resolveDocTarget(target: string, docPath: string): string {
    if (!target || target.startsWith('#') || SCHEME.test(target) || target.startsWith('//')) {
        return target
    }
    if (target.startsWith('/')) return withBase(target)
    const base = docPath.replace(/\/+$/, '').replace(/[^/]*$/, '')
    let url: URL
    try {
        url = new URL(target, `http://docs.invalid${base || '/'}`)
    } catch {
        return target
    }
    // A page link names its route; the docs home page's route is the site root.
    const route = pageRoute(url.pathname)
    return withBase(route !== url.pathname ? canonicalDocPath(route) : route) + url.search + url.hash
}

/**
 * The route of a page link, as `aiui build` names pages (docs_scanner.py
 * `_path_to_slug`): `.md` dropped, `index` / `README` name their folder, and a
 * number prefix at the start of a segment is dropped (`0001-x.md` -> `x`).
 * Other targets (images, files) are returned unchanged.
 */
export function pageRoute(pathname: string): string {
    if (!/\.md$/i.test(pathname)) return pathname
    const route = pathname
        .replace(/\.md$/i, '')
        .replace(/\/(?:index|readme)$/i, '')
        .replace(/(^|\/)\d+-/g, '$1')
    return route || '/'
}

/**
 * The docs page whose markdown a URL shows: the URL itself, or for the site
 * root `/` the docs home page (the nav's `/docs/index` item), or null when the
 * root has no home page.
 */
export function docSourcePath(currentPath: string, homePath?: string | null): string | null {
    const path = currentPath.replace(/\/+$/, '') || '/'
    if (path !== '/') return path
    return homePath ? homePath.replace(/\/+$/, '') || null : null
}

/**
 * Other nav paths a URL the nav does not list may mean: the page route of a
 * file-named URL (`/docs/adr/0001-x` -> `/docs/adr/x`, `/docs/guide/index` ->
 * `/docs/guide`), and the same under the docs base when the URL lacks it
 * (`/getting-started/x` -> `/docs/getting-started/x`). Never the URL itself.
 */
export function docPathAliases(path: string, base = '/docs'): string[] {
    const p = path.replace(/\/+$/, '')
    if (!p || p === '/') return []
    const out: string[] = []
    const add = (candidate: string) => {
        if (candidate && candidate !== p && !out.includes(candidate)) out.push(candidate)
    }
    add(pageRoute(`${p}.md`))
    if (p !== base && !p.startsWith(`${base}/`)) {
        add(`${base}${p}`)
        add(pageRoute(`${base}${p}.md`))
    }
    return out
}

// [text](target "title") and ![alt](target): the target is the first token.
const INLINE_TARGET = /(!?\[(?:[^\]\\]|\\.)*\]\()(\s*)(<[^>]*>|[^)\s]+)/g
// [id]: target  (reference definitions)
const REFERENCE = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)/

function resolveLine(line: string, docPath: string): string {
    const ref = line.match(REFERENCE)
    if (ref) {
        return line.replace(REFERENCE, (_m, head: string, t: string) => head + wrap(t, docPath))
    }
    return line.replace(INLINE_TARGET, (_m, head: string, gap: string, t: string) => head + gap + wrap(t, docPath))
}

function wrap(token: string, docPath: string): string {
    if (token.startsWith('<') && token.endsWith('>')) return `<${resolveDocTarget(token.slice(1, -1), docPath)}>`
    return resolveDocTarget(token, docPath)
}

/** Resolve relative link and image targets in markdown, outside fenced code. */
export function resolveDocUrls(md: string, docPath: string): string {
    let fence: string | null = null
    return md
        .split('\n')
        .map((line) => {
            const f = line.match(FENCE)
            if (f) {
                if (!fence) fence = f[1]
                else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
                return line
            }
            if (fence || (!line.includes('](') && !line.includes(']:'))) return line
            // Leave inline code spans alone.
            return line
                .split(/(`+[^`]*`+)/)
                .map((part, i) => (i % 2 === 1 ? part : resolveLine(part, docPath)))
                .join('')
        })
        .join('\n')
}

/** The source a docs page renders: frontmatter dropped, relative targets resolved. */
export function prepareDocSource(md: string, docPath: string): string {
    return resolveDocUrls(stripFrontmatter(md), docPath)
}

/**
 * The URL a docs path is shown at. The docs home page has one URL, the site
 * root: `/docs`, `/docs/` and `/docs/index` all mean `/` (the compiler
 * publishes it there too: sitemap, llms.txt, canonical links).
 */
export function canonicalDocPath(path: string, base = '/docs'): string {
    const p = normalizeDocPath(path)
    return p === base || p === `${base}/index` ? '/' : p
}

/**
 * Whether a page's Markdown has sections for "On this page" (## to ####
 * headings outside code fences). Lets the phone's folded TOC render in the
 * same frame as the article instead of a frame later (a layout shift).
 */
export function hasSectionHeadings(md: string): boolean {
    let fence: string | null = null
    for (const line of md.split('\n')) {
        const m = /^\s*(`{3,}|~{3,})/.exec(line)
        if (fence) {
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
            continue
        }
        if (m) {
            fence = m[1]
            continue
        }
        if (/^#{2,4}\s+\S/.test(line)) return true
    }
    return false
}
