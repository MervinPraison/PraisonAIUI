// "On this page": the right-hand table of contents and its folded phone version.
// Styles: docs/docs.css (.aiui-docs-toc*, .aiui-docs-mtoc), Pro tokens.
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, ChevronUp, TextAlignStart } from 'lucide-react'
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

/** The heading the reader is in: the last one whose top has passed the header line. */
function currentHeading(headings: TocHeading[]): string {
    // A heading becomes current once it rises into the top quarter of the window.
    const line = Math.max(96, window.innerHeight * 0.25)
    let current = headings[0]?.id ?? ''
    for (const heading of headings) {
        const el = document.getElementById(heading.id)
        if (!el) continue
        if (el.getBoundingClientRect().top - line <= 0) current = heading.id
        else break
    }
    // At the very bottom the last section is current, however short it is.
    const doc = document.documentElement
    if (headings.length && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        current = headings[headings.length - 1].id
    }
    return current
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
        // The article renders after its markdown arrives.
        window.addEventListener('aiui:content-loaded', refreshHeadings)
        return () => {
            window.clearTimeout(timer)
            window.clearTimeout(timer2)
            window.removeEventListener('aiui:content-loaded', refreshHeadings)
        }
    }, [selectedItem, refreshHeadings])

    useEffect(() => {
        if (!headings.length) return
        let frame = 0
        const update = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => setActiveId(currentHeading(headings)))
        }
        update()
        window.addEventListener('scroll', update, { passive: true })
        window.addEventListener('resize', update)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
        }
    }, [headings])

    // Until the reader scrolls (or after the page changes) the first section is current.
    const current = headings.some((h) => h.id === activeId) ? activeId : (headings[0]?.id ?? '')
    return { headings, activeId: current }
}

function TocLinks({ headings, activeId }: { headings: TocHeading[]; activeId: string }) {
    if (headings.length === 0) {
        return <p className="aiui-docs-toc-empty">No sections on this page.</p>
    }

    return (
        <div className="aiui-docs-toc-list">
            {headings.map((heading) => (
                <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className="aiui-docs-toc-link"
                    aria-current={heading.id === activeId ? 'location' : undefined}
                    style={{ '--indent': Math.max(0, heading.level - 2) } as React.CSSProperties}
                >
                    {heading.text}
                </a>
            ))}
        </div>
    )
}

export function MobileToc({ selectedItem }: { selectedItem: NavItem | null }) {
    const { headings, activeId } = usePageHeadings(selectedItem)
    if (!selectedItem || headings.length === 0) return null

    return (
        <details className="aiui-docs-mtoc">
            <summary>
                <ChevronRight aria-hidden="true" />
                On this page
            </summary>
            <nav data-aiui-toc="react" aria-label="On this page">
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
    const widgets = (zones?.rightSidebar || []).filter((w) => w.type !== 'Toc')

    if (!showToc && widgets.length === 0) {
        return null
    }

    return (
        <aside className="aiui-docs-toc docs-toc">
            <div className="aiui-docs-toc-inner">
                {showToc && (
                    <div>
                        <p className="aiui-docs-toc-title">
                            <TextAlignStart aria-hidden="true" />
                            On this page
                        </p>
                        {/* data-aiui-toc: the legacy toc.js plugin leaves a React-managed TOC alone. */}
                        <nav data-aiui-toc="react" aria-label="On this page">
                            <TocLinks headings={headings} activeId={activeId} />
                        </nav>
                        {headings.length > 3 && (
                            <a
                                href="#main-content"
                                className="aiui-docs-toc-top"
                                onClick={(event) => {
                                    event.preventDefault()
                                    window.scrollTo({ top: 0 })
                                }}
                            >
                                <ChevronUp aria-hidden="true" />
                                Back to top
                            </a>
                        )}
                    </div>
                )}

                {widgets.length > 0 && (
                    <div className={showToc ? 'aiui-docs-toc-widgets' : undefined}>
                        <ZoneWidgets widgets={widgets} />
                    </div>
                )}
            </div>
        </aside>
    )
}
