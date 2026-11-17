// Under a docs article: "Was this page helpful?", the date the page last
// changed and "Edit this page". Nothing is stored: "No" opens a new issue
// with the page filled in (content.docs.feedback.issues).
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { NavItem, UIConfig } from '../types'
import { feedbackIssueUrl, formatUpdated } from './pageFooterLinks'

// lucide thumbs-up / thumbs-down / square-pen, drawn here so no icon module is
// shared with the chat's chunks.
const THUMB = 'M7 10v12 M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z'
const PEN = 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'

function Glyph({ d, flip }: { d: string; flip?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={flip ? { transform: 'rotate(180deg)' } : undefined}>
            {d.split(' M').map((part, i) => <path key={i} d={i ? `M${part}` : part} />)}
        </svg>
    )
}

export function PageFooter({ item, config }: { item: NavItem; config?: UIConfig['pageFooter'] }) {
    const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
    const issues = config?.feedbackIssues
    const title = item.pageTitle ?? item.title
    if (!issues && !item.lastUpdated && !item.editUrl) return null
    const pageUrl = typeof window === 'undefined' ? '' : window.location.href.split('#')[0]

    return (
        <footer className="aiui-docs-pagefoot">
            {issues && (
                <div className="aiui-docs-feedback" role="group" aria-labelledby="aiui-docs-feedback-q">
                    {answer === null ? (
                        <>
                            <span id="aiui-docs-feedback-q">Was this page helpful?</span>
                            <Button variant="outline" size="sm" onClick={() => setAnswer('yes')}>
                                <Glyph d={THUMB} /> Yes
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setAnswer('no')}>
                                <Glyph d={THUMB} flip /> No
                            </Button>
                        </>
                    ) : (
                        <p id="aiui-docs-feedback-q" role="status">
                            {answer === 'yes' ? (
                                'Thanks for telling us.'
                            ) : (
                                <>
                                    Thanks. <a href={feedbackIssueUrl(issues, title, pageUrl)} target="_blank" rel="noopener noreferrer">Tell us what was missing</a> in a new issue.
                                </>
                            )}
                        </p>
                    )}
                </div>
            )}
            {(item.lastUpdated || item.editUrl) && (
                <div className="aiui-docs-pagefoot-meta">
                    {item.lastUpdated && (
                        <span>
                            Last updated <time dateTime={item.lastUpdated}>{formatUpdated(item.lastUpdated)}</time>
                        </span>
                    )}
                    {item.editUrl && (
                        <a href={item.editUrl} target="_blank" rel="noopener noreferrer">
                            <Glyph d={PEN} />
                            {config?.editText ?? 'Edit this page'}
                        </a>
                    )}
                </div>
            )}
        </footer>
    )
}
