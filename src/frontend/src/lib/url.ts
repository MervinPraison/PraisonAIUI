/**
 * App paths and browser URLs: the one place the docs app adds or removes the
 * path prefix a site is published under.
 *
 * An app path is what the nav, the manifests and `aiui:navigate` events use:
 * `/docs/guide`, `/docs-nav.json`. A site built with `aiui build --base-path
 * /repo` (a GitHub project site at user.github.io/repo, or example.com/docs
 * behind a proxy) carries `<meta name="aiui-base" content="/repo">`, and its
 * browser URLs are `/repo/docs/guide`. Every fetch, link, history entry and
 * asset URL goes through withBase(); every read of location goes through
 * appPathname() / stripBase(). With no meta the base is '' and both are the
 * identity, so a root site behaves exactly as before.
 *
 * Neither is idempotent on purpose: with base `/docs`, the app path
 * `/docs/x` is the URL `/docs/docs/x`. Call withBase only on app paths and
 * stripBase only on browser paths.
 *
 * The running server reuses this for its root path (`--root-path`, a mount
 * under FastAPI, planned in `cl-subpath`): it writes the same meta, so server
 * pages and static builds share one helper.
 */

const META = 'meta[name="aiui-base"]'

let cached: string | undefined

/** `/repo` for `repo`, `/repo/` or `/repo`; '' for none or `/`. */
export function normalizeBase(raw: string | null | undefined): string {
    const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '')
    return trimmed ? `/${trimmed}` : ''
}

/** The base path of this page ('' at the root), read once from its meta. */
export function basePath(): string {
    if (cached === undefined) {
        const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>(META)
        cached = normalizeBase(meta?.content)
    }
    return cached
}

/** Test hook: use `base` instead of the page's meta (undefined reads the meta again). */
export function setBasePathForTests(base: string | undefined): void {
    cached = base === undefined ? undefined : normalizeBase(base)
}

/** The browser URL of a root-absolute app path; anything else (absolute, `//`, relative, `#`) as it is. */
export function withBase(path: string, base = basePath()): string {
    if (!base || !path.startsWith('/') || path.startsWith('//')) return path
    return base + path
}

/** The app path of a browser path: `/repo/docs/x` -> `/docs/x`, `/repo` -> `/`. Other paths as they are. */
export function stripBase(pathname: string, base = basePath()): string {
    if (!base) return pathname
    if (pathname === base) return '/'
    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname
}

/** The app path of the current page. */
export function appPathname(): string {
    return stripBase(window.location.pathname)
}
