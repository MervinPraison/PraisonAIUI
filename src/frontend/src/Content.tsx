// Content component — markdown rendering and landing page
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { SHADCN_THEMES } from './themes'
import { enhanceMkdocsDom } from './markdown/mkdocsEnhance'
import { preprocessMkdocsMarkdown } from './markdown/mkdocsPreprocess'
import { slugify } from './markdown/slug'
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
    const [loadingContent, setLoadingContent] = useState(false)
    const articleRef = useRef<HTMLElement>(null)
    const theme = config.site?.theme

    // Load markdown from URL path (source of truth) to avoid stale selectedItem races
    useEffect(() => {
        const urlPath = normalizeDocPath(currentPath)
        if (urlPath === '/') {
            if (!selectedItem?.path) {
                setMarkdown('')
            }
            return
        }

        const mdUrl = docPathToMarkdown(urlPath)
        const pageTitle = selectedItem?.title ?? urlPath.split('/').pop() ?? 'page'
        let cancelled = false

        const loadContent = async () => {
            setLoadingContent(true)
            setMarkdown('')
            try {
                const response = await fetch(mdUrl)
                if (cancelled) return
                if (response.ok) {
                    const content = await response.text()
                    setMarkdown(preprocessMkdocsMarkdown(content))
                } else {
                    setMarkdown(`*Content for **${pageTitle}** not found.*`)
                }
            } catch {
                if (!cancelled) {
                    setMarkdown(`*Failed to load content for **${pageTitle}**.*`)
                }
            } finally {
                if (!cancelled) setLoadingContent(false)
            }
        }

        loadContent()
        return () => { cancelled = true }
    }, [currentPath, selectedItem?.title, selectedItem?.path])

    useEffect(() => {
        if (!markdown || !articleRef.current) return
        const article = articleRef.current
        const runEnhance = () => {
            enhanceMkdocsDom(article)
            window.dispatchEvent(new CustomEvent('aiui:content-loaded', { detail: { root: article } }))
        }
        runEnhance()
        const timer = window.setTimeout(runEnhance, 50)
        return () => window.clearTimeout(timer)
    }, [markdown])

    const headingId = (children?: React.ReactNode) => slugify(String(children ?? ''))

    const markdownComponents = {
        h1: ({ children }: { children?: React.ReactNode }) => <h1 id={headingId(children)} className="text-3xl font-bold mt-8 mb-4 scroll-mt-20">{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 id={headingId(children)} className="text-2xl font-semibold mt-8 mb-4 text-primary scroll-mt-20">{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 id={headingId(children)} className="text-xl font-semibold mt-6 mb-3 scroll-mt-20">{children}</h3>,
        h4: ({ children }: { children?: React.ReactNode }) => <h4 id={headingId(children)} className="text-lg font-semibold mt-4 mb-2 scroll-mt-20">{children}</h4>,
        p: ({ children }: { children?: React.ReactNode }) => <p className="my-3 text-foreground leading-relaxed">{children}</p>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} className="text-primary hover:underline">{children}</a>,
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-6 my-4 space-y-1">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-6 my-4 space-y-1">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="text-foreground">{children}</li>,
        blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-foreground/80">{children}</blockquote>,
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
            const isInline = !className && String(children).indexOf('\n') === -1
            if (isInline) {
                return <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
            }
            return <code className={`block font-mono text-foreground ${className ?? ''}`}>{children}</code>
        },
        pre: ({ children }: { children?: React.ReactNode }) => (
            <pre className="bg-muted text-foreground border border-border p-4 rounded-lg text-sm overflow-auto my-4 font-mono whitespace-pre">{children}</pre>
        ),
        table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-auto my-4"><table className="w-full border-collapse text-sm">{children}</table></div>,
        thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/50">{children}</thead>,
        tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b">{children}</tr>,
        th: ({ children }: { children?: React.ReactNode }) => <th className="px-4 py-2 text-left font-medium">{children}</th>,
        td: ({ children }: { children?: React.ReactNode }) => <td className="px-4 py-2 text-foreground">{children}</td>,
        hr: () => <hr className="my-6 border-border" />,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    }

    if (selectedItem) {
        return (
            <main id="main-content" className="flex-1 p-8 max-w-3xl">
                <MobileToc selectedItem={selectedItem} />
                {loadingContent ? (
                    <div className="text-muted-foreground">Loading content...</div>
                ) : markdown ? (
                    <article
                        ref={articleRef}
                        className="prose prose-neutral dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:text-foreground prose-code:text-foreground"
                    >
                        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {markdown}
                        </Markdown>
                    </article>
                ) : (
                    <div className="bg-muted/50 border rounded-lg p-6">
                        <p className="text-muted-foreground">
                            Content for <strong className="text-primary">{selectedItem.title}</strong> would be displayed here.
                        </p>
                    </div>
                )}
            </main>
        )
    }

    return (
        <main className="flex-1 p-8 max-w-3xl">
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
        </main>
    )
}
