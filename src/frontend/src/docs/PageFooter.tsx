// Under a docs article: "Was this page helpful?" (docs/DocsFeedback.tsx, a
// lazy chunk; content.docs.feedback), the date the page last changed and
// "Edit this page". Also the docs `pre` with a code-block flag.
import { lazy, useContext, type ComponentProps } from 'react'
import type { NavItem, UIConfig } from '../types'
import { DocsPre } from './DocsPre'
import { CodeFeedback } from './feedbackContext'
import { OptionalPart } from './PartBoundary'
import { feedbackIssueUrl, formatUpdated } from './pageFooterLinks'

const PageVote = lazy(() => import('./DocsFeedback').then((m) => ({ default: m.PageVote })))
const CodeFlag = lazy(() => import('./DocsFeedback').then((m) => ({ default: m.CodeFlag })))

// lucide square-pen, drawn here so no icon module is shared with the chat's chunks.
const PEN = 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'

function Glyph({ d }: { d: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {d.split(' M').map((part, i) => <path key={i} d={i ? `M${part}` : part} />)}
        </svg>
    )
}

/** `server`: the vote endpoint of the aiui server that served the page (ui-config `docsFeedback.url`; none on a static host). */
export function PageFooter({ item, path, config, server }: { item: NavItem; path: string; config?: UIConfig['pageFooter']; server?: string | null }) {
    const feedback = config?.feedback
    if (feedback === false && !item.lastUpdated && !item.editUrl) return null

    return (
        // Empty (no vote to ask for, no date, no link) it is hidden by CSS.
        <footer className="aiui-docs-pagefoot">
            {feedback !== false && (
                <OptionalPart name="page feedback">
                    <PageVote key={path} path={path} cfg={feedback ?? {}} server={server}
                        issueUrl={feedback?.issues && feedbackIssueUrl(feedback.issues, item.pageTitle ?? item.title, typeof window === 'undefined' ? '' : window.location.href.split('#')[0])} />
                </OptionalPart>
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

/** The docs `pre`; under `content.docs.feedback.code` with a "Report a problem" flag. */
export function FlaggedPre(props: ComponentProps<typeof DocsPre>) {
    const page = useContext(CodeFeedback)
    if (!page) return <DocsPre {...props} />
    return (
        <div className="aiui-code-fb">
            <DocsPre {...props} />
            <OptionalPart name="code feedback"><CodeFlag {...page} /></OptionalPart>
        </div>
    )
}
