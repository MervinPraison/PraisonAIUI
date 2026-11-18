/**
 * Renderers for <aiui-admonition> / <aiui-tabs> / <aiui-tab>, emitted by
 * convertMkdocsBlocks. Flat: a tone hairline on the left and a faint fill, no
 * boxed card. Tokens only (semantic tones come from theme.css).
 */
import { Children, isValidElement, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TONE: Record<string, string> = {
    note: 'border-l-info', info: 'border-l-info', abstract: 'border-l-info', summary: 'border-l-info', tldr: 'border-l-info',
    tip: 'border-l-success', hint: 'border-l-success', important: 'border-l-success', success: 'border-l-success', check: 'border-l-success', done: 'border-l-success',
    question: 'border-l-primary', help: 'border-l-primary', faq: 'border-l-primary', example: 'border-l-primary', quote: 'border-l-primary', cite: 'border-l-primary',
    warning: 'border-l-warning', caution: 'border-l-warning', attention: 'border-l-warning',
    danger: 'border-l-destructive', error: 'border-l-destructive', failure: 'border-l-destructive', fail: 'border-l-destructive', missing: 'border-l-destructive', bug: 'border-l-destructive',
}

type BlockProps = { children?: ReactNode; title?: string; type?: string; collapsible?: string }
/** Docs extras (docs/DocsBlocks.tsx passes them): an anchor id, an icon and a line under the title. */
type AdmonitionProps = BlockProps & { id?: string; icon?: ReactNode; description?: string }

export function Admonition({ children, title, type = 'note', collapsible, id, icon, description }: AdmonitionProps) {
    const kind = type.toLowerCase()
    const heading = title || kind.charAt(0).toUpperCase() + kind.slice(1)
    const cls = cn(
        'aiui-admonition my-4 rounded-r-lg border-l-2 bg-muted/50 px-4 py-3',
        TONE[kind] ?? 'border-l-primary',
    )
    const body = '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
    if (collapsible) {
        return (
            <details id={id} className={cn(cls, 'group')} data-type={kind} open={collapsible === 'open'}>
                <summary className="cursor-pointer select-none font-semibold text-foreground marker:text-muted-foreground">
                    {icon}
                    {heading}
                    {description && <span className="aiui-admonition-desc block text-sm font-normal text-muted-foreground">{description}</span>}
                </summary>
                <div className={cn('mt-2', body)}>{children}</div>
            </details>
        )
    }
    return (
        <div id={id} className={cls} data-type={kind} role="note" aria-label={heading}>
            <p className="mb-1.5 font-semibold text-foreground">{heading}</p>
            <div className={body}>{children}</div>
        </div>
    )
}

export function MkdocsTab({ children }: BlockProps) {
    return <div className="aiui-tab">{children}</div>
}

type TabsProps = BlockProps & {
    /** The selected tab, when the caller owns it (docs/DocsTabs.tsx syncs tabs across the page). */
    value?: number
    onValueChange?: (index: number) => void
    /** A tab's label (default: its title). */
    label?: (tab: ReactElement<BlockProps>, index: number) => ReactNode
    className?: string
}

/** Tab strip; panels stay mounted (hidden) so in-page anchors and the TOC still resolve. */
export function MkdocsTabs({ children, value, onValueChange, label, className }: TabsProps) {
    const tabs = Children.toArray(children).filter(
        (c): c is ReactElement<BlockProps> => isValidElement<BlockProps>(c) && typeof c.props.title === 'string',
    )
    const [own, setOwn] = useState(0)
    const active = Math.max(0, Math.min(value ?? own, tabs.length - 1))
    const setActive = (i: number) => {
        setOwn(i)
        onValueChange?.(i)
    }
    const base = useId()
    const buttons = useRef<(HTMLButtonElement | null)[]>([])
    if (tabs.length === 0) return <>{children}</>

    const focusTab = (i: number) => {
        const n = (i + tabs.length) % tabs.length
        setActive(n)
        buttons.current[n]?.focus()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowRight') focusTab(active + 1)
        else if (e.key === 'ArrowLeft') focusTab(active - 1)
        else if (e.key === 'Home') focusTab(0)
        else if (e.key === 'End') focusTab(tabs.length - 1)
        else return
        e.preventDefault()
    }

    return (
        <div className={cn('aiui-tabs my-4 min-w-0', className)} data-aiui-tabs="">
            <div role="tablist" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-border">
                {tabs.map((t, i) => (
                    <button
                        key={i}
                        ref={(el) => { buttons.current[i] = el }}
                        id={`${base}-tab-${i}`}
                        type="button"
                        role="tab"
                        aria-selected={i === active}
                        aria-controls={`${base}-panel-${i}`}
                        tabIndex={i === active ? 0 : -1}
                        onClick={() => setActive(i)}
                        className={cn(
                            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            i === active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {label ? label(t, i) : t.props.title}
                    </button>
                ))}
            </div>
            {tabs.map((t, i) => (
                <div
                    key={i}
                    id={`${base}-panel-${i}`}
                    role="tabpanel"
                    aria-labelledby={`${base}-tab-${i}`}
                    hidden={i !== active}
                    className="min-w-0 pt-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                >
                    {t.props.children}
                </div>
            ))}
        </div>
    )
}
