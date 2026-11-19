/**
 * Ask AI over the docs: a side sheet (App.tsx opens it from the header, ⌘I /
 * Ctrl+I, `?assistant=<question>`, the search dialog and "Ask about this" on a
 * selected passage) and the same panel inline on a page with `mode: assistant`.
 * Answers stream from `aiui serve` (/api/docs/ask, docs_assistant.py), render
 * through the one Markdown pipeline and cite the sections they came from; the
 * sections are listed under each answer. Without a model on the server the
 * reader gets the best matching sections instead. A lazy chunk: it imports
 * nothing of the legacy App's (the caller passes the URL and navigation).
 */
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type MouseEvent, type SetStateAction } from 'react'
import { Check, CircleStop, Clipboard, Quote, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '../markdown/LazyMarkdown'
import { linkCitations, streamAsk, type AskSource } from './askStream'

/** What opens the panel: a question to ask at once, or a passage to ask about. */
export interface AskRequest { question?: string; context?: string; nonce: number }

interface Turn {
    question: string
    context: string
    answer: string
    sources: AskSource[]
    status: 'streaming' | 'done' | 'error' | 'unavailable'
    message?: string
}

export interface AskPanelProps {
    /** The ask endpoint: `aiui serve`'s /api/docs/ask, or `content.docs.assistant.endpoint`. */
    url: string
    starters?: string[]
    request?: AskRequest | null
    /** Opens a cited section in the app (an internal href with the base path). */
    onNavigate: (href: string) => void
}

/** The conversation, owned above the panel so it outlives the sheet closing. */
interface AskState { turns: Turn[]; setTurns: Dispatch<SetStateAction<Turn[]>>; handled: number; onHandled: (nonce: number) => void }

function useAskState(): AskState {
    const [turns, setTurns] = useState<Turn[]>([])
    const [handled, onHandled] = useState(0)
    return { turns, setTurns, handled, onHandled }
}

function AskPanel({ url, starters = [], request, onNavigate, state }: AskPanelProps & { state: AskState }) {
    const { turns, setTurns, handled, onHandled } = state
    const [draft, setDraft] = useState('')
    const [context, setContext] = useState('')
    const [copied, setCopied] = useState(-1)
    const abort = useRef<AbortController | null>(null)
    const input = useRef<HTMLTextAreaElement>(null)
    const log = useRef<HTMLDivElement>(null)
    const busy = turns.at(-1)?.status === 'streaming'

    const update = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])])

    const ask = (question: string, quoted = context) => {
        const q = question.trim()
        if (!q || busy) return
        const history = turns.filter((t) => t.status === 'done').slice(-4)
            .flatMap((t) => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.answer }])
        setTurns((all) => [...all, { question: q, context: quoted, answer: '', sources: [], status: 'streaming' }])
        setDraft('')
        setContext('')
        const controller = new AbortController()
        abort.current = controller
        void streamAsk(url, { question: q, context: quoted || undefined, page: location.pathname, history }, (e) => {
            if (e.type === 'sources') update((t) => ({ ...t, sources: e.sources }))
            else if (e.type === 'text') update((t) => ({ ...t, answer: t.answer + e.text }))
            else if (e.type === 'done') update((t) => ({ ...t, status: 'done' }))
            else update((t) => ({ ...t, status: e.type, message: e.message }))
        }, controller.signal).finally(() => update((t) => (t.status === 'streaming' ? { ...t, status: 'done' } : t)))
    }

    // A new request from the caller: ask it, or hold the passage until the reader asks.
    useEffect(() => {
        if (!request || handled === request.nonce) return
        onHandled(request.nonce)
        if (request.question) ask(request.question, request.context ?? '')
        else {
            setContext(request.context ?? '')
            input.current?.focus()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request (its nonce)
    }, [request?.nonce])
    useEffect(() => () => abort.current?.abort(), [])
    useEffect(() => {
        log.current?.lastElementChild?.scrollIntoView?.({ block: 'end' })
    }, [turns.length])

    const stop = () => abort.current?.abort()
    const copy = (i: number) => {
        void navigator.clipboard?.writeText(turns[i].answer).then(() => {
            setCopied(i)
            window.setTimeout(() => setCopied(-1), 2000)
        })
    }
    // A cited section opens in the app; links elsewhere open as links.
    const onClick = (event: MouseEvent) => {
        const a = (event.target as HTMLElement).closest?.('a')
        const href = a?.getAttribute('href')
        if (!a || !href || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        const target = new URL(href, location.href)
        if (target.origin !== location.origin) return
        event.preventDefault()
        onNavigate(target.pathname + target.hash)
    }
    const submit = (event: FormEvent) => {
        event.preventDefault()
        ask(draft)
    }

    return (
        <div className="aiui-docs-ask" onClick={onClick}>
            <div ref={log} className="aiui-docs-ask-log" role="log" aria-live="polite" aria-label="Answers">
                {!turns.length && starters.length > 0 && (
                    <div className="aiui-docs-ask-starters" role="group" aria-label="Suggested questions">
                        {starters.map((s) => (
                            <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
                        ))}
                    </div>
                )}
                {turns.map((t, i) => (
                    <section key={i} className="aiui-docs-ask-turn" aria-busy={t.status === 'streaming'}>
                        <div className="aiui-docs-ask-question">
                            {t.context && <blockquote>{t.context}</blockquote>}
                            <p>{t.question}</p>
                        </div>
                        {t.answer && (
                            <Markdown variant="chat" streaming={t.status === 'streaming'}>{linkCitations(t.answer, t.sources)}</Markdown>
                        )}
                        {t.status === 'streaming' && !t.answer && <p className="aiui-docs-ask-note">Reading the docs…</p>}
                        {t.message && <p className="aiui-docs-ask-note" role={t.status === 'error' ? 'alert' : undefined}>{t.message}</p>}
                        {t.sources.length > 0 && t.status !== 'streaming' && (
                            <ol className="aiui-docs-ask-sources" aria-label="Sources">
                                {t.sources.map((s) => (
                                    <li key={s.n} value={s.n}>
                                        <a href={s.url}>{s.heading ? `${s.title} › ${s.heading}` : s.title}</a>
                                        {t.status === 'unavailable' && s.snippet && <span>{s.snippet}</span>}
                                    </li>
                                ))}
                            </ol>
                        )}
                        {t.status === 'done' && t.answer && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => copy(i)}>
                                {copied === i ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                                {copied === i ? 'Copied' : 'Copy answer'}
                            </Button>
                        )}
                    </section>
                ))}
            </div>
            <form className="aiui-docs-ask-form" onSubmit={submit}>
                {context && (
                    <div className="aiui-docs-ask-context">
                        <Quote aria-hidden="true" />
                        <span>{context}</span>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove the quoted passage" onClick={() => setContext('')}>
                            <X aria-hidden="true" />
                        </Button>
                    </div>
                )}
                <div className="aiui-docs-ask-row">
                    <Textarea ref={input} value={draft} rows={1} maxLength={2000} aria-label="Your question"
                        placeholder={context ? 'Ask about this passage' : 'Ask a question about the docs'}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
                        }} />
                    {busy ? (
                        <Button type="button" variant="outline" size="icon" aria-label="Stop answering" onClick={stop}><CircleStop aria-hidden="true" /></Button>
                    ) : (
                        <Button type="submit" size="icon" aria-label="Ask" disabled={!draft.trim()}><SendHorizontal aria-hidden="true" /></Button>
                    )}
                </div>
                <p className="aiui-docs-ask-note">Answers are AI-generated from these docs; check the cited sections.</p>
            </form>
        </div>
    )
}

interface AskAiProps extends AskPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

/** The panel in a side sheet; a cited section closes it and opens there. */
/** The panel on a page with `mode: assistant`. */
export function AskPage(props: AskPanelProps) {
    return <AskPanel {...props} state={useAskState()} />
}

export default function AskAi({ open, onOpenChange, onNavigate, ...panel }: AskAiProps) {
    const state = useAskState()
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="aiui-docs-ask-sheet">
                <SheetHeader>
                    <SheetTitle>Ask AI</SheetTitle>
                    <SheetDescription>Answers from these docs, with the sections they came from.</SheetDescription>
                </SheetHeader>
                <AskPanel {...panel} state={state} onNavigate={(href) => {
                    onOpenChange(false)
                    onNavigate(href)
                }} />
            </SheetContent>
        </Sheet>
    )
}
