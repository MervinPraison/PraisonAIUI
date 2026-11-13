// Content component — markdown rendering and landing page
import { useEffect, useRef, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { SHADCN_THEMES } from './themes'
import { enhanceMkdocsDom } from './markdown/mkdocsEnhance'
import { preprocessMkdocsMarkdown } from './markdown/mkdocsPreprocess'
import { Markdown, preloadMarkdown, preloadMarkdownPlugins } from './markdown/LazyMarkdown'
import { MobileToc } from './Toc'
import { docPathToMarkdown, normalizeDocPath } from './pathUtils'
import type { UIConfig, NavItem, RouteManifest } from './types'

interface ContentProps {
    config: UIConfig
    routes: RouteManifest
    selectedItem: NavItem | null
    currentPath: string
}

export function Content({ config, routes, selectedItem, currentPath }: ContentProps) {
    const [markdown, setMarkdown] = useState<string>('')
    const [loadedPath, setLoadedPath] = useState('')
    const [loadingContent, setLoadingContent] = useState(false)
    const articleRef = useRef<HTMLElement>(null)
    const loadedEventPath = useRef<string | null>(null)
    const theme = config.site?.theme

    // Load markdown from URL path (source of truth) to avoid stale selectedItem races
    useEffect(() => {
        const urlPath = normalizeDocPath(currentPath)
        if (urlPath === '/') {
            setLoadingContent(false)
            setLoadedPath('')
            if (!selectedItem?.path) {
                setMarkdown('')
            }
            return
        }

        const mdUrl = docPathToMarkdown(urlPath)
        const pageTitle = urlPath.split('/').pop()?.replace(/-/g, ' ') ?? 'page'
        const controller = new AbortController()

        setMarkdown('')
        setLoadedPath('')
        setLoadingContent(true)
        loadedEventPath.current = null

        const loadContent = async () => {
            try {
                const response = await fetch(mdUrl, { signal: controller.signal })
                if (controller.signal.aborted) return
                if (response.ok) {
                    const content = preprocessMkdocsMarkdown(await response.text())
                    // Renderer + Shiki core + KaTeX before first paint (no raw-$$ or
                    // unstyled-code flash); grammars and mermaid stay lazy.
                    await Promise.all([preloadMarkdown(), preloadMarkdownPlugins(content)])
                    if (controller.signal.aborted) return
                    loadedEventPath.current = urlPath // announced once the article has committed
                    setMarkdown(content)
                    setLoadedPath(urlPath)
                } else {
                    setMarkdown(`*Content for **${pageTitle}** not found.*`)
                    setLoadedPath(urlPath)
                }
            } catch {
                if (controller.signal.aborted) return
                setMarkdown(`*Failed to load content for **${pageTitle}**.*`)
                setLoadedPath(urlPath)
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingContent(false)
                }
            }
        }

        loadContent()
        return () => {
            controller.abort()
            setLoadingContent(false)
        }
    }, [currentPath, selectedItem?.path])

    useEffect(() => {
        if (!markdown || !articleRef.current) return
        const article = articleRef.current
        const frame = window.requestAnimationFrame(() => {
            enhanceMkdocsDom(article)
            const path = loadedEventPath.current
            if (path) {
                loadedEventPath.current = null
                window.dispatchEvent(new CustomEvent('aiui:content-loaded', { detail: { path } }))
            }
        })
        return () => window.cancelAnimationFrame(frame)
    }, [markdown])

    const contentReady = loadedPath === normalizeDocPath(currentPath) && markdown.length > 0

    if (selectedItem) {
        return (
            <main id="main-content" className="docs-main flex-1 min-w-0">
                <div className="docs-main-inner mx-auto w-full max-w-[720px] px-6 py-8 lg:px-8">
                    <MobileToc selectedItem={selectedItem} />
                    {loadingContent && (
                        <div className="space-y-3" role="status" aria-label="Loading content">
                            <Skeleton className="h-8 w-2/3" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-11/12" />
                            <Skeleton className="h-4 w-4/5" />
                        </div>
                    )}
                    {contentReady && (
                        <article
                            key={currentPath}
                            ref={articleRef}
                            className="aiui-doc max-w-none min-w-0"
                        >
                            <Markdown variant="docs">{markdown}</Markdown>
                        </article>
                    )}
                    {!loadingContent && !contentReady && loadedPath === normalizeDocPath(currentPath) && (
                        <div className="bg-muted/50 border rounded-lg p-6">
                            <p className="text-muted-foreground">
                                Content for <strong className="text-primary">{selectedItem.title}</strong> would be displayed here.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        )
    }

    return (
        <main id="main-content" className="docs-main flex-1 min-w-0">
            <div className="docs-main-inner mx-auto w-full max-w-[720px] px-6 py-8 lg:px-8">
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
