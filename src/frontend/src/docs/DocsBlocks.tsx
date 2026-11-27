// The docs components' React side: one component per `aiui-*` element the
// tag table (markdown/docsTags.ts) turns <Steps>, <Step>, <CardGroup>,
// <Card>, <Columns>, <Frame> and <AccordionGroup> into, and the docs versions
// of callouts and tabs (DocsTabs.tsx). Content.tsx passes the map to
// the docs <Markdown>, so the markdown chunk the chat shares is unchanged.
// A new component: an entry in DOCS_TAGS plus its renderer here.
/* eslint-disable react-refresh/only-export-components -- the element → component map is this module's contract */
import { Component as ReactComponent, createContext, lazy, Suspense, useContext, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { Admonition, MkdocsTab } from '../markdown/MkdocsBlocks'
import { ApiField, Endpoint, Expandable, Panel } from './ApiFields'
import { slugify } from '../markdown/slug'
import { isExternal } from './chrome'
import { cardHref } from './cardHref'
import { DocsHomeIcon } from './docsHomeIcons'
import { DocsTabs } from './DocsTabs'
import { Embed, Video } from './DocsMedia'
import { Update } from './DocsUpdate'
import { CustomBlock } from './CustomBlock'
import { cx } from './docsClasses'
import { Badge, ColorItem, ColorRow, Colors, Icon, Prompt, Slot, Tile, Tooltip, Tree, TreeFile, TreeFolder, accent, slots } from './DocsWidgets'

type BlockProps = { title?: string; children?: ReactNode; className?: string }
type CardProps = BlockProps & {
    icon?: string; href?: string; horizontal?: string; img?: string; cta?: string; arrow?: string; color?: string
}

const on = (v?: string) => v !== undefined && v !== 'false'

function Card({ title, icon, href, horizontal, img, cta, arrow, color, className, children }: CardProps) {
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
        className: cx('aiui-card', className),
        'data-horizontal': on(horizontal) ? '' : undefined,
        'data-img': image ? '' : undefined,
        style: accent(color) ? ({ '--aiui-card-accent': accent(color) } as CSSProperties) : undefined,
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

const Steps = ({ heading, className, children }: BlockProps & { heading?: string }) => (
    <StepHeading.Provider value={heading}>
        <ol className={cx('aiui-steps', className)}>{children}</ol>
    </StepHeading.Provider>
)
const Accordions = ({ className, children }: BlockProps) => <div className={cx('aiui-accordions', className)}>{children}</div>

type StepProps = BlockProps & { heading?: string; num?: string; icon?: string; anchor?: string }

function Step({ title, heading, num, icon, anchor, className, children }: StepProps) {
    const inherited = useContext(StepHeading)
    const level = heading ?? inherited
    const Title = level && HEADINGS.has(level) ? (level as 'h2') : 'p'
    const id = anchor ?? (Title !== 'p' && title ? slugify(title) : undefined)
    const n = Number.parseInt(num ?? '', 10)
    const glyph = icon ? <DocsHomeIcon name={icon} /> : null
    return (
        <li
            className={cx('aiui-step', className)}
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

function Cards({ cols, className, children }: BlockProps & { cols?: string | number }) {
    const n = Math.min(Math.max(Number(cols) || 2, 1), 4)
    return <div className={cx('aiui-cards', className)} style={{ '--aiui-cards-cols': n } as CSSProperties}>{children}</div>
}

const Column = ({ className, children }: BlockProps) => <div className={cx('aiui-column', className)}>{children}</div>

type DocsAdmonitionProps = Parameters<typeof Admonition>[0] & { icon?: string; anchor?: string; color?: string }

/** Callouts and accordions: the shared Admonition, plus the docs' icon, description, anchor and <Callout color>. */
function DocsAdmonition({ icon, anchor, color, ...rest }: DocsAdmonitionProps) {
    const tone = accent(color)
    return (
        <Admonition
            {...rest}
            id={anchor}
            icon={icon ? <DocsHomeIcon name={icon} className="aiui-admonition-icon" /> : undefined}
            style={tone ? ({ '--aiui-callout-accent': tone } as CSSProperties) : undefined}
        />
    )
}

const CardTag = ({ href, ...rest }: CardProps) => <Card {...rest} href={href ? cardHref(href) : undefined} />

/** A mat around an image; `hint` (Markdown) is a line above it, `caption` (Markdown) sits under it. */
function Frame({ className, children }: BlockProps) {
    const [{ hint, caption }, rest] = slots(children)
    return (
        <>
            {hint && <div className="aiui-frame-hint">{hint}</div>}
            <figure className={cx('aiui-frame', className)}>
                {rest}
                {caption && <figcaption>{caption}</figcaption>}
            </figure>
        </>
    )
}

// <Visibility for="agents"> content is for the agent-ready .md only, never the page.
const Visibility = ({ audience, children }: BlockProps & { audience?: string }) => (audience === 'agents' ? null : <>{children}</>)

// Lazy-loaded live UI block preview: loads the built BlockPage chunk at runtime
// (filled by vite.config.ts blockPagePreviewUrl) so Rollup keeps shell/mount's
// static graph unchanged (+0 B on boot/chat/layouts, R4/R10).
type PreviewProps = { title?: string; spec?: string }
type PreviewComponent = ComponentType<PreviewProps>
const BLOCK_PAGE_CHUNK = '__AIUI_BLOCK_PAGE_CHUNK__'

function findPreviewExport(mod: Record<string, unknown>): PreviewComponent | undefined {
    const def = mod.default as { Preview?: PreviewComponent } | undefined
    if (typeof def?.Preview === 'function') return def.Preview
    if (typeof mod.ComponentPreview === 'function') return mod.ComponentPreview as PreviewComponent
    for (const value of Object.values(mod)) {
        if (value && typeof value === 'object') {
            const ns = value as { ComponentPreview?: unknown; default?: { Preview?: unknown } }
            if (typeof ns.ComponentPreview === 'function') return ns.ComponentPreview as PreviewComponent
            if (typeof ns.default?.Preview === 'function') return ns.default.Preview as PreviewComponent
        }
    }
    const g = (globalThis as { __aiuiComponentPreview?: unknown }).__aiuiComponentPreview
    return typeof g === 'function' ? (g as PreviewComponent) : undefined
}

let previewPromise: Promise<{ default: PreviewComponent }> | null = null

function loadPreview(): Promise<{ default: PreviewComponent }> {
    previewPromise ??= (async (): Promise<{ default: PreviewComponent }> => {
        if (import.meta.env.DEV) {
            const m = await import('../blocks/BlockPage')
            return { default: m.ComponentPreview }
        }
        const url = new URL(BLOCK_PAGE_CHUNK, import.meta.url).href
        const m = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
        const Preview = findPreviewExport(m)
        if (!Preview) throw new Error('ComponentPreview export not found in BlockPage chunk')
        return { default: Preview }
    })().catch((err) => {
        previewPromise = null
        throw err
    })
    return previewPromise
}

const LazyPreview = lazy(loadPreview)

/** Preload the BlockPage preview chunk (and any lazy block chunks referenced in specs)
 *  in parallel with markdown plugins when a docs page contains `<aiui-preview>`. */
// eslint-disable-next-line react-refresh/only-export-components -- preload helper for Content.tsx
export async function preloadComponentPreview(markdown: string): Promise<void> {
    if (!markdown.includes('<aiui-preview')) return
    try {
        await loadPreview()
        const preloadBlocks = (globalThis as { __aiuiPreloadPreviewBlocks?: (types: Iterable<string>) => Promise<void> }).__aiuiPreloadPreviewBlocks
        if (!preloadBlocks) return
        const types = new Set<string>()
        for (const m of markdown.matchAll(/(?:&quot;|")type(?:&quot;|")\s*:\s*(?:&quot;|")([a-z0-9_]+)(?:&quot;|")/g)) {
            if (m[1]) types.add(m[1])
        }
        if (types.size > 0) await preloadBlocks(types)
    } catch {
        // Non-fatal: the lazy boundary handles and retries if needed.
    }
}

class PreviewBoundary extends ReactComponent<{ title?: string; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: unknown) {
        console.warn('[aiui docs] <ComponentPreview> failed to render', error)
    }
    render() {
        if (this.state.failed) {
            return (
                <div className="my-4 rounded-xl border border-hairline bg-fill-4 px-3 py-2 text-xs text-tier-3">
                    {this.props.title ? `${this.props.title}: preview unavailable.` : 'Preview unavailable.'}
                </div>
            )
        }
        return this.props.children
    }
}

function DocsComponentPreview({ title, spec }: PreviewProps) {
    return (
        <PreviewBoundary title={title}>
            <Suspense fallback={<div className="my-4 h-24 rounded-xl border border-hairline bg-fill-4" />}>
                <LazyPreview title={title} spec={spec} />
            </Suspense>
        </PreviewBoundary>
    )
}

/** Element → renderer, for the elements named in DOCS_TAGS (markdown/docsTags.ts). */
export const DOCS_TAG_COMPONENTS = {
    'aiui-preview': DocsComponentPreview,
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
    'aiui-endpoint': Endpoint,
    'aiui-expandable': Expandable,
    'aiui-panel': Panel,
    'aiui-visibility': Visibility,
    'aiui-slot': Slot,
    'aiui-badge': Badge,
    'aiui-tooltip': Tooltip,
    'aiui-icon': Icon,
    'aiui-tile': Tile,
    'aiui-prompt': Prompt,
    'aiui-tree': Tree,
    'aiui-tree-folder': TreeFolder,
    'aiui-tree-file': TreeFile,
    'aiui-colors': Colors,
    'aiui-color-row': ColorRow,
    'aiui-color': ColorItem,
    'aiui-embed': Embed,
    'aiui-video': Video,
    'aiui-update': Update,
    'aiui-block': CustomBlock,
}
