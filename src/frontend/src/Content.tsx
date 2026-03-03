// Content component — markdown rendering and landing page
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { SHADCN_THEMES } from './themes'
import type { UIConfig, NavItem, RouteManifest } from './types'

interface ContentProps {
    config: UIConfig
    routes: RouteManifest
    selectedItem: NavItem | null
}

export function Content({ config, routes, selectedItem }: ContentProps) {
    const [markdown, setMarkdown] = useState<string>('')
    const [loadingContent, setLoadingContent] = useState(false)
    const theme = config.site?.theme

    // Load markdown content when selected item changes
    useEffect(() => {
        if (!selectedItem?.path) {
            setMarkdown('')
            return
        }

        const loadContent = async () => {
            setLoadingContent(true)
            try {
                // Convert path like /docs/getting-started/installation to docs/getting-started/installation.md
                const docPath = (selectedItem.path ?? '').replace(/^\//, '') + '.md'
                const response = await fetch(`/${docPath}`)
                if (response.ok) {
                    const content = await response.text()
                    setMarkdown(content)
                } else {
                    setMarkdown(`*Content for **${selectedItem.title}** not found.*`)
                }
            } catch {
                setMarkdown(`*Failed to load content for **${selectedItem.title}**.*`)
            } finally {
                setLoadingContent(false)
            }
        }

        loadContent()
    }, [selectedItem])

    // Custom components for react-markdown with Tailwind styling
    const markdownComponents = {
        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-3xl font-bold mt-8 mb-4">{children}</h1>,
        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-2xl font-semibold mt-8 mb-4 text-primary">{children}</h2>,
        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-xl font-semibold mt-6 mb-3">{children}</h3>,
        h4: ({ children }: { children?: React.ReactNode }) => <h4 className="text-lg font-semibold mt-4 mb-2">{children}</h4>,
        p: ({ children }: { children?: React.ReactNode }) => <p className="my-3 text-muted-foreground leading-relaxed">{children}</p>,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} className="text-primary hover:underline">{children}</a>,
        ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-6 my-4 space-y-1">{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-6 my-4 space-y-1">{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li className="text-muted-foreground">{children}</li>,
        blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">{children}</blockquote>,
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
            // Check if this is inside a pre block (fenced code block)
            const isInline = !className && String(children).indexOf('\n') === -1
            if (isInline) {
                return <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
            }
            // Block code - rendered by pre wrapper
            return <code className="block font-mono">{children}</code>
        },
        pre: ({ children }: { children?: React.ReactNode }) => (
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto my-4 font-mono whitespace-pre">{children}</pre>
        ),
        table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-auto my-4"><table className="w-full border-collapse text-sm">{children}</table></div>,
        thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/50">{children}</thead>,
        tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b">{children}</tr>,
        th: ({ children }: { children?: React.ReactNode }) => <th className="px-4 py-2 text-left font-medium">{children}</th>,
        td: ({ children }: { children?: React.ReactNode }) => <td className="px-4 py-2 text-muted-foreground">{children}</td>,
        hr: () => <hr className="my-6 border-border" />,
        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    }

    if (selectedItem) {
        return (
            <main className="flex-1 p-8 max-w-3xl">
                {loadingContent ? (
                    <div className="text-muted-foreground">Loading content...</div>
                ) : markdown ? (
                    <article className="prose max-w-none">
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
                <pre className="text-primary text-sm">
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
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto">
                {JSON.stringify(routes.routes?.slice(0, 3), null, 2)}
            </pre>
        </main>
    )
}
