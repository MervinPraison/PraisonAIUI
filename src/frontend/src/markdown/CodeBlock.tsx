/**
 * Chat code blocks (the `code` element override of the chat variant).
 *
 * A fence longer than CODE_COLLAPSE_LINES (or --aiui-code-lines) lines shows that many lines with
 * the last 24 px faded and a "Show all N lines" toggle, so one long block
 * never fills the first screen of a turn. Every block gets a wrap toggle in
 * its header (on by default on a phone, where a long line would otherwise
 * lose a third of its width) and, while a line runs past the right edge,
 * a fade on that edge that says the body scrolls sideways.
 *
 * Inline code, diagrams (mermaid) and anything else Streamdown renders from
 * `code` go to its own component unchanged. Styles: markdown.css.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { WrapText } from 'lucide-react'
import { defaultComponents, type ExtraProps } from 'streamdown'
import SheetViewer from '@/layout-features/artifacts/viewers/SheetGrid'
import WhiteboardViewer from '@/layout-features/artifacts/viewers/Whiteboard'

type Props = JSX.IntrinsicElements['code'] & ExtraProps

const DefaultCode = defaultComponents.code as (p: Props) => ReactNode

export const CODE_COLLAPSE_LINES = 12
const PHONE = '(max-width: 639.98px)'

/** The fence's text (Streamdown hands block code over as one string child). */
function codeText(children: ReactNode): string {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(codeText).join('')
    const props = (children as { props?: { children?: ReactNode } } | null)?.props
    return props ? codeText(props.children) : ''
}

/** Lines in a fence, ignoring the trailing newline Streamdown also trims. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests and sibling modules
export function codeLineCount(text: string): number {
    const trimmed = text.replace(/\n+$/, '')
    return trimmed ? trimmed.split('\n').length : 0
}

function phoneWidth(): boolean {
    try {
        return typeof window !== 'undefined' && window.matchMedia(PHONE).matches
    } catch {
        return false
    }
}

/** ```whiteboard and ```sheet fences draw the board and the grid, not the JSON. */
function studioKind(props: Props): 'whiteboard' | 'sheet' | 'excalidraw' | null {
    const raw = `${props.className ?? ''} ${(props as { 'data-language'?: string })['data-language'] ?? ''}`
    const tokens = new Set(raw.split(/\s+/).filter(Boolean))
    if (tokens.has('language-excalidraw') || tokens.has('excalidraw')) return 'excalidraw'
    if (tokens.has('language-whiteboard') || tokens.has('whiteboard')) return 'whiteboard'
    if (tokens.has('language-sheet') || tokens.has('sheet')) return 'sheet'
    return null
}

export function ChatCode(props: Props) {
    const studio = studioKind(props)
    if (studio && 'data-block' in props) {
        const text = codeText(props.children)
        if (studio === 'excalidraw') return <ExcalidrawSlot content={text} />
        return studio === 'whiteboard' ? <WhiteboardViewer content={text} /> : <SheetViewer content={text} />
    }
    const block = 'data-block' in props && !/\blanguage-mermaid\b/.test(props.className ?? '')
    return block ? <CollapsibleCode {...props} /> : <DefaultCode {...props} />
}

/** Loaded only in the browser. Excalidraw touches window and is too large for the chat entry. */
function ExcalidrawSlot({ content }: { content: string }) {
    const [Board, setBoard] = useState<((p: { content: string }) => JSX.Element) | null>(null)
    useEffect(() => {
        let live = true
        import('@/excalidraw/ExcalidrawBoard').then(
            (m) => { if (live) setBoard(() => m.default) },
            () => { if (live) setBoard(null) },
        )
        return () => { live = false }
    }, [])
    if (!Board) {
        return (
            <div data-excalidraw="loading" className="flex h-72 items-center justify-center rounded-lg border border-hairline text-sm text-tier-3">
                Loading diagram…
            </div>
        )
    }
    return <Board content={content} />
}

function CollapsibleCode(props: Props) {
    const lines = codeLineCount(codeText(props.children))
    // A layout may set another limit with --aiui-code-lines (chat-canvas: layout.options collapseLines).
    const [limit, setLimit] = useState(CODE_COLLAPSE_LINES)
    const long = lines > limit
    const [open, setOpen] = useState(false)
    // null: follow the width (wrap on a phone); a press decides from then on.
    const [chosen, setChosen] = useState<boolean | null>(null)
    const [phone, setPhone] = useState(phoneWidth)
    const wrap = chosen ?? phone
    const root = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = root.current
        const v = el ? Number.parseInt(getComputedStyle(el).getPropertyValue('--aiui-code-lines'), 10) : NaN
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM (or a lazy module) after mount; one update, no loop
        if (v > 0) setLimit(v)
        try {
            const mq = window.matchMedia(PHONE)
            const on = () => setPhone(mq.matches)
            mq.addEventListener('change', on)
            return () => mq.removeEventListener('change', on)
        } catch {
            return undefined
        }
    }, [])

    // The right-edge fade: on while the body can scroll further right. The
    // body is replaced once the highlighter loads, so it is looked up on
    // every check; scroll is caught on the way down (it does not bubble).
    useEffect(() => {
        const el = root.current
        if (!el) return
        const update = () => {
            const body = el.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')
            const more = !!body && body.scrollWidth - body.scrollLeft - body.clientWidth > 1
            el.toggleAttribute('data-more-right', more)
        }
        update()
        el.addEventListener('scroll', update, { capture: true, passive: true })
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        ro?.observe(el)
        const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
        mo?.observe(el, { childList: true, subtree: true })
        return () => {
            el.removeEventListener('scroll', update, { capture: true })
            ro?.disconnect()
            mo?.disconnect()
        }
    }, [wrap, open])

    return (
        <div
            ref={root}
            className="aiui-code"
            data-aiui-code=""
            data-collapsed={long && !open ? '' : undefined}
            data-long={long ? '' : undefined}
            data-wrap={wrap ? 'on' : 'off'}
        >
            <DefaultCode {...props} />
            <button
                type="button"
                className="aiui-code-wrap"
                aria-pressed={wrap}
                aria-label="Wrap long lines"
                title="Wrap long lines"
                onClick={() => setChosen(!wrap)}
            >
                <WrapText aria-hidden className="size-3.5" />
            </button>
            {long && (
                <button type="button" className="aiui-code-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                    {open ? 'Show less' : `Show all ${lines} lines`}
                </button>
            )}
        </div>
    )
}
