/** Canonical docs path: no trailing slash except root. */
export function normalizeDocPath(path: string): string {
    const cleaned = (path || '/').replace(/\/+$/, '')
    return cleaned || '/'
}

/** Map a docs URL path to a markdown file path (leading slash, .md suffix). */
export function docPathToMarkdown(path: string): string {
    const normalized = normalizeDocPath(path)
    if (normalized === '/') {
        return '/docs/index.md'
    }
    return `${normalized.replace(/\/index$/, '')}.md`
}
