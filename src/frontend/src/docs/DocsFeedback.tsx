// "Was this page helpful?" with an optional comment, and the flag on each code
// block (`content.docs.feedback.code`). A lazy chunk: PageFooter.tsx loads it
// under a finished page. Where votes go: docs/feedback.ts. It imports nothing
// from the legacy App chunk (lib/url, PageFooter): PageFooter passes it in.
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { newVoteId, sendVote, voteTarget, type DocsFeedbackConfig, type Vote } from './feedback'

/** The page, its settings and the server's endpoint (withBase applied). */
export interface FeedbackProps { path: string; cfg: DocsFeedbackConfig; builtin: string }

// lucide thumbs-up, drawn here so no icon module is shared with the chat's chunks.
const THUMB = 'M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z'
const Thumb = ({ down }: { down?: boolean }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}><path d={THUMB} /></svg>
)
const MAX_COMMENT = 1000

/** The vote target, once known (undefined while the server is asked). */
function useTarget(cfg: DocsFeedbackConfig, builtin: string): string | null | undefined {
    const [target, setTarget] = useState<string | null>()
    const { endpoint } = cfg
    useEffect(() => {
        let live = true
        void voteTarget({ endpoint }, builtin).then((t) => live && setTarget(t))
        return () => { live = false }
    }, [endpoint, builtin])
    return target
}

/** A comment box; with onCancel (a code flag) it may be sent empty. */
function CommentForm({ label, onSend, onCancel }: { label: string; onSend: (comment: string) => void; onCancel?: () => void }) {
    const id = useId()
    const [text, setText] = useState('')
    return (
        <form className="aiui-docs-feedback-form" onSubmit={(e) => { e.preventDefault(); if (text.trim() || onCancel) onSend(text.trim()) }}>
            <label htmlFor={id}>{label}</label>
            <Textarea id={id} rows={3} maxLength={MAX_COMMENT} value={text} onChange={(e) => setText(e.target.value)} />
            <div>
                <Button type="submit" size="sm" disabled={!text.trim() && !onCancel}>Send</Button>
                {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
            </div>
        </form>
    )
}

/** `issueUrl`: a new issue that names the page (content.docs.feedback.issues), offered after a "No". */
export function PageVote({ path, cfg, builtin, issueUrl }: FeedbackProps & { issueUrl?: string }) {
    const target = useTarget(cfg, builtin)
    const [vote, setVote] = useState<Vote | null>(null)
    const [commented, setCommented] = useState(false)
    // Votes go somewhere: a stored target, or the browser event alone (endpoint: false).
    const counts = target != null || cfg.endpoint === false
    if (target === undefined || (!counts && !issueUrl)) return null

    const answer = (value: 1 | -1) => {
        const v: Vote = { id: newVoteId(), path, value }
        setVote(v)
        void sendVote(target, v)
    }
    const comment = (text: string) => {
        void sendVote(target, { ...vote!, comment: text })
        setCommented(true)
    }

    return (
        <div className="aiui-docs-feedback" role="group" aria-labelledby="aiui-docs-feedback-q">
            {vote === null ? (
                <>
                    <span id="aiui-docs-feedback-q">Was this page helpful?</span>
                    <Button variant="outline" size="sm" onClick={() => answer(1)}><Thumb /> Yes</Button>
                    <Button variant="outline" size="sm" onClick={() => answer(-1)}><Thumb down /> No</Button>
                </>
            ) : (
                <>
                    <p id="aiui-docs-feedback-q" role="status">
                        {commented ? 'Thanks for the details.' : vote.value > 0 || !issueUrl ? 'Thanks for telling us.'
                            : <>Thanks. <a href={issueUrl} target="_blank" rel="noopener noreferrer">Tell us what was missing</a> in a new issue.</>}
                    </p>
                    {counts && !commented && (
                        <CommentForm label={vote.value > 0 ? 'What helped? (optional)' : 'What was missing or wrong? (optional)'} onSend={comment} />
                    )}
                </>
            )}
        </div>
    )
}

/** The flag in a code block's corner; a comment form opens under the block. */
export function CodeFlag({ path, cfg, builtin }: FeedbackProps) {
    const target = useTarget(cfg, builtin)
    const ref = useRef<HTMLDivElement>(null)
    const [state, setState] = useState<'idle' | 'open' | 'sent'>('idle')
    if (target === undefined || (target === null && cfg.endpoint !== false)) return null

    const send = (comment: string) => {
        const wrap = ref.current?.closest('.aiui-code-fb')
        const all = Array.from(wrap?.closest('main')?.querySelectorAll('.aiui-code-fb') ?? [])
        void sendVote(target, { id: newVoteId(), path, value: -1, kind: 'code', block: Math.max(0, all.indexOf(wrap!)), comment })
        setState('sent')
    }
    return (
        <div ref={ref} className="aiui-code-flag" data-open={state !== 'idle' ? '' : undefined}>
            {state === 'idle' && <button type="button" aria-label="Report a problem with this code" title="Report a problem with this code"
                onClick={() => setState('open')}><Thumb down /></button>}
            {state === 'open' && <CommentForm label="What is wrong with this code? (optional)" onSend={send} onCancel={() => setState('idle')} />}
            {state === 'sent' && <p role="status">Thanks for flagging this code.</p>}
        </div>
    )
}
