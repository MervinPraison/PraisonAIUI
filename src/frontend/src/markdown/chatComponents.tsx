/**
 * Element overrides shared by both variants (links, lists) and the chat-only
 * image gate placeholder. Built by composing Streamdown's default components,
 * so its data-streamdown hooks and base styles stay intact.
 */
import { useState, type JSX } from 'react'
import { ImageIcon } from 'lucide-react'
import { defaultComponents, type ExtraProps } from 'streamdown'
import { cn } from '@/lib/utils'
import { EXTERNAL_LINK_REL, imageHost, isExternalHref, isStreamdownPlaceholder } from './urlPolicy'
import { legacySafeCodeClass } from './legacyPlugins'

type Props<K extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[K] & ExtraProps

const DefaultA = defaultComponents.a
const DefaultUl = defaultComponents.ul
const DefaultOl = defaultComponents.ol
const DefaultCode = defaultComponents.code

const LINK_CLASS = 'text-link underline-offset-2 decoration-current/40 hover:decoration-current'

/**
 * A real <a>. External targets open in a new tab with
 * rel="noopener noreferrer nofollow"; same-origin and #fragment links stay in
 * the tab. `rewrite` maps internal hrefs (docs SPA routes).
 */
export function PolicyLink({ href, children, className, rewrite, ...rest }: Props<'a'> & { rewrite?: (href: string) => string }) {
    if (!href || isStreamdownPlaceholder(href)) {
        // Streamdown marks a link whose URL is still streaming; nothing to follow yet.
        return (
            <span className={cn('font-medium text-primary underline', LINK_CLASS, className)} data-streamdown="link" data-incomplete="true">
                {children}
            </span>
        )
    }
    const external = isExternalHref(href)
    const target = external ? href : rewrite ? rewrite(href) : href
    return (
        <DefaultA
            {...rest}
            className={cn(LINK_CLASS, className)}
            href={target}
            target={external ? '_blank' : undefined}
            rel={external ? EXTERNAL_LINK_REL : undefined}
        >
            {children}
        </DefaultA>
    )
}

/**
 * Streamdown's own code renderer; a fenced block's language class is handed
 * over in a form the legacy highlight.js plugin skips (see legacyPlugins.ts).
 */
export function LegacySafeCode(props: Props<'code'>) {
    if (!('data-block' in props)) return <DefaultCode {...props} />
    return <DefaultCode {...props} className={legacySafeCodeClass(props.className)} />
}

/** Lists hang their markers outside the text block (Streamdown defaults to list-inside). */
export function ListUl({ className, ...rest }: Props<'ul'>) {
    return <DefaultUl {...rest} className={cn('list-outside pl-6', className)} />
}
export function ListOl({ className, ...rest }: Props<'ol'>) {
    return <DefaultOl {...rest} className={cn('list-outside pl-6', className)} />
}

/**
 * Images allowed through (chat: same origin, data:image/, blob:; docs: any).
 * Streamdown's own image renders a <div> wrapper, which is invalid inside the
 * <p> an inline image lives in; this stays phrasing content. An image whose
 * URL is still streaming (`streamdown:incomplete-image`) shows a skeleton and
 * never fetches.
 */
export function MarkdownImage({ src, alt, className, node: _node, ...rest }: Props<'img'>) {
    void _node
    if (typeof src !== 'string' || !src.trim() || isStreamdownPlaceholder(src)) {
        return (
            <span
                role="img"
                aria-label={alt || 'Image loading'}
                data-streamdown="image-placeholder"
                className="inline-block h-24 w-48 max-w-full animate-pulse rounded-lg bg-muted align-middle"
            />
        )
    }
    return (
        <img
            {...rest}
            src={src}
            alt={alt ?? ''}
            loading="lazy"
            decoding="async"
            data-streamdown="image"
            className={cn('inline-block h-auto max-w-full rounded-lg align-middle', className)}
        />
    )
}

/**
 * Placeholder for an image the gate blocked (off-origin in chat). Shows the
 * host; the image loads only when the user asks for it.
 */
export function ImageGate(props: Record<string, unknown>) {
    const src = typeof props['data-aiui-src'] === 'string' ? props['data-aiui-src'] : ''
    const alt = typeof props['data-aiui-alt'] === 'string' ? props['data-aiui-alt'] : ''
    const host = imageHost(src)
    const [load, setLoad] = useState(false)

    if (load && host) {
        return <img src={src} alt={alt} className="max-w-full rounded-lg" loading="lazy" referrerPolicy="no-referrer" data-aiui-image-loaded="" />
    }
    const base = 'inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 align-middle text-sm text-muted-foreground'
    if (!host) {
        return (
            <span className={base} data-aiui-image-gate="blocked" role="img" aria-label={alt ? `Image blocked: ${alt}` : 'Image blocked'}>
                <ImageIcon aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{alt ? `Image blocked: ${alt}` : 'Image blocked'}</span>
            </span>
        )
    }
    return (
        <button
            type="button"
            onClick={() => setLoad(true)}
            title={src}
            data-aiui-image-gate="click-to-load"
            className={cn(
                base,
                'cursor-pointer hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
        >
            <ImageIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">
                {alt ? `${alt}: ` : ''}load image from <span className="font-medium text-foreground">{host}</span>
            </span>
        </button>
    )
}

const chatHeading = (level: 1 | 2 | 3 | 4, cls: string) => {
    const Default = defaultComponents[`h${level}`]
    return function ChatHeading({ className, ...rest }: Props<'h1'>) {
        return <Default {...rest} className={cn(cls, className)} />
    }
}

// Chat messages are body text: headings stay close to the 15px body size.
export const ChatH1 = chatHeading(1, 'mt-5 mb-2 text-xl font-semibold tracking-tight')
export const ChatH2 = chatHeading(2, 'mt-5 mb-2 text-lg font-semibold tracking-tight')
export const ChatH3 = chatHeading(3, 'mt-4 mb-1.5 text-base font-semibold')
export const ChatH4 = chatHeading(4, 'mt-4 mb-1.5 text-base font-semibold')
