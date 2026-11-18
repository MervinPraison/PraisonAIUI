/**
 * What a docs site shows when the URL names no page: "Page not found" with a
 * way home and to search, or, at the site root of a site without a home page
 * (docs/index.md), the site title and description. Never the developer view
 * (Content.tsx keeps that for `debug: true`).
 */
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { UIConfig } from '../types'
import { withBase } from '../lib/url'

interface DocsNotFoundProps {
    config: UIConfig
    /** The URL path that matched no page. */
    path: string
    /** Opens the docs search, when the site has search. */
    onSearch?: () => void
}

export function DocsNotFound({ config, path, onSearch }: DocsNotFoundProps) {
    const site = config.site?.title || 'Documentation'
    const root = path === '/'
    useEffect(() => {
        if (!root) document.title = `Page not found | ${site}`
    }, [root, site])

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
    return (
        <section className="aiui-docs-empty" aria-labelledby="aiui-docs-empty-title">
            <p className="aiui-docs-eyebrow">404</p>
            <h1 id="aiui-docs-empty-title">Page not found</h1>
            <p>
                There is no page at <code>{path}</code>. It may have moved; the home page and the search
                find every page.
            </p>
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
