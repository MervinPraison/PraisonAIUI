/**
 * The ONE markdown renderer (chat + docs): Streamdown with lazy Shiki,
 * Mermaid and KaTeX. App code imports `@/markdown/LazyMarkdown`, never this
 * module, so Streamdown stays out of the entry.
 *
 *   <Markdown variant="chat" streaming={isStreaming}>{text}</Markdown>
 *   <Markdown variant="docs">{preprocessMkdocsMarkdown(md)}</Markdown>
 *
 * Security: both variants pass an explicit rehype list
 * `[raw, [sanitize, schema], ..., harden]`. rehype-sanitize must stay in it
 * (it is the real XSS barrier; Streamdown's harden is permissive). Never use
 * Streamdown's `allowedTags`: it rewrites blank lines inside the tag to
 * `<!---->` and corrupts fenced code. Extend the sanitize schema instead.
 */
import { memo, useId, useMemo, useState, useEffect, type ComponentType } from 'react'
import { Streamdown, defaultRehypePlugins, type ControlsConfig, type PluginConfig, type StreamdownProps } from 'streamdown'
import { cn } from '@/lib/utils'
import { SHIKI_THEMES, chatMermaidPlugin, ensureMathPlugin, getMathPlugin, lazyCodePlugin, lazyMermaidPlugin, needsMath } from './streamdownPlugins'
import { normalizeTexDelimiters } from './texDelimiters'
import { ChatH1, ChatH2, ChatH3, ChatH4, ImageGate, LegacySafeCode, ListOl, ListUl, MarkdownImage, PolicyLink } from './chatComponents'
import { DocsH1, DocsH2, DocsH3, DocsH4, DocsLink, DocsUl } from './docsComponents'
import { Admonition, MkdocsTab, MkdocsTabs } from './MkdocsBlocks'
import { IMAGE_GATE_TAG, rehypeImageGate } from './urlPolicy'
import { mermaidConfigFor, useThemeKey } from './themeStore'
import { useStreamingText } from './streamThrottle'
import { continueSplitLists } from './listNumbering'
import { useLegacyCopyGuard } from './legacyPlugins'
import './markdown.css'

type Components = NonNullable<StreamdownProps['components']>

const CHAT_COMPONENTS = {
    a: PolicyLink,
    code: LegacySafeCode,
    img: MarkdownImage,
    ul: ListUl,
    ol: ListOl,
    h1: ChatH1,
    h2: ChatH2,
    h3: ChatH3,
    h4: ChatH4,
    [IMAGE_GATE_TAG]: ImageGate,
} as unknown as Components

const DOCS_COMPONENTS = {
    a: DocsLink,
    code: LegacySafeCode,
    img: MarkdownImage,
    ul: DocsUl,
    ol: ListOl,
    h1: DocsH1,
    h2: DocsH2,
    h3: DocsH3,
    h4: DocsH4,
    'aiui-admonition': Admonition,
    'aiui-tabs': MkdocsTabs,
    'aiui-tab': MkdocsTab,
} as unknown as Components
type Pluggable = NonNullable<StreamdownProps['rehypePlugins']>[number]
type Schema = {
    tagNames?: string[]
    attributes?: Record<string, unknown[]>
    protocols?: Record<string, string[]>
    [k: string]: unknown
}

// ── rehype pipelines ──
const [sanitizePlugin, baseSchema] = defaultRehypePlugins.sanitize as unknown as [Pluggable, Schema]

/** Docs: Streamdown's schema plus the <aiui-*> blocks emitted by convertMkdocsBlocks. */
const docsSchema: Schema = {
    ...baseSchema,
    tagNames: [...(baseSchema.tagNames ?? []), 'aiui-admonition', 'aiui-tabs', 'aiui-tab'],
    attributes: {
        ...(baseSchema.attributes ?? {}),
        'aiui-admonition': ['type', 'title', 'collapsible'],
        'aiui-tab': ['title'],
    },
}

/** Chat: Streamdown's schema; `data:` and `blob:` image sources survive so the image gate can allow them. */
const chatSchema: Schema = {
    ...baseSchema,
    protocols: {
        ...(baseSchema.protocols ?? {}),
        src: [...(baseSchema.protocols?.src ?? []), 'data', 'blob'],
    },
}

const DOCS_REHYPE = [
    defaultRehypePlugins.raw,
    [sanitizePlugin, docsSchema],
    defaultRehypePlugins.harden,
] as StreamdownProps['rehypePlugins']

const CHAT_REHYPE = [
    defaultRehypePlugins.raw,
    [sanitizePlugin, chatSchema],
    rehypeImageGate, // after sanitize: off-origin images become click-to-load placeholders
    defaultRehypePlugins.harden,
] as StreamdownProps['rehypePlugins']

// ── controls (owner decision 9) ──
const CHAT_CONTROLS: ControlsConfig = {
    code: { copy: true, download: true },
    table: { copy: true, download: false, fullscreen: false },
    mermaid: { panZoom: true, fullscreen: true, download: false, copy: false },
    image: false,
}
const DOCS_CONTROLS: ControlsConfig = {
    code: { copy: true, download: false },
    table: false,
    mermaid: { panZoom: true, fullscreen: false, download: false, copy: false },
    image: false,
}

const LINKS_AS_ANCHORS = { enabled: false } // real <a>; policy lives in the `a` component

// ── typography (tokens only; text-base is the 15px body token) ──
// not-prose: Streamdown owns this subtree's typography. The docs article keeps
// the `prose` class only as the legacy plugins' "React owns this" marker
// (Content.tsx), and @tailwindcss/typography skips everything under not-prose.
const ROOT_CLASS = 'aiui-markdown not-prose min-w-0 break-words text-base leading-[1.55] text-foreground'
// Block framing (flat, not boxed), table and diagram controls: markdown.css.

const VARIANT_CLASS = {
    chat: 'aiui-markdown-chat space-y-3',
    docs: 'aiui-markdown-docs space-y-4',
} as const

function useMathPlugin(content: string, variant: 'chat' | 'docs') {
    const needs = needsMath(content, variant)
    const [math, setMath] = useState(() => getMathPlugin(variant))
    useEffect(() => {
        if (!needs || math) return
        let live = true
        ensureMathPlugin(variant).then(
            (m) => { if (live) setMath(m) },
            () => { /* raw $$ stays visible */ },
        )
        return () => { live = false }
    }, [needs, math, variant])
    return needs ? math : null
}

const MERMAID_FENCE = /(^|\n)\s*(```|~~~)\s*mermaid\b/i

/** Short stable hash so the theme key can travel as a data attribute (Streamdown's memo compares data-*). */
function hashKey(s: string): string {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
}

export interface MarkdownProps {
    children: string
    variant?: 'chat' | 'docs'
    /** chat: true while tokens are arriving (incomplete-markdown repair, caret); false renders the text as written. */
    streaming?: boolean
    className?: string
    /** Element overrides. Keep the object stable (module scope or useMemo). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components?: Record<string, ComponentType<any>>
}

export const Markdown = memo(function Markdown({
    children, variant = 'chat', streaming = false, className, components,
}: MarkdownProps) {
    const isDocs = variant === 'docs'
    const source = typeof children === 'string' ? children : String(children ?? '')
    // While streaming, updates are paced by their measured cost (a long fence
    // must not saturate the main thread) and deferred (streamThrottle.ts).
    const paced = useStreamingText(source, !isDocs && streaming)
    // Chat: steps split by code fences keep counting (1., 2., 3.), see listNumbering.ts.
    // `\(…\)` / `\[…\]` (LLM default) → `$$` so KaTeX renders them (texDelimiters.ts).
    const text = useMemo(() => normalizeTexDelimiters(isDocs ? paced : continueSplitLists(paced)), [paced, isDocs])
    const guardId = useId()
    useLegacyCopyGuard(guardId)

    const math = useMathPlugin(text, variant)
    // Chat diagrams are untrusted: their SVG is stripped of off-origin resources.
    const plugins = useMemo<PluginConfig>(
        () => ({ code: lazyCodePlugin, mermaid: isDocs ? lazyMermaidPlugin : chatMermaidPlugin, ...(math ? { math } : {}) }),
        [math, isDocs],
    )

    // Mermaid colours come from the live tokens; only documents with a diagram
    // subscribe to theme flips.
    const hasMermaid = MERMAID_FENCE.test(text)
    const themeKey = useThemeKey(hasMermaid)
    const mermaid = useMemo(
        () => (hasMermaid ? { config: mermaidConfigFor(themeKey) } : undefined),
        [hasMermaid, themeKey],
    )

    const merged = useMemo<Components>(
        () => ({ ...(isDocs ? DOCS_COMPONENTS : CHAT_COMPONENTS), ...(components ?? {}) }) as Components,
        [isDocs, components],
    )

    return (
        <Streamdown
            className={cn(ROOT_CLASS, VARIANT_CLASS[variant], className)}
            data-aiui-theme={hasMermaid ? hashKey(themeKey) : undefined}
            data-aiui-markdown={guardId} /* root handle for useLegacyCopyGuard */
            mode={isDocs ? 'static' : 'streaming'}
            isAnimating={!isDocs && streaming}
            // Repair only while tokens arrive: a finished message is shown as
            // written. (remend corrupts some complete text, e.g. it appends
            // '***' after the closing fence of a reply with '****' in it.)
            parseIncompleteMarkdown={!isDocs && streaming}
            caret={!isDocs && streaming ? 'block' : undefined}
            plugins={plugins}
            shikiTheme={SHIKI_THEMES}
            mermaid={mermaid}
            rehypePlugins={isDocs ? DOCS_REHYPE : CHAT_REHYPE}
            components={merged}
            linkSafety={LINKS_AS_ANCHORS}
            lineNumbers={false}
            codeBlockMaxHeight={isDocs ? 0 : undefined}
            tableMaxHeight={isDocs ? 0 : undefined}
            controls={isDocs ? DOCS_CONTROLS : CHAT_CONTROLS}
        >
            {text}
        </Streamdown>
    )
})
