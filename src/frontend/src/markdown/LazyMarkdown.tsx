/**
 * The markdown entry point for app code (ADR-0001 §5). Streamdown (with
 * parse5, marked and remend) is a lazy chunk; until it arrives the text shows
 * as plain pre-wrapped prose, so no first screen waits on it.
 *
 *   export function Markdown(p: { children: string; variant?: 'chat'|'docs'; streaming?: boolean;
 *     className?: string; components?: Record<string, ComponentType<any>> })
 *   export const preloadMarkdown
 *
 * Import this module, never ./Markdown directly.
 */
import { Component, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { retryableLazy, retryFailedLazies } from '@/lib/retryableLazy'
import { preloadMarkdownPlugins } from './pluginLoaders'

export interface MarkdownProps {
    children: string
    variant?: 'chat' | 'docs'
    /** chat: true while tokens are arriving. */
    streaming?: boolean
    className?: string
    /** Element overrides. Keep the object stable (module scope or useMemo). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components?: Record<string, ComponentType<any>>
}

let implLoading: Promise<{ default: ComponentType<MarkdownProps> }> | null = null
/** Set once the chunk has loaded: later renders skip Suspense (no plain-text flash). */
let Loaded: ComponentType<MarkdownProps> | null = null

function loadImpl() {
    implLoading ??= import('./Markdown')
        .then((m) => {
            Loaded = m.Markdown as ComponentType<MarkdownProps>
            return { default: Loaded }
        })
        .catch((e: unknown) => {
            implLoading = null // the next attempt imports again
            throw e
        })
    return implLoading
}

/**
 * A failed import (chunk 404 after a deploy, offline) keeps failing, so the
 * boundary below shows plain text instead of React re-rendering into a new
 * import on every rejection. retryFailedLazies() lets it import again: the
 * shell's page boundary calls it on Try again and on the next page, and every
 * newly mounted Markdown calls it too.
 */
const Impl = retryableLazy<MarkdownProps>(loadImpl)

function PlainText({ children, className }: Pick<MarkdownProps, 'children' | 'className'>) {
    return (
        <div className={cn('aiui-markdown min-w-0 whitespace-pre-wrap break-words text-base leading-[1.55] text-foreground', className)}>
            {children}
        </div>
    )
}

/** If the renderer chunk cannot load, keep the text readable instead of crashing the page. */
class RendererBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    constructor(props: { fallback: ReactNode; children: ReactNode }) {
        super(props)
        // A new Markdown (a new message, another page): a renderer chunk that
        // failed earlier gets one more import. A failed boundary stays on plain
        // text for its lifetime, so this never loops.
        retryFailedLazies()
    }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.error('[aiui markdown] renderer failed to load', error, info.componentStack)
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}

export function Markdown(props: MarkdownProps) {
    const fallback = <PlainText className={props.className}>{props.children}</PlainText>
    const Ready = Loaded
    return (
        <RendererBoundary fallback={fallback}>
            {Ready ? (
                <Ready {...props} />
            ) : (
                <Suspense fallback={fallback}>
                    <Impl {...props} />
                </Suspense>
            )}
        </RendererBoundary>
    )
}

/** Start fetching the renderer chunk before it is needed. Never rejects. */
// eslint-disable-next-line react-refresh/only-export-components -- contract export (ADR §5)
export const preloadMarkdown = (): Promise<void> => loadImpl().then(() => undefined, () => undefined)

/** Also preload Shiki / KaTeX when the document needs them (docs await this before paint). */
// eslint-disable-next-line react-refresh/only-export-components -- contract export
export { preloadMarkdownPlugins }
