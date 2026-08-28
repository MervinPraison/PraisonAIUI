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
    const [activeId, setActiveId] = useState('')

    const refreshHeadings = useCallback(() => {
        setHeadings(collectHeadings())
    }, [])

    useEffect(() => {
        refreshHeadings()
        const timer = window.setTimeout(refreshHeadings, 100)
        const timer2 = window.setTimeout(refreshHeadings, 500)
        return () => {
            window.clearTimeout(timer)
            window.clearTimeout(timer2)
        }
    }, [selectedItem, refreshHeadings])

    useEffect(() => {
        if (!headings.length) return

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                if (visible[0]?.target.id) {
                    setActiveId(visible[0].target.id)
                }
            },
            { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
        )

        for (const heading of headings) {
            const el = document.getElementById(heading.id)
            if (el) observer.observe(el)
        }

        return () => observer.disconnect()
    }, [headings])

    return { headings, activeId }
}

function TocLinks({ headings, activeId }: { headings: TocHeading[]; activeId: string }) {
    if (headings.length === 0) {
        return <p className="text-sm text-muted-foreground">No sections on this page.</p>
    }

    return (
        <div className="space-y-2.5">
            {headings.map((heading) => {
                const isActive = heading.id === activeId
                return (
                    <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        className={`flex items-start gap-2 text-[13px] leading-snug transition-colors ${heading.level === 3 ? 'pl-3' : heading.level === 4 ? 'pl-5' : ''
                            } ${isActive
                                ? 'text-primary font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <span
                            className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                                }`}
                        />
                        <span>{heading.text}</span>
                    </a>
                )
            })}
        </div>
    )
}

export function MobileToc({ selectedItem }: { selectedItem: NavItem | null }) {
    const { headings, activeId } = usePageHeadings(selectedItem)
    if (!selectedItem || headings.length === 0) return null

    return (
        <details className="lg:hidden border border-border/60 rounded-lg mb-6 px-4 py-3 bg-muted/20">
            <summary className="text-sm font-medium cursor-pointer">On this page</summary>
            <nav className="mt-3">
                <TocLinks headings={headings} activeId={activeId} />
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
    const { headings, activeId } = usePageHeadings(selectedItem)
    const rightSidebarWidgets = zones?.rightSidebar || []

    if (!showToc && rightSidebarWidgets.filter((w) => w.type !== 'Toc').length === 0) {
        return null
    }

    return (
        <aside className="docs-toc w-[16rem] min-w-[16rem] shrink-0 hidden lg:block">
            <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-6">
                {showToc && (
                    <div>
                        <h4 className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-4">
                            On this page
                        </h4>
                        <nav>
                            <TocLinks headings={headings} activeId={activeId} />
                        </nav>
                    </div>
                )}

                {rightSidebarWidgets.filter((w) => w.type !== 'Toc').length > 0 && (
                    <div className="pt-4 mt-4 border-t border-border/40">
                        <ZoneWidgets widgets={rightSidebarWidgets.filter((w) => w.type !== 'Toc')} />
                    </div>
                )}
            </div>
        </aside>
    )
}
