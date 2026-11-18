// Docs media (markdown/docsTags.ts, docs.css .aiui-embed / .aiui-video):
// <iframe> video embeds behind a click-to-play poster, <video>, and images
// that follow the site's light/dark toggle or opt out of zoom.
import { useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import { cardHref } from './cardHref'
import { embedTarget } from './embeds'

type Size = { width?: string; height?: string }

/** `width` / `height` as written → the box's aspect ratio and widest size (16:9 by default). */
function box({ width, height }: Size): CSSProperties {
    const [w, h] = [Number.parseFloat(width ?? ''), Number.parseFloat(height ?? '')]
    return { aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : undefined, maxWidth: w > 0 && /^\d+(px)?$/.test(width!) ? `${w}px` : undefined }
}

type EmbedProps = Size & { src?: string; title?: string; poster?: string }

/**
 * A YouTube, Vimeo or Loom player. Nothing loads from the provider until the
 * reader presses play (no cookies, no third-party requests on page load); any
 * other iframe is shown as a link.
 */
export function Embed({ src, title, poster, ...size }: EmbedProps) {
    const [playing, setPlaying] = useState(false)
    const target = embedTarget(src)
    if (!target) {
        const href = src ? cardHref(src) : undefined
        return href ? <p><a href={href} target="_blank" rel="noopener noreferrer">{title || href}</a></p> : null
    }
    const name = title || `${target.provider} video`
    const image = poster ? cardHref(poster) : undefined
    return (
        <div className="aiui-embed" style={box(size)}>
            {playing ? (
                <iframe
                    src={target.play}
                    title={name}
                    // A cross-origin player (never this site): it keeps its own origin to play, and cannot reach the page or navigate it.
                    sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                />
            ) : (
                <button type="button" className="aiui-embed-poster" onClick={() => setPlaying(true)} aria-label={`Play: ${name}`}>
                    {image && <img src={image} alt="" loading="lazy" />}
                    <span className="aiui-embed-play"><Play aria-hidden /></span>
                    <span className="aiui-embed-label">{name}<small>{target.provider} · loads when you press play</small></span>
                </button>
            )}
        </div>
    )
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** A self-hosted video. `autoPlay` plays muted and inline (never for readers who ask for reduced motion, who get controls instead). */
export function Video({ src, poster, title, flags, children, ...size }: EmbedProps & { flags?: string; children?: ReactNode }) {
    const f = new Set((flags ?? '').split(' '))
    const auto = f.has('autoplay') && !(typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION).matches)
    return (
        <video
            className="aiui-video"
            src={src ? cardHref(src) : undefined}
            poster={poster ? cardHref(poster) : undefined}
            title={title}
            aria-label={title}
            style={box(size)}
            controls={f.has('controls') || !auto}
            autoPlay={auto}
            muted={auto || f.has('muted')}
            loop={f.has('loop')}
            playsInline
            preload={auto ? 'auto' : 'metadata'}
        >
            {children}
        </video>
    )
}

/** `![](a.png#gh-dark-mode-only)` (GitHub's form) and `className="hidden dark:block"` (utility-class form). */
const THEME_SUFFIX = /#gh-(dark|light)-mode-only$/

type ImageProps = ComponentProps<'img'> & { node?: unknown; nozoom?: unknown }

/** A docs image: shown only in its colour mode when it names one; `noZoom` keeps it out of click-to-zoom. */
export function DocsImage({ node: _node, nozoom, className, alt, ...rest }: ImageProps) {
    void _node
    const cls = ` ${className ?? ''} `
    const theme = THEME_SUFFIX.exec(typeof rest.src === 'string' ? rest.src : '')?.[1]
        ?? (cls.includes(' dark:hidden ') ? 'light' : cls.includes(' dark:block ') ? 'dark' : undefined)
    const noZoom = nozoom === undefined || nozoom === false ? undefined : ''
    // The same look as the shared Markdown image (markdown/chatComponents.tsx MarkdownImage), which this
    // module does not import: it would pull the markdown chunk into the docs boot path.
    return (
        <img
            {...rest}
            alt={alt ?? ''}
            loading="lazy"
            decoding="async"
            className="inline-block h-auto max-w-full rounded-lg align-middle"
            data-theme-only={theme}
            data-nozoom={noZoom}
        />
    )
}

/** Whether the site is in dark mode (the `dark` class on <html>), live when `watch` is set. */
const isDark = () => document.documentElement.classList.contains('dark')
function onThemeFlip(fn: () => void) {
    const o = new MutationObserver(fn)
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
}
const never = () => () => {}
const useDark = (watch: boolean) => useSyncExternalStore(watch ? onThemeFlip : never, () => watch && isDark(), () => false)

const SCHEME_ONLY = /^\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*$/i

/** <picture><source media="(prefers-color-scheme: dark)">: follows the site's theme toggle, not only the system setting. */
export function DocsSource({ node: _node, media, ...rest }: ComponentProps<'source'> & { node?: unknown }) {
    void _node
    const scheme = typeof media === 'string' ? SCHEME_ONLY.exec(media)?.[1].toLowerCase() : undefined
    const dark = useDark(!!scheme)
    return <source {...rest} media={scheme ? (dark === (scheme === 'dark') ? 'all' : 'not all') : media} />
}
