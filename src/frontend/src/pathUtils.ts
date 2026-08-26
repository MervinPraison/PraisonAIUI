/** Canonical docs path: no trailing slash except root. */
export function normalizeDocPath(path: string): string {
    const cleaned = (path || '/').replace(/\/+$/, '')
    return cleaned || '/'
}

/** Normalise an internal docs href for SEO-friendly crawlable links. */
export function normalizeDocHref(href: string): string {
    if (!href || href.startsWith('#')) return href
    try {
        const url = new URL(href, window.location.origin)
        if (url.origin !== window.location.origin) return href
        return normalizeDocPath(url.pathname) + url.search + url.hash
    } catch {
        return href
    }
}

export function isInternalDocHref(href?: string): boolean {
    if (!href || href.startsWith('#')) return false
    if (href.startsWith('/docs')) return true
    try {
        const url = new URL(href, window.location.origin)
        return url.origin === window.location.origin && url.pathname.startsWith('/docs')
    } catch {
        return false
    }
}

/** Map a docs URL path to a markdown file path (leading slash, .md suffix). */
export function docPathToMarkdown(path: string): string {
    const normalized = normalizeDocPath(path)
    if (normalized === '/') {
        return '/docs/index.md'
    }
    return `${normalized}.md`
}
