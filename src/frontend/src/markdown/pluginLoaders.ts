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

const FENCE_RE = /```|~~~/

/**
 * Kick off the loads a document will need. Docs await this before the first
 * paint (no raw-`$$` or unstyled-code flash); grammars and mermaid stay lazy.
 * Never rejects: a failed plugin only means plain code or raw TeX.
 */
export async function preloadMarkdownPlugins(md: string): Promise<void> {
    const jobs: Promise<unknown>[] = []
    if (FENCE_RE.test(md)) jobs.push(loadCodePlugin())
    if (needsMath(md, 'docs')) jobs.push(ensureMathPlugin('docs'))
    await Promise.allSettled(jobs)
}
