// The docs components' React side: one component per `aiui-*` element the
// tag table (markdown/docsTags.ts) turns <Steps>, <Step>, <CardGroup>,
// <Card>, <Frame> and <AccordionGroup> into. Content.tsx passes the map to
// the docs <Markdown>, so the markdown chunk the chat shares is unchanged.
// A new component: an entry in DOCS_TAGS plus its renderer here.
/* eslint-disable react-refresh/only-export-components -- the element → component map is this module's contract */
import type { CSSProperties, ReactNode } from 'react'
import { isExternal } from './chrome'
import { cardHref } from './cardHref'
import { DOCS_HOME_ICONS, DocsHomeIcon } from './docsHomeIcons'

type BlockProps = { title?: string; children?: ReactNode }

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

const Steps = ({ children }: BlockProps) => <ol className="aiui-steps">{children}</ol>
const Accordions = ({ children }: BlockProps) => <div className="aiui-accordions">{children}</div>

function Step({ title, children }: BlockProps) {
    return (
        <li className="aiui-step">
            {title && <p className="aiui-step-title">{title}</p>}
            <div className="aiui-step-body">{children}</div>
        </li>
    )
}

function Cards({ cols, children }: BlockProps & { cols?: string | number }) {
    const n = Math.min(Math.max(Number(cols) || 2, 1), 4)
    return <div className="aiui-cards" style={{ '--aiui-cards-cols': n } as CSSProperties}>{children}</div>
}

const CardTag = ({ href, ...rest }: BlockProps & { icon?: string; href?: string }) => <Card {...rest} href={href ? cardHref(href) : undefined} />

function Frame({ caption, children }: BlockProps & { caption?: string }) {
    return (
        <figure className="aiui-frame">
            {children}
            {caption && <figcaption>{caption}</figcaption>}
        </figure>
    )
}

/** Element → renderer, for the elements named in DOCS_TAGS (markdown/docsTags.ts). */
export const DOCS_TAG_COMPONENTS = {
    'aiui-steps': Steps,
    'aiui-step': Step,
    'aiui-cards': Cards,
    'aiui-card': CardTag,
    'aiui-frame': Frame,
    'aiui-accordions': Accordions,
}
