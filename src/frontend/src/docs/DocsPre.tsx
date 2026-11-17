// The docs `pre` override (Content.tsx passes it to <Markdown variant="docs">):
// a fence with a file name or highlighted lines gets a frame with the name
// in the header and its lines tinted. Docs-only on purpose: the markdown
// chunk the chat shares stays unchanged.
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { parseCodeMeta } from './codeMeta'

interface HastNode {
    tagName?: string
    properties?: Record<string, unknown>
    children?: HastNode[]
}

interface DocsPreProps {
    node?: HastNode
    children?: ReactNode
}

/** The fence's meta string: Streamdown keeps it on the code element. */
function fenceMeta(node?: HastNode): string | undefined {
    const code = node?.children?.find((c) => c.tagName === 'code')
    const meta = code?.properties?.metastring
    return typeof meta === 'string' ? meta : undefined
}

export function DocsPre({ node, children }: DocsPreProps) {
    const id = `aiui-code-${useId().replace(/[^\w-]/g, '')}`
    // Streamdown's own `pre` marks its child as a block, which is how the
    // code renderer tells a fence from inline code: keep that.
    const block = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-block': 'true' }) : children
    const { title, lines } = parseCodeMeta(fenceMeta(node))
    if (!title && lines.length === 0) return <>{block}</>

    const lineRule = lines.length
        ? `#${id} pre > code > span:is(${lines.map((n) => `:nth-child(${n})`).join(',')}) { background: var(--aiui-code-hl); box-shadow: inset 2px 0 var(--aiui-code-hl-edge); }`
        : ''
    return (
        <div id={id} className="aiui-code-frame" data-titled={title ? '' : undefined} data-highlighted={lines.length ? '' : undefined}>
            {title && <div className="aiui-code-title">{title}</div>}
            {lineRule && <style>{lineRule}</style>}
            {block}
        </div>
    )
}
