// "Related pages" under a docs article: a lazy chunk (Content.tsx loads it
// only for a page that has some). Pure props: it imports no legacy-App module.
import type { RelatedLink } from './related'

// lucide arrow-up-right, drawn here so no icon module is shared with the chat's chunks.
const ARROW = 'M7 7h10v10 M7 17 17 7'

export function RelatedPages({ links, onNavigate }: { links: RelatedLink[]; onNavigate: (href: string) => void }) {
    if (!links.length) return null
    return (
        <nav className="aiui-docs-related" aria-labelledby="aiui-docs-related-title" data-print="hide">
            <h2 id="aiui-docs-related-title">Related pages</h2>
            <ul>
                {links.map((link) => (
                    <li key={link.href}>
                        {link.external ? (
                            <a href={link.href} target="_blank" rel="noopener noreferrer">
                                {link.title}
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    {ARROW.split(' M').map((d, i) => <path key={i} d={i ? `M${d}` : d} />)}
                                </svg>
                                <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                        ) : (
                            <a href={link.href} onClick={(event) => {
                                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                                event.preventDefault()
                                onNavigate(link.href)
                                if (!link.href.includes('#')) window.scrollTo({ top: 0 })
                            }}>{link.title}</a>
                        )}
                    </li>
                ))}
            </ul>
        </nav>
    )
}
