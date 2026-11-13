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
let realMath: MathPlugin | null = null
let mathLoading: Promise<MathPlugin> | null = null

/**
 * `$$…$$` (inline or display). remark-math has no `\(…\)` / `\[…\]`
 * delimiters (markdown reads them as escaped brackets), and single-dollar math
 * is off (prices in chat), so only `$$` loads KaTeX.
 */
export const MATH_RE = /\$\$/

export function ensureMathPlugin(): Promise<MathPlugin> {
    mathLoading ??= Promise.all([import('@streamdown/math'), import('katex/dist/katex.min.css')])
        .then(([m]) => {
            realMath = m.createMathPlugin({ singleDollarTextMath: false }) as unknown as MathPlugin
            return realMath
        })
        .catch((e: unknown) => {
            mathLoading = null
            throw e
        })
    return mathLoading
}

export function getMathPlugin(): MathPlugin | null {
    return realMath
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
    if (MATH_RE.test(md)) jobs.push(ensureMathPlugin())
    await Promise.allSettled(jobs)
}
