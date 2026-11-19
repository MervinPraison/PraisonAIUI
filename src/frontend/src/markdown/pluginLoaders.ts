/**
 * Loaders for the heavy markdown plugins (Shiki, KaTeX), shared by the lazy
 * Streamdown plugin proxies (streamdownPlugins.ts, inside the renderer chunk)
 * and `preloadMarkdownPlugins` (LazyMarkdown, on the first screen).
 *
 * This module sits in the entry closure, so it stays tiny: it has no runtime
 * dependency on `streamdown`, the URL policy or the plugins themselves, only
 * `import()` calls. Every loader resets its promise when the import fails, so
 * the next use retries (a deploy can delete an old hashed chunk under an open
 * tab).
 */
import type { PluginConfig } from 'streamdown'

type CodePlugin = NonNullable<PluginConfig['code']>
type MathPlugin = NonNullable<PluginConfig['math']>

/** [light, dark]: dual theme; Streamdown flips via `dark:` (our `.dark` custom variant). */
export const SHIKI_THEMES: ['github-light', 'github-dark'] = ['github-light', 'github-dark']

// ── Code (curated Shiki, JS regex engine, grammars lazily imported per language) ──
let realCode: CodePlugin | null = null
let codeLoading: Promise<CodePlugin> | null = null

export function loadCodePlugin(): Promise<CodePlugin> {
    codeLoading ??= import('./shikiPlugin')
        .then((m) => {
            realCode = m.createCuratedCodePlugin(SHIKI_THEMES)
            return realCode
        })
        .catch((e: unknown) => {
            codeLoading = null // retry on next use (chunk 404 after a deploy, offline, ...)
            throw e
        })
    return codeLoading
}

/** The real code plugin once loaded, else null. */
export function getCodePlugin(): CodePlugin | null {
    return realCode
}

// ── Math (KaTeX); must be present before parse ──
type MathVariant = 'chat' | 'docs'
const realMath: Record<MathVariant, MathPlugin | null> = { chat: null, docs: null }
let mathLoading: Promise<typeof import('@streamdown/math')> | null = null

/**
 * Chat loads KaTeX for `$$…$$` only: single dollars are prices there.
 * `\(…\)` and `\[…\]` (what LLMs emit by default) are rewritten to `$$` before
 * parsing (texDelimiters.ts), so they count too.
 */
export const MATH_RE = /\$\$/
/** Docs: authors control the content, so `$…$` inline math is on as well. */
export const DOCS_MATH_RE = /\$\$|(^|[^\\$\w])\$[^\s$](?:[^$\n]*[^\s$\\])?\$(?![\w$])/
/** `\(` or `\[` (same as texDelimiters.TEX_DELIM_RE; kept here so this module stays tiny). */
const TEX_DELIM_RE = /\\[[(]/

export function needsMath(md: string, variant: MathVariant = 'chat'): boolean {
    return (variant === 'docs' ? DOCS_MATH_RE : MATH_RE).test(md) || TEX_DELIM_RE.test(md)
}

export function ensureMathPlugin(variant: MathVariant = 'chat'): Promise<MathPlugin> {
    mathLoading ??= Promise.all([import('@streamdown/math'), import('katex/dist/katex.min.css')])
        .then(([m]) => m)
        .catch((e: unknown) => {
            mathLoading = null
            throw e
        })
    return mathLoading.then((m) => {
        realMath[variant] ??= m.createMathPlugin({ singleDollarTextMath: variant === 'docs' }) as unknown as MathPlugin
        return realMath[variant]!
    })
}

export function getMathPlugin(variant: MathVariant = 'chat'): MathPlugin | null {
    return realMath[variant]
}

// ── Raw HTML (rehype-raw: parse5 and its entity tables) ──
// Streamdown's own `rehype-raw` import resolves to rehypeRawGate.ts in the
// build (vite.config.ts lazyRehypeRaw), so the parser is a lazy chunk that
// only markdown with HTML in it loads.
type RawPlugin = typeof import('rehype-raw')['default']
let realRaw: RawPlugin | null = null
let rawLoading: Promise<RawPlugin> | null = null
// Listeners, not a top-level promise: a statement with a side effect here
// would pull this module into every chunk that names it (the boot path).
const rawListeners = new Set<() => void>()

export function loadRawPlugin(): Promise<RawPlugin> {
    rawLoading ??= import('rehype-raw')
        .then((m) => {
            realRaw = m.default
            for (const listener of rawListeners) listener()
            rawListeners.clear()
            return realRaw
        })
        .catch((e: unknown) => {
            rawLoading = null
            throw e
        })
    return rawLoading
}

/** The real rehype-raw once loaded, else null. */
export function getRawPlugin(): RawPlugin | null {
    return realRaw
}

/** Calls `listener` once anything (a hint, the gate) has loaded rehype-raw; never starts the load. Returns the unsubscribe. */
export function onRawPlugin(listener: () => void): () => void {
    rawListeners.add(listener)
    return () => { rawListeners.delete(listener) }
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const INLINE_CODE = /(`+)[^`\n]*?\1/g
/** A tag, closing tag, comment, declaration or processing instruction: what CommonMark parses as HTML. */
const HTML_START = /<[A-Za-z/!?]/

/**
 * Whether markdown may contain HTML, outside fenced code and one-line code
 * spans. A hint for loading ahead of the first paint: it may say yes for
 * text with no HTML, and when it misses one, the gate loads the parser as it
 * meets the HTML and the renderer draws it again (Markdown.tsx useRawPlugin).
 */
export function needsRaw(md: string): boolean {
    if (!md.includes('<')) return false
    let fence: string | null = null
    for (const line of md.split('\n')) {
        const m = FENCE_LINE.exec(line)
        if (fence) {
            if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null
            continue
        }
        // A backtick fence's info string has no backtick; anything else is not an opener.
        if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
            fence = m[1]
            continue
        }
        if (HTML_START.test(line.replace(INLINE_CODE, ''))) return true
    }
    return false
}

const FENCE_RE = /```|~~~/

/**
 * Kick off the loads a document will need. Docs await this before the first
 * paint (no raw-`$$`, unstyled-code or missing-HTML flash); grammars and
 * mermaid stay lazy. Never rejects: a failed plugin only means plain code,
 * raw TeX or no HTML.
 */
export async function preloadMarkdownPlugins(md: string): Promise<void> {
    const jobs: Promise<unknown>[] = []
    if (FENCE_RE.test(md)) jobs.push(loadCodePlugin())
    if (needsMath(md, 'docs')) jobs.push(ensureMathPlugin('docs'))
    if (needsRaw(md)) jobs.push(loadRawPlugin())
    await Promise.allSettled(jobs)
}
