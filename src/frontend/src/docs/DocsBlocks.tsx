// The docs components' React side: one component per `aiui-*` element the
// tag table (markdown/docsTags.ts) turns <Steps>, <Step>, <CardGroup>,
// <Card>, <Columns>, <Frame> and <AccordionGroup> into, and the docs versions
// of callouts and tabs (DocsTabs.tsx). Content.tsx passes the map to
// the docs <Markdown>, so the markdown chunk the chat shares is unchanged.
// A new component: an entry in DOCS_TAGS plus its renderer here.
/* eslint-disable react-refresh/only-export-components -- the element → component map is this module's contract */
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { Admonition, MkdocsTab } from '../markdown/MkdocsBlocks'
import { ApiField, Expandable, Panel } from './ApiFields'
import { slugify } from '../markdown/slug'
import { isExternal } from './chrome'
import { cardHref } from './cardHref'
import { DocsHomeIcon } from './docsHomeIcons'
import { DocsTabs } from './DocsTabs'

type BlockProps = { title?: string; children?: ReactNode }
type CardProps = BlockProps & {
    icon?: string; href?: string; horizontal?: string; img?: string; cta?: string; arrow?: string; color?: string
}

const on = (v?: string) => v !== undefined && v !== 'false'
/** An author's colour (`#0f766e`, `teal`, `rgb(…)`): kept only when it is plainly one. */
const COLOR = /^(#[\da-f]{3,8}|[a-z]{3,20}|(rgb|hsl|oklch)a?\([\d\s.,%/-]+\))$/i

function Card({ title, icon, href, horizontal, img, cta, arrow, color, children }: CardProps) {
    const glyph = icon ? <DocsHomeIcon name={icon} /> : null
    const external = !!href && isExternal(href)
    // A link card shows an arrow when asked, and by default when it leaves the site.
    const showArrow = !!href && (arrow === undefined ? external : on(arrow))
    const image = img && !on(horizontal) ? cardHref(img) : undefined // a horizontal card is one row: no header image
    const inner = (
        <>
            {image && <img className="aiui-card-img" src={image} alt="" loading="lazy" />}
            {glyph && <span className="aiui-card-icon">{glyph}</span>}
            {title && <span className="aiui-card-title">{title}</span>}
            <span className="aiui-card-body">{children}</span>
            {cta && (
                <span className="aiui-card-cta">
                    {cta}
                    <DocsHomeIcon name="arrow-right" />
                </span>
            )}
            {showArrow && <DocsHomeIcon name={external ? 'arrow-up-right' : 'arrow-right'} className="aiui-card-arrow" />}
        </>
    )
    const props = {
        className: 'aiui-card',
        'data-horizontal': on(horizontal) ? '' : undefined,
        'data-img': image ? '' : undefined,
        style: color && COLOR.test(color) ? ({ '--aiui-card-accent': color } as CSSProperties) : undefined,
    }
    if (!href) return <div {...props}>{inner}</div>
    return (
        <a {...props} data-link="" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {inner}
        </a>
    )
}

/** `titleSize` on <Steps>: every step title is that heading, so it joins "On this page". */
const StepHeading = createContext<string | undefined>(undefined)
const HEADINGS = new Set(['h2', 'h3', 'h4'])

const Steps = ({ heading, children }: BlockProps & { heading?: string }) => (
    <StepHeading.Provider value={heading}>
        <ol className="aiui-steps">{children}</ol>
    </StepHeading.Provider>
)
const Accordions = ({ children }: BlockProps) => <div className="aiui-accordions">{children}</div>

type StepProps = BlockProps & { heading?: string; num?: string; icon?: string; anchor?: string }

function Step({ title, heading, num, icon, anchor, children }: StepProps) {
    const inherited = useContext(StepHeading)
    const level = heading ?? inherited
    const Title = level && HEADINGS.has(level) ? (level as 'h2') : 'p'
    const id = anchor ?? (Title !== 'p' && title ? slugify(title) : undefined)
    const n = Number.parseInt(num ?? '', 10)
    const glyph = icon ? <DocsHomeIcon name={icon} /> : null
    return (
        <li
            className="aiui-step"
            id={Title === 'p' ? id : undefined}
            data-icon={glyph ? '' : undefined}
            style={Number.isNaN(n) ? undefined : { counterSet: `aiui-step ${n}` }}
        >
            {glyph && <span className="aiui-step-icon">{glyph}</span>}
            {title && <Title className="aiui-step-title" id={Title === 'p' ? undefined : id}>{title}</Title>}
            <div className="aiui-step-body">{children}</div>
        </li>
    )
}

function Cards({ cols, children }: BlockProps & { cols?: string | number }) {
    const n = Math.min(Math.max(Number(cols) || 2, 1), 4)
    return <div className="aiui-cards" style={{ '--aiui-cards-cols': n } as CSSProperties}>{children}</div>
}

const Column = ({ children }: BlockProps) => <div className="aiui-column">{children}</div>

/** Callouts and accordions: the shared Admonition, plus the docs' icon, description and anchor. */
function DocsAdmonition({ icon, anchor, ...rest }: Parameters<typeof Admonition>[0] & { icon?: string; anchor?: string }) {
    return <Admonition {...rest} id={anchor} icon={icon ? <DocsHomeIcon name={icon} className="aiui-admonition-icon" /> : undefined} />
}

const CardTag = ({ href, ...rest }: CardProps) => <Card {...rest} href={href ? cardHref(href) : undefined} />

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
    'aiui-column': Column,
    'aiui-admonition': DocsAdmonition,
    'aiui-tabs': DocsTabs,
    'aiui-tab': MkdocsTab,
    'aiui-field': ApiField,
    'aiui-expandable': Expandable,
    'aiui-panel': Panel,
}
