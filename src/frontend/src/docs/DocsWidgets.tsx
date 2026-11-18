// More docs components (markdown/docsTags.ts): <Badge>, <Tooltip>, <Tile>,
// <Prompt>, <Tree> and <Color>, plus the `aiui-slot` children that carry an
// attribute written in Markdown (<Frame caption>, <Tile title>, ...).
// Styles: docs/docs.css (.aiui-badge, .aiui-tooltip, .aiui-tile, .aiui-prompt,
// .aiui-tree, .aiui-colors). Colours are tokens or a validated author value.
/* eslint-disable react-refresh/only-export-components -- accent() and slots() are shared with DocsBlocks.tsx */
import { Children, isValidElement, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight, File, Folder } from 'lucide-react'
import { cardHref } from './cardHref'
import { isExternal } from './chrome'
import { DocsHomeIcon } from './docsHomeIcons'
import { copyText, promptLinks } from './pageActionLinks'

type Kids = { children?: ReactNode }

/** An author's colour (`#0f766e`, `teal`, `rgb(…)`): kept only when it is plainly one. */
const COLOR = /^(#[\da-f]{3,8}|[a-z]{3,20}|(rgb|hsl|oklch)a?\([\d\s.,%/-]+\))$/i
const TOKENS = new Set(['primary', 'info', 'success', 'warning', 'destructive', 'muted-foreground'])
/** A theme token name (`success`) → its variable; a plain colour as written; anything else → undefined. */
export const accent = (c?: string) => (!c ? undefined : TOKENS.has(c) ? `var(--${c})` : COLOR.test(c) ? c : undefined)

/** Markdown written in an attribute, rendered where its component puts it. */
export const Slot = ({ slot, children }: Kids & { slot?: string }) => <div className="aiui-slot" data-slot={slot}>{children}</div>

/** A component's `aiui-slot` children by name, and the rest. */
export function slots(children: ReactNode): [Record<string, ReactNode>, ReactNode[]] {
    const named: Record<string, ReactNode> = {}
    const rest: ReactNode[] = []
    for (const c of Children.toArray(children)) {
        const slot = isValidElement<{ slot?: string }>(c) ? c.props.slot : undefined
        if (slot) named[slot] = c
        else rest.push(c)
    }
    return [named, rest]
}

const link = (href?: string) => {
    const url = href ? cardHref(href) : undefined
    return url ? { href: url, ...(isExternal(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {}) } : undefined
}

// Mintlify's badge colours → theme tokens.
const BADGE_TONE: Record<string, string> = {
    gray: 'muted-foreground', white: 'muted-foreground', surface: 'muted-foreground',
    blue: 'info', green: 'success', yellow: 'warning', orange: 'warning', red: 'destructive', purple: 'primary',
}

type BadgeProps = Kids & { color?: string; size?: string; shape?: string; icon?: string; stroke?: string; off?: string }

export function Badge({ color = 'gray', size, shape, icon, stroke, off, children }: BadgeProps) {
    const tone = accent(BADGE_TONE[color] ?? (color.endsWith('destructive') ? 'destructive' : color))
    return (
        <span
            className="aiui-badge"
            data-size={size}
            data-shape={shape}
            data-stroke={stroke ? '' : undefined}
            aria-disabled={off ? true : undefined}
            style={tone ? ({ '--aiui-tone': tone } as CSSProperties) : undefined}
        >
            {icon && <DocsHomeIcon name={icon} />}
            {children}
        </span>
    )
}

/** Keeps a tooltip inside the viewport on a phone. */
function fitTip(e: { currentTarget: HTMLElement }) {
    const tip = e.currentTarget.querySelector<HTMLElement>('.aiui-tooltip-tip')
    if (!tip) return
    tip.style.setProperty('--aiui-tip-dx', '0px')
    const r = tip.getBoundingClientRect()
    tip.style.setProperty('--aiui-tip-dx', `${Math.max(8 - r.left, 0) - Math.max(r.right - (window.innerWidth - 8), 0)}px`)
}

type TooltipProps = Kids & { tip?: string; headline?: string; cta?: string; href?: string }

/** A dotted term that explains itself on hover or keyboard focus; Escape hides it. */
export function Tooltip({ tip, headline, cta, href, children }: TooltipProps) {
    const id = useId()
    const [hidden, setHidden] = useState(false)
    const to = link(href)
    if (!tip) return <>{children}</>
    return (
        <span
            className="aiui-tooltip"
            tabIndex={0}
            aria-describedby={id}
            data-hidden={hidden ? '' : undefined}
            onMouseEnter={(e) => { setHidden(false); fitTip(e) }}
            onFocus={(e) => { setHidden(false); fitTip(e) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setHidden(true) }}
        >
            {children}
            <span className="aiui-tooltip-tip" role="tooltip" id={id}>
                {headline && <strong>{headline}</strong>}
                {tip}
                {cta && to && <a {...to}>{cta}</a>}
            </span>
        </span>
    )
}

/** A preview (an image or drawing), then the title and a line of description; the whole tile is the link. */
export function Tile({ href, description, children }: Kids & { href?: string; description?: string }) {
    const [named, preview] = slots(children)
    const to = link(href)
    const inner = (
        <>
            <span className="aiui-tile-preview">{preview}</span>
            {named.title}
            {description && <span className="aiui-tile-desc">{description}</span>}
        </>
    )
    return to ? <a className="aiui-tile" data-link="" {...to}>{inner}</a> : <div className="aiui-tile">{inner}</div>
}

const PROMPT_ACTIONS = ['copy', 'chatgpt', 'claude', 'cursor'] as const
const ACTION_LABEL: Record<string, string> = { chatgpt: 'Open in ChatGPT', claude: 'Open in Claude', cursor: 'Open in Cursor' }

type PromptProps = Kids & { actions?: string; icon?: string; text?: string }

/** A prompt to hand an assistant: what it does, the prompt itself (folded), Copy and Open in ChatGPT / Claude / Cursor. */
export function Prompt({ actions = 'copy,chatgpt,claude', icon, text, children }: PromptProps) {
    const [named, body] = slots(children)
    const [copied, setCopied] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const prompt = () => text || ref.current?.innerText.trim() || ''
    const wanted = PROMPT_ACTIONS.filter((a) => actions.split(',').includes(a))
    const open = (e: MouseEvent<HTMLAnchorElement>, a: 'chatgpt' | 'claude' | 'cursor') => { e.currentTarget.href = promptLinks(prompt())[a] }
    return (
        <div className="aiui-prompt">
            <div className="aiui-prompt-head">
                {icon && <DocsHomeIcon name={icon} />}
                {named.description}
            </div>
            <details>
                <summary>Show prompt</summary>
                <div className="aiui-prompt-body" ref={ref}>{body}</div>
            </details>
            <div className="aiui-prompt-actions">
                {wanted.map((a) =>
                    a === 'copy' ? (
                        <button key={a} type="button" onClick={() => void copyText(prompt()).then(setCopied)}>
                            {copied ? 'Copied' : 'Copy prompt'}
                        </button>
                    ) : (
                        <a key={a} href={promptLinks(text ?? '')[a]} target="_blank" rel="noopener noreferrer" onClick={(e) => open(e, a)}>
                            {ACTION_LABEL[a]}
                        </a>
                    ),
                )}
            </div>
        </div>
    )
}

/** Arrow keys walk the visible rows; Right opens a folder, Left closes it or goes to its parent. */
function onTreeKey(e: KeyboardEvent<HTMLDivElement>) {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.aiui-tree-row')
    if (!row) return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.aiui-tree-row')].filter((r) => r.getClientRects().length > 0)
    const i = rows.indexOf(row)
    const folder = row.tagName === 'SUMMARY' ? (row.parentElement as HTMLDetailsElement) : null
    const go: Record<string, () => HTMLElement | null | undefined> = {
        ArrowDown: () => rows[i + 1],
        ArrowUp: () => rows[i - 1],
        Home: () => rows[0],
        End: () => rows[rows.length - 1],
        ArrowRight: () => (folder && !folder.open ? ((folder.open = true), null) : rows[i + 1]),
        ArrowLeft: () => (folder?.open ? ((folder.open = false), null) : (folder ?? row).parentElement?.closest('details')?.querySelector('summary')),
    }
    if (!go[e.key]) return
    e.preventDefault()
    go[e.key]()?.focus()
}

export const Tree = ({ children }: Kids) => <div className="aiui-tree" onKeyDown={onTreeKey}>{children}</div>

type TreeProps = Kids & { name?: string; opened?: string; fixed?: string; hl?: string }

export function TreeFolder({ name, opened, fixed, hl, children }: TreeProps) {
    const head = (
        <>
            <ChevronRight className="aiui-tree-chevron" aria-hidden="true" />
            <Folder aria-hidden="true" />
            {name}
        </>
    )
    if (fixed) {
        return (
            <div className="aiui-tree-folder" data-hl={hl ? '' : undefined} data-open={opened ? '' : undefined}>
                <div className="aiui-tree-row" tabIndex={0}>{head}</div>
                {opened && <div className="aiui-tree-children">{children}</div>}
            </div>
        )
    }
    return (
        <details className="aiui-tree-folder" data-hl={hl ? '' : undefined} open={!!opened}>
            <summary className="aiui-tree-row">{head}</summary>
            <div className="aiui-tree-children">{children}</div>
        </details>
    )
}

export const TreeFile = ({ name, hl }: TreeProps) => (
    <div className="aiui-tree-row aiui-tree-file" tabIndex={0} data-hl={hl ? '' : undefined} aria-current={hl ? 'true' : undefined}>
        <File aria-hidden="true" />
        {name}
    </div>
)

export const Colors = ({ variant, children }: Kids & { variant?: string }) => (
    <div className="aiui-colors" data-variant={variant === 'table' ? 'table' : 'compact'}>{children}</div>
)

export function ColorRow({ children }: Kids) {
    const [named, items] = slots(children)
    return (
        <div className="aiui-color-row">
            {named.title}
            <div className="aiui-color-items">{items}</div>
        </div>
    )
}

/** One swatch (its light and dark values when both are given); a click copies the value shown. */
export function ColorItem({ name, value, dark }: { name?: string; value?: string; dark?: string }) {
    const [copied, setCopied] = useState(false)
    const light = accent(value)
    const night = accent(dark) ?? light
    if (!light || !value) return null
    const shown = dark && night ? `${value} / ${dark}` : value
    const copy = () => {
        const isDark = document.documentElement.classList.contains('dark')
        void copyText(isDark && dark ? dark : value).then(setCopied)
    }
    return (
        <button
            type="button"
            className="aiui-color"
            style={{ '--aiui-swatch': light, '--aiui-swatch-dark': night } as CSSProperties}
            onClick={copy}
            aria-label={`Copy ${name ? `${name}, ` : ''}${shown}`}
        >
            <span className="aiui-color-swatch" />
            {name && <span className="aiui-color-name">{name}</span>}
            <code>{copied ? 'Copied' : shown}</code>
        </button>
    )
}
