/**
 * What a docs site shows when the URL names no page: "Page not found" with a
 * way home and to search, or, at the site root of a site without a home page
 * (docs/index.md), the site title and description. Never the developer view
 * (Content.tsx keeps that for `debug: true`).
 *
 * `errors.404` in aiui.yaml sets the heading and a Markdown description, or
 * `redirect: true` sends readers home. A `redirects:` rule that matches the
 * URL is followed (a static host has no server rules for wildcards), and
 * otherwise the closest pages in the nav are offered. That logic lives in
 * docs/redirects.ts, loaded only here.
 */
import { useEffect, useState, type MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { DocsNav, NavItem, UIConfig } from '../types'
import { Markdown } from '../markdown/LazyMarkdown'
import { withBase } from '../lib/url'
import { docPages } from './docNav'

interface DocsNotFoundProps {
    config: UIConfig
    /** The URL path that matched no page. */
    path: string
    /** Opens the docs search, when the site has search. */
    onSearch?: () => void
    /** The nav: the closest pages are suggested from it. */
    nav?: DocsNav
    /** Opens a suggested page in the app (a plain link without it). */
    onNavigate?: (item: NavItem) => void
}

/** Leave for `dest` (an app path or a full URL), keeping the query and hash it does not set. */
function leaveFor(dest: string, internal: boolean) {
    const { search, hash } = window.location
    let url = internal ? withBase(dest) : dest
    if (!dest.includes('?') && !dest.includes('#')) url += search
    if (!dest.includes('#')) url += hash
    window.location.replace(url)
}

export function DocsNotFound({ config, path, onSearch, nav, onNavigate }: DocsNotFoundProps) {
    const site = config.site?.title || 'Documentation'
    const root = path === '/'
    const custom = config.errors?.notFound
    const title = custom?.title || 'Page not found'
    // Until the redirect check has run, show nothing rather than a 404 that flashes away.
    const mayLeave = !root && (!!config.redirects?.length || !!custom?.redirect)
    const [checked, setChecked] = useState(!mayLeave)
    const [suggestions, setSuggestions] = useState<NavItem[]>([])

    useEffect(() => {
        if (!root) document.title = `${title} | ${site}`
    }, [root, title, site])

    useEffect(() => {
        if (root) return
        let live = true
        import('./redirects')
            .then(({ matchRedirect, isInternal, suggestPages }) => {
                if (!live) return
                const dest = matchRedirect(config.redirects, path)
                if (dest && dest !== path) return leaveFor(dest, isInternal(dest))
                if (custom?.redirect) return leaveFor('/', true)
                setSuggestions(nav ? suggestPages(docPages(nav), path) : [])
                setChecked(true)
            })
            .catch(() => live && setChecked(true))
        return () => {
            live = false
        }
    }, [root, path, config.redirects, custom?.redirect, nav])

    if (root) {
        return (
            <section className="aiui-docs-empty" aria-labelledby="aiui-docs-empty-title">
                <h1 id="aiui-docs-empty-title">{site}</h1>
                {config.site?.description && <p>{config.site.description}</p>}
                {onSearch && (
                    <div className="aiui-docs-empty-actions">
                        <Button type="button" variant="outline" onClick={onSearch}>Search the docs</Button>
                    </div>
                )}
            </section>
        )
    }
    if (!checked) return <section className="aiui-docs-empty" aria-busy="true" />

    const open = (page: NavItem) => (e: MouseEvent<HTMLAnchorElement>) => {
        if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        onNavigate(page)
    }
    return (
        <section className="aiui-docs-empty" aria-labelledby="aiui-docs-empty-title">
            <p className="aiui-docs-eyebrow">404</p>
            <h1 id="aiui-docs-empty-title">{title}</h1>
            {custom?.description ? (
                <Markdown variant="docs">{custom.description}</Markdown>
            ) : (
                <p>
                    There is no page at <code>{path}</code>. It may have moved; the home page and the search
                    find every page.
                </p>
            )}
            {suggestions.length > 0 && (
                <nav aria-label="Similar pages">
                    <p>Did you mean:</p>
                    <ul>
                        {suggestions.map((page) => (
                            <li key={page.path}>
                                <a href={withBase(page.path ?? '/')} onClick={open(page)}>
                                    {page.pageTitle || page.title}
                                </a>
                            </li>
                        ))}
                    </ul>
                </nav>
            )}
            <div className="aiui-docs-empty-actions">
                <Button asChild>
                    <a href={withBase('/')}>Go to the home page</a>
                </Button>
                {onSearch && (
                    <Button type="button" variant="outline" onClick={onSearch}>Search the docs</Button>
                )}
            </div>
        </section>
    )
}
