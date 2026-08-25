// Table of Contents & right sidebar component
import { useCallback, useEffect, useState } from 'react'
import type { NavItem, ZonesConfig } from './types'
import { ZoneWidgets } from './Widgets'

interface TocHeading {
    id: string
    text: string
    level: number
}

function collectHeadings(): TocHeading[] {
    const article = document.querySelector('#main-content article') ?? document.querySelector('article.prose')
    if (!article) return []

    return Array.from(article.querySelectorAll('h2[id], h3[id], h4[id]')).map((el) => ({
        id: el.id,
        text: el.textContent?.trim() ?? '',
        level: Number(el.tagName.slice(1)),
    }))
}

function usePageHeadings(selectedItem: NavItem | null) {
    const [headings, setHeadings] = useState<TocHeading[]>([])

    const refreshHeadings = useCallback(() => {
        setHeadings(collectHeadings())
    }, [])

    useEffect(() => {
        refreshHeadings()
        const timer = window.setTimeout(refreshHeadings, 100)
        return () => window.clearTimeout(timer)
    }, [selectedItem, refreshHeadings])

    useEffect(() => {
        const onContentLoaded = () => refreshHeadings()
        window.addEventListener('aiui:content-loaded', onContentLoaded)
        return () => window.removeEventListener('aiui:content-loaded', onContentLoaded)
    }, [refreshHeadings])

    return headings
}

function TocLinks({ headings }: { headings: TocHeading[] }) {
    if (headings.length === 0) {
        return <p className="text-sm text-muted-foreground">No sections on this page.</p>
    }

    return (
        <div className="space-y-2">
            {headings.map((heading) => (
                <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors ${heading.level === 3 ? 'pl-3 text-sm' : heading.level === 4 ? 'pl-6 text-sm' : 'font-medium'}`}
                >
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                    {heading.text}
                </a>
            ))}
        </div>
    )
}

export function MobileToc({ selectedItem }: { selectedItem: NavItem | null }) {
    const headings = usePageHeadings(selectedItem)
    if (!selectedItem || headings.length === 0) return null

    return (
        <details className="lg:hidden border border-border rounded-lg mb-6 px-4 py-3 bg-muted/20">
            <summary className="text-sm font-medium cursor-pointer">On this page</summary>
            <nav className="mt-3">
                <TocLinks headings={headings} />
            </nav>
        </details>
    )
}

export function Toc({
    selectedItem,
    zones,
    showToc = true,
}: {
    selectedItem: NavItem | null
    zones?: ZonesConfig
    showToc?: boolean
}) {
    const headings = usePageHeadings(selectedItem)
    const rightSidebarWidgets = zones?.rightSidebar || []

    if (!showToc && rightSidebarWidgets.filter((w) => w.type !== 'Toc').length === 0) {
        return null
    }

    return (
        <aside className="w-64 hidden lg:block border-l border-border/50">
            <div className="sticky top-20 px-4 py-6 space-y-4">
                {showToc && (
                    <div>
                        <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-4">
                            On this page
                        </h4>
                        <nav className="text-sm">
                            <TocLinks headings={headings} />
                        </nav>
                    </div>
                )}

                {rightSidebarWidgets.filter((w) => w.type !== 'Toc').length > 0 && (
                    <div className="pt-4 border-t border-border/50">
                        <ZoneWidgets widgets={rightSidebarWidgets.filter((w) => w.type !== 'Toc')} />
                    </div>
                )}
            </div>
        </aside>
    )
}
