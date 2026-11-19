// Previous / next page links under a docs article, in sidebar reading order.
import { ChevronLeft, ChevronRight } from 'virtual:aiui-icons/inline'
import { canonicalDocPath } from './docSource'
import { withBase } from '../lib/url'
import type { DocsNav, NavItem } from '../types'
import { docNeighbours } from './docNav'

export function DocsPager({ nav, path, onNavigate }: { nav: DocsNav; path: string; onNavigate: (item: NavItem) => void }) {
    const { prev, next } = docNeighbours(nav, path)
    if (!prev && !next) return null

    const link = (item: NavItem, dir: 'prev' | 'next') => (
        <a
            href={withBase(canonicalDocPath(item.path || '/'))}
            className="aiui-docs-pager-link"
            data-dir={dir}
            rel={dir}
            onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                event.preventDefault()
                onNavigate(item)
                window.scrollTo({ top: 0 })
            }}
        >
            <span className="aiui-docs-pager-label">
                {dir === 'prev' && <ChevronLeft aria-hidden="true" />}
                {dir === 'prev' ? 'Previous' : 'Next'}
                {dir === 'next' && <ChevronRight aria-hidden="true" />}
            </span>
            <span className="aiui-docs-pager-title">{item.title}</span>
        </a>
    )

    return (
        <nav className="aiui-docs-pager" aria-label="Previous and next page">
            {prev && link(prev, 'prev')}
            {next && link(next, 'next')}
        </nav>
    )
}
