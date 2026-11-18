// The docs `pre` override (Content.tsx passes it to <Markdown variant="docs">):
// a fence with options (docs/codeMeta.ts) gets a frame: the title and icon in
// the header, highlighted, focused and diff lines, a line-number gutter,
// wrapping, a collapsed long block, no copy button. Lines are styled by a
// scoped rule over the Shiki output Streamdown draws (one span per line), so
// the highlighter is untouched. Docs-only on purpose: the markdown chunk the
// chat shares stays unchanged.
import { cloneElement, isValidElement, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { parseCodeMeta, parseCodeNotation } from './codeMeta'
import { DOCS_HOME_ICONS, DocsHomeIcon } from './docsHomeIcons'

interface HastNode {
    tagName?: string
    properties?: Record<string, unknown>
    children?: HastNode[]
}

interface DocsPreProps {
    node?: HastNode
    children?: ReactNode
}

/** An `expandable` block longer than this shows this many lines (the chat collapse uses the same). */
const EXPANDABLE_LINES = 12

/** The fence's meta string: Streamdown keeps it on the code element. */
function fenceMeta(node?: HastNode): string | undefined {
    const code = node?.children?.find((c) => c.tagName === 'code')
    const meta = code?.properties?.metastring
    return typeof meta === 'string' ? meta : undefined
}

const nth = (lines: number[]) => lines.map((n) => `:nth-child(${n})`).join(',')

/** The scoped rule that marks lines: highlight, diff add / remove, and dimming outside the focus. */
function lineRules(id: string, marks: { highlight: number[]; add: number[]; remove: number[]; focus: number[] }): string {
    const line = `#${id} pre > code > span`
    const rules: string[] = []
    if (marks.highlight.length) rules.push(`${line}:is(${nth(marks.highlight)}) { --aiui-line-bg: var(--aiui-code-hl); --aiui-line-edge: var(--aiui-code-hl-edge); }`)
    if (marks.add.length) rules.push(`${line}:is(${nth(marks.add)}) { --aiui-line-bg: var(--aiui-code-add); --aiui-line-edge: var(--success); --aiui-line-sign: '+'; }`)
    if (marks.remove.length) rules.push(`${line}:is(${nth(marks.remove)}) { --aiui-line-bg: var(--aiui-code-remove); --aiui-line-edge: var(--destructive); --aiui-line-sign: '-'; }`)
    // Hovering or focusing the block shows every line sharp again.
    if (marks.focus.length) rules.push(`#${id}:not(:hover, :focus-within) pre > code > span:not(${nth(marks.focus)}) { opacity: var(--aiui-code-dim); filter: var(--aiui-code-blur); }`)
    return rules.join('\n')
}

export function DocsPre({ node, children }: DocsPreProps) {
    const id = `aiui-code-${useId().replace(/[^\w-]/g, '')}`
    const [open, setOpen] = useState(false)
    const meta = parseCodeMeta(fenceMeta(node))
    const child = isValidElement(children) ? (children as ReactElement<{ children?: ReactNode; className?: string }>) : null
    const text = typeof child?.props.children === 'string' ? child.props.children : ''
    const notation = parseCodeNotation(text)
    const marks = {
        highlight: [...new Set([...meta.highlight, ...(notation?.highlight ?? [])])],
        focus: [...new Set([...meta.focus, ...(notation?.focus ?? [])])],
        add: notation?.add ?? [],
        remove: notation?.remove ?? [],
    }
    // Streamdown's own `pre` marks its child as a block, which is how the
    // code renderer tells a fence from inline code: keep that. Notation
    // comments leave the code (and so what the copy button copies).
    const block = child
        ? cloneElement(child as ReactElement<Record<string, unknown>>, { 'data-block': 'true', ...(notation ? { children: notation.code } : {}) })
        : children
    const lineCount = (notation?.code ?? text).replace(/\n+$/, '').split('\n').length
    const long = !!meta.expandable && lineCount > EXPANDABLE_LINES
    const marked = Object.values(marks).some((l) => l.length > 0)
    const { title, icon, lineNumbers, wrap, nocopy } = meta
    if (!title && !icon && !marked && !lineNumbers && !wrap && !nocopy && !long) return <>{block}</>

    const rules = marked ? lineRules(id, marks) : ''
    const glyph = icon ? <DocsHomeIcon name={DOCS_HOME_ICONS[icon.toLowerCase()] ? icon : /terminal|bash|shell/i.test(icon) ? 'terminal' : 'code'} /> : null
    return (
        <div
            id={id}
            className="aiui-code-frame"
            data-titled={title || icon ? '' : undefined}
            data-marked={marked ? '' : undefined}
            data-diff={marks.add.length || marks.remove.length ? '' : undefined}
            data-focus={marks.focus.length ? '' : undefined}
            data-lines={lineNumbers ? '' : undefined}
            data-wrap={wrap ? '' : undefined}
            data-nocopy={nocopy ? '' : undefined}
            data-long={long ? '' : undefined}
            data-collapsed={long && !open ? '' : undefined}
            style={lineNumbers ? ({ '--aiui-ln-w': `${String(lineCount).length}ch` } as CSSProperties) : undefined}
        >
            {(title || glyph) && (
                <div className="aiui-code-title">
                    {glyph}
                    {title ?? /language-(\S+)/.exec(child?.props.className ?? '')?.[1]}
                </div>
            )}
            {rules && <style>{rules}</style>}
            {block}
            {long && (
                <button type="button" className="aiui-code-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                    {open ? 'Show less' : `Show all ${lineCount} lines`}
                </button>
            )}
        </div>
    )
}
