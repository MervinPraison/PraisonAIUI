// Content component — markdown rendering and landing page
import { useEffect, useMemo, useRef, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { SHADCN_THEMES } from './themes'
import { enhanceMkdocsDom } from './markdown/mkdocsEnhance'
import { preprocessMkdocsMarkdown } from './markdown/mkdocsPreprocess'
import { Markdown, preloadMarkdown, preloadMarkdownPlugins } from './markdown/LazyMarkdown'
import { MobileToc } from './Toc'
import { docPathToSource, normalizeDocPath } from './pathUtils'
import type { DocsNav, UIConfig, NavItem, RouteManifest } from './types'
import { canonicalDocPath, docSourcePath, hasSectionHeadings, prepareDocSource } from './docs/docSource'
import { docNeighbours, docTrail } from './docs/docNav'
import { DocsPager } from './docs/DocsPager'
import { DocsHome } from './docs/DocsHome'
import { DocsNotFound } from './docs/DocsNotFound'
import { DocsPre } from './docs/DocsPre'
import { DOCS_TAG_COMPONENTS } from './docs/DocsBlocks'
import { DocsImage, DocsSource } from './docs/DocsMedia'
import { splitPanels } from './docs/panels'
import { DOCS_ALLOWED_ELEMENTS } from './markdown/docsTags'
import { PageFooter } from './docs/PageFooter'
import { installDocPrefetch, loadDoc, peekDoc, prefetchDoc, whenIdle, type DocResult } from './docs/docLoader'
import { Button } from '@/components/ui/button'
import { PageActions } from './docs/PageActions'
import { metaAttributes, modeHidesToc, modeIsBare, withPageHead } from './docs/pageHead'
import { stripBase, withBase } from './lib/url'

interface ContentProps {
    config: UIConfig
    routes: RouteManifest
    selectedItem: NavItem | null
    currentPath: string
    /** The nav in reading order: adds the section eyebrow and previous / next links. */
    nav?: DocsNav
    onNavigate?: (item: NavItem) => void
    /** Opens the docs search (the "Page not found" view offers it). */
    onSearch?: () => void
}

/** Docs-only element overrides (code titles and highlights; light/dark images; the docs components). Module scope: Markdown wants a stable object. */
const DOCS_MARKDOWN_COMPONENTS = { pre: DocsPre, img: DocsImage, source: DocsSource, ...DOCS_TAG_COMPONENTS }

/** The docs home page: the only page whose frontmatter `layout: home` draws a hero. */
const DOCS_HOME_PATH = '/docs/index'

/** Longest wait for the renderer chunks before a fetched page paints. */
const PAINT_WAIT_MS = 1000

/** SPA navigation to an internal href, a browser URL (the same event the sidebar sends, with the app path). */
function navigateTo(href: string) {
    const path = stripBase(href.split(/[?#]/)[0])
    window.history.pushState({ path }, '', href)
    window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path } }))
}

export function Content({ config, routes, selectedItem, currentPath, nav, onNavigate, onSearch }: ContentProps) {
    const [markdown, setMarkdown] = useState<string>('')
    const [loadedPath, setLoadedPath] = useState('')
    const [loadingContent, setLoadingContent] = useState(false)
    const [loadError, setLoadError] = useState(false)
    const [retryCount, setRetryCount] = useState(0)
    const articleRef = useRef<HTMLElement>(null)
    const loadedEventPath = useRef<string | null>(null)
    const navRef = useRef(nav)
    navRef.current = nav
    const itemRef = useRef(selectedItem)
    itemRef.current = selectedItem
    const theme = config.site?.theme

    // Prefetch a docs link's markdown on hover, focus and pointerdown.
    useEffect(() => installDocPrefetch(), [])

    // Load markdown from URL path (source of truth) to avoid stale selectedItem races.
    // docLoader bounds every attempt and retries, caches answers and shares
    // prefetches; the next navigation aborts this one (the last click wins).
    useEffect(() => {
        const urlPath = normalizeDocPath(currentPath)
        // The site root shows the docs home page (docs/index.md) when the nav has one.
        const sourcePath = docSourcePath(urlPath, selectedItem?.path)
        setLoadError(false)
        if (!sourcePath) {
            setLoadingContent(false)
            setLoadedPath('')
            setMarkdown('')
            return
        }

        const mdUrl = docPathToSource(sourcePath)
        const pageTitle = sourcePath.split('/').pop()?.replace(/-/g, ' ') ?? 'page'
        const controller = new AbortController()
        let cancelIdle = () => {}

        // The title and description at the top (frontmatter), except on the home hero and the bare modes.
        const item = itemRef.current
        const head = item && !modeIsBare(item.mode) && !(config.docsHome && sourcePath === DOCS_HOME_PATH)
        const prepare = (text: string) => {
            const source = prepareDocSource(text, sourcePath)
            return preprocessMkdocsMarkdown(head ? withPageHead(source, item) : source)
        }
        const show = (result: DocResult, content = result.ok ? prepare(result.text) : '') => {
            loadedEventPath.current = urlPath // announced once the article has committed
            setMarkdown(result.ok ? content : `*Content for **${pageTitle}** not found.*`)
            setLoadedPath(urlPath)
            setLoadingContent(false)
            // Warm the previous and next pages while the reader reads this one.
            cancelIdle = whenIdle(() => {
                const docsNav = navRef.current
                const { prev, next } = docsNav ? docNeighbours(docsNav, sourcePath) : {}
                for (const item of [prev, next]) {
                    if (item?.path) prefetchDoc(docPathToSource(item.path))
                }
            })
        }

        // A page read before (or prefetched) renders at once; the renderer is warm.
        const cached = peekDoc(mdUrl)
        if (cached) {
            show(cached)
            return () => cancelIdle()
        }

        setMarkdown('')
        setLoadedPath('')
        setLoadingContent(true)
        loadedEventPath.current = null

        loadDoc(mdUrl, controller.signal).then(async (result) => {
            if (controller.signal.aborted) return
            if (!result.ok) return show(result)
            // Renderer + Shiki core + KaTeX before first paint (no raw-$$ or
            // unstyled-code flash), but never more than PAINT_WAIT_MS: past
            // that the text shows and upgrades when they arrive.
            const content = prepare(result.text)
            await Promise.race([
                Promise.all([preloadMarkdown(), preloadMarkdownPlugins(content)]),
                new Promise((resolve) => setTimeout(resolve, PAINT_WAIT_MS)),
            ])
            if (!controller.signal.aborted) show(result, content)
        }, () => {
            if (controller.signal.aborted) return
            setLoadError(true)
            setLoadingContent(false)
        })

        return () => {
            controller.abort()
            cancelIdle()
            setLoadingContent(false)
        }
    }, [currentPath, selectedItem?.path, retryCount, config.docsHome])

    useEffect(() => {
        if (!markdown || !articleRef.current) return
        const article = articleRef.current
        const frame = window.requestAnimationFrame(() => {
            enhanceMkdocsDom(article)
            const path = loadedEventPath.current
            if (path) {
                loadedEventPath.current = null
                // `meta`: the page's custom frontmatter keys, for custom JS.
                window.dispatchEvent(new CustomEvent('aiui:content-loaded', { detail: { path, meta: itemRef.current?.meta ?? {} } }))
            }
        })
        return () => window.cancelAnimationFrame(frame)
    }, [markdown])

    const contentReady = loadedPath === normalizeDocPath(currentPath) && markdown.length > 0
    // <RequestExample>, <ResponseExample> and <Panel>: a side column (docs/panels.ts).
    const { main, side } = useMemo(() => splitPanels(markdown), [markdown])

    if (selectedItem) {
        const shownPath = docSourcePath(normalizeDocPath(currentPath), selectedItem.path)
        // The docs home page with frontmatter `layout: home`: hero and features above its markdown.
        const home = config.docsHome && shownPath === DOCS_HOME_PATH ? config.docsHome : null
        // The eyebrow: the page's group, or with `styling.eyebrows: breadcrumbs` every group above it.
        const trail = nav && !home ? docTrail(nav, currentPath) : []
        const crumbs = config.styling?.eyebrows === 'breadcrumbs' ? trail : trail.slice(-1)
        const bare = modeIsBare(selectedItem.mode)
        return (
            <main id="main-content" className="aiui-docs-main docs-main">
                <div className="aiui-docs-column docs-main-inner">
                    {/* Drawn from the first frame while the page loads (most pages have
                        sections) and kept once the article is in if it has any, so nothing
                        below it moves. Not on an error or empty page. */}
                    {!modeHidesToc(selectedItem.mode) && <MobileToc
                        selectedItem={selectedItem}
                        expectHeadings={contentReady ? hasSectionHeadings(markdown) : !!shownPath && !loadError && loadedPath !== normalizeDocPath(currentPath)}
                    />}
                    {!home && !bare && (
                        <div className="aiui-docs-pagehead">
                            {crumbs.length ? (
                                // Section › Page: the page part shows on phones, where the sidebar is folded away.
                                // A group with a page of its own links there.
                                <nav className="aiui-docs-eyebrow aiui-docs-crumbs" aria-label="Breadcrumb">
                                    <ol>
                                        {crumbs.map((crumb) => (
                                            <li key={crumb.title + (crumb.path ?? '')}>
                                                {crumb.path ? <a href={withBase(canonicalDocPath(crumb.path))} onClick={(event) => {
                                                    if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                                                    event.preventDefault()
                                                    onNavigate(crumb)
                                                }}>{crumb.title}</a> : crumb.title}
                                            </li>
                                        ))}
                                        <li className="aiui-docs-crumb-page" aria-current="page">{selectedItem.title}</li>
                                    </ol>
                                </nav>
                            ) : <span />}
                            <PageActions path={shownPath ?? currentPath} title={selectedItem.pageTitle ?? selectedItem.title} />
                        </div>
                    )}
                    {loadingContent && (
                        <div className="aiui-docs-skeleton" role="status" aria-label="Loading content">
                            <Skeleton className="h-8 w-2/3" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-11/12" />
                            <Skeleton className="h-4 w-4/5" />
                        </div>
                    )}
                    {contentReady && selectedItem.deprecated && (
                        <p className="aiui-docs-deprecated" role="note">This page is deprecated and may be removed in a future release.</p>
                    )}
                    {contentReady && home && (
                        <DocsHome home={home} homePath={DOCS_HOME_PATH} onNavigate={navigateTo} />
                    )}
                    {contentReady && (
                        // `prose` is not styling here (the Markdown root is not-prose): the
                        // legacy plugins (plugin-loader, syntax-highlight, code-copy, mermaid,
                        // toc) leave `#main-content article.prose` alone. Without it they
                        // re-highlight and wrap the React-rendered code blocks.
                        <div key={currentPath} className={side ? 'aiui-docs-split' : 'contents'}>
                            <article ref={articleRef} className="aiui-doc prose max-w-none min-w-0"
                                data-no-anchor={selectedItem.noAnchor ? '' : undefined} {...metaAttributes(selectedItem.meta)}>
                                <Markdown variant="docs" components={DOCS_MARKDOWN_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{main}</Markdown>
                            </article>
                            {side && (
                                <aside className="aiui-docs-panel" aria-label="Side panel">
                                    <article className="aiui-doc prose max-w-none min-w-0">
                                        <Markdown variant="docs" components={DOCS_MARKDOWN_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{side}</Markdown>
                                    </article>
                                </aside>
                            )}
                        </div>
                    )}
                    {contentReady && !home && !bare && <PageFooter item={selectedItem} config={config.pageFooter} />}
                    {contentReady && nav && onNavigate && !bare && !selectedItem.hidePager && (
                        <DocsPager nav={nav} path={shownPath ?? currentPath} onNavigate={onNavigate} />
                    )}
                    {loadError && (
                        <div className="aiui-docs-notice" role="alert">
                            <p>Couldn't load this page. Check your connection and try again.</p>
                            <Button type="button" variant="outline" onClick={() => setRetryCount((n) => n + 1)}>
                                Retry
                            </Button>
                        </div>
                    )}
                    {!loadingContent && !loadError && !contentReady && loadedPath === normalizeDocPath(currentPath) && (
                        <p className="aiui-docs-notice">
                            Content for <strong>{selectedItem.title}</strong> would be displayed here.
                        </p>
                    )}
                </div>
            </main>
        )
    }

    // No page at this URL: "Page not found" (or the site name at a root with no
    // home page). The developer view of the config is for `debug: true` only.
    if (!config.debug) {
        return (
            <main id="main-content" className="aiui-docs-main docs-main">
                <div className="aiui-docs-column docs-main-inner">
                    <DocsNotFound config={config} path={normalizeDocPath(currentPath)} onSearch={onSearch} />
                </div>
            </main>
        )
    }

    return (
        <main id="main-content" className="aiui-docs-main docs-main">
            <div className="aiui-docs-column docs-main-inner">
            <h1 className="text-4xl font-bold tracking-tight mb-4">
                {config.site?.title || 'Documentation'}
            </h1>
            <p className="text-muted-foreground text-lg mb-8">
                {config.site?.description || 'Welcome to the documentation.'}
            </p>

            <Separator className="my-8" />

            <h2 className="text-2xl font-semibold mb-4 text-primary">Theme Configuration</h2>
            <div className="bg-muted/50 border rounded-lg p-4 mb-6">
                <p className="text-sm text-muted-foreground mb-2">
                    <strong>Current theme from YAML:</strong>
                </p>
                <pre className="bg-muted text-foreground border border-border p-3 rounded-lg text-sm overflow-auto">
                    {`site:
  theme:
    preset: "${theme?.preset || 'zinc'}"
    radius: "${theme?.radius || 'md'}"
    darkMode: ${theme?.darkMode !== false}`}
                </pre>
            </div>

            <h3 className="text-lg font-medium mb-3">Available Presets</h3>
            <div className="flex flex-wrap gap-2 mb-6">
                {Object.keys(SHADCN_THEMES).map((name) => (
                    <span
                        key={name}
                        className={`px-3 py-1 rounded-full text-sm ${name === (theme?.preset || 'zinc')
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                            }`}
                    >
                        {name}
                    </span>
                ))}
            </div>

            <p className="text-muted-foreground mb-4">
                <strong>Click any item in the sidebar</strong> to navigate.
            </p>

            <h2 className="text-2xl font-semibold mt-8 mb-4">Routes</h2>
            <p className="text-muted-foreground mb-4">
                <span className="font-medium text-primary">{routes.routes?.length || 0}</span> routes configured.
            </p>
            <pre className="bg-muted text-foreground border border-border p-4 rounded-lg text-sm overflow-auto">
                {JSON.stringify(routes.routes?.slice(0, 3), null, 2)}
            </pre>
            </div>
        </main>
    )
}
