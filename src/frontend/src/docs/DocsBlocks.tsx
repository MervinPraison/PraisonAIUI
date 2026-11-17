// Docs components drawn from <div itemtype="aiui:…"> (mkdocsPreprocess turns
// <Steps>, <Step>, <CardGroup>, <Card>, <Frame> and <AccordionGroup> into
// them): the docs-only `div` override Content.tsx passes to <Markdown>. Any
// other div renders as a plain div. Docs-only, so the markdown chunk the chat
// shares is unchanged.
import type { CSSProperties, ReactNode } from 'react'
import { isExternal } from './chrome'
import { DOCS_HOME_ICONS, DocsHomeIcon } from './docsHomeIcons'
import { resolveDocTarget } from './docSource'

interface DocsDivProps {
    itemType?: string
    title?: string
    label?: string
    value?: string
    children?: ReactNode
    node?: unknown
    [key: string]: unknown
}

/** A card's link: external as written, a docs path resolved against the page on screen. */
function cardHref(target: string): string {
    if (isExternal(target) || target.startsWith('#')) return target
    const here = typeof window === 'undefined' ? '/docs/index' : window.location.pathname
    return resolveDocTarget(target, here === '/' ? '/docs/index' : here)
}

function Card({ title, icon, href, children }: { title?: string; icon?: string; href?: string; children?: ReactNode }) {
    const glyph = icon && DOCS_HOME_ICONS[icon.toLowerCase()] ? (
        <span className="aiui-card-icon"><DocsHomeIcon name={icon} /></span>
    ) : null
    const inner = (
        <>
            {glyph}
            {title && <span className="aiui-card-title">{title}</span>}
            <span className="aiui-card-body">{children}</span>
        </>
    )
    if (!href) return <div className="aiui-card">{inner}</div>
    const external = isExternal(href)
    return (
        <a
            className="aiui-card"
            data-link=""
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
            {inner}
        </a>
    )
}

export function DocsDiv({ itemType, title, label, value, children, node: _node, ...rest }: DocsDivProps) {
    void _node
    switch (itemType) {
        case 'aiui:steps':
            return <ol className="aiui-steps">{children}</ol>
        case 'aiui:step':
            return (
                <li className="aiui-step">
                    {title && <p className="aiui-step-title">{title}</p>}
                    <div className="aiui-step-body">{children}</div>
                </li>
            )
        case 'aiui:cards': {
            const cols = Math.min(Math.max(Number(value) || 2, 1), 4)
            return <div className="aiui-cards" style={{ '--aiui-cards-cols': cols } as CSSProperties}>{children}</div>
        }
        case 'aiui:card':
            return <Card title={title} icon={label} href={value ? cardHref(value) : undefined}>{children}</Card>
        case 'aiui:frame':
            return (
                <figure className="aiui-frame">
                    {children}
                    {title && <figcaption>{title}</figcaption>}
                </figure>
            )
        case 'aiui:accordions':
            return <div className="aiui-accordions">{children}</div>
        default:
            return <div {...(rest as Record<string, unknown>)} title={title}>{children}</div>
    }
}
