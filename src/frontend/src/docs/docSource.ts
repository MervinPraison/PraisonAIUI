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

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

/** Drop a leading YAML frontmatter block. */
export function stripFrontmatter(md: string): string {
    return md.replace(FRONTMATTER, '')
}

const FENCE = /^\s*(`{3,}|~{3,})/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Resolve one relative target against the folder of `docPath` (a /docs/... page path). */
export function resolveDocTarget(target: string, docPath: string): string {
    if (!target || target.startsWith('/') || target.startsWith('#') || SCHEME.test(target) || target.startsWith('//')) {
        return target
    }
    const base = docPath.replace(/\/+$/, '').replace(/[^/]*$/, '')
    let url: URL
    try {
        url = new URL(target, `http://docs.invalid${base || '/'}`)
    } catch {
        return target
    }
    // A link to another page drops `.md`, as the SPA routes have no suffix.
    const path = url.pathname.replace(/\.md$/i, '')
    return path + url.search + url.hash
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
