/**
 * Lazy Streamdown plugins (imported by the renderer chunk, Markdown.tsx).
 *
 * Streamdown wants plugin objects synchronously, but Shiki, Mermaid and KaTeX
 * are heavy. Code and Mermaid get *proxy* plugins whose real implementation is
 * `import()`ed on first use (own chunks, never on the first screen). Math
 * needs remark/rehype plugins at parse time, so it is loaded on demand by
 * content sniffing (`ensureMathPlugin`, pluginLoaders.ts) and the caller
 * re-renders.
 *
 * Every loader resets its promise when the import fails, so the next use
 * retries (a deploy can delete the old hashed chunk under an open tab).
 */
import type { PluginConfig } from 'streamdown'
import { SHIKI_THEMES, getCodePlugin, loadCodePlugin } from './pluginLoaders'
import { gateMermaidSource, gateSvgResources } from './urlPolicy'

export { MATH_RE, SHIKI_THEMES, ensureMathPlugin, getMathPlugin, needsMath, preloadMarkdownPlugins } from './pluginLoaders'

type CodePlugin = NonNullable<PluginConfig['code']>
type DiagramPlugin = NonNullable<PluginConfig['mermaid']>
type HighlightOptions = Parameters<CodePlugin['highlight']>[0]
type HighlightResult = NonNullable<ReturnType<CodePlugin['highlight']>>

// ── Code: proxy until the curated Shiki plugin has loaded ──
export const lazyCodePlugin: CodePlugin = {
    name: 'shiki',
    type: 'code-highlighter',
    getThemes: () => SHIKI_THEMES,
    getSupportedLanguages: () => getCodePlugin()?.getSupportedLanguages() ?? [],
    // Unknown languages fall back to "text" inside the real plugin, so optimistic true is safe.
    supportsLanguage: (lang) => getCodePlugin()?.supportsLanguage(lang) ?? true,
    highlight(opts: HighlightOptions, cb?: (r: HighlightResult) => void) {
        const real = getCodePlugin()
        if (real) return real.highlight(opts, cb)
        loadCodePlugin().then(
            (p) => {
                const sync = p.highlight(opts, cb)
                if (sync) cb?.(sync)
            },
            () => { /* stays plain text */ },
        )
        return null
    },
}

// ── Mermaid (loaded on first diagram render) ──
type MermaidModule = typeof import('mermaid')['default']
let mermaidLoading: Promise<MermaidModule> | null = null

function loadMermaid(): Promise<MermaidModule> {
    mermaidLoading ??= import('mermaid')
        .then((m) => m.default)
        .catch((e: unknown) => {
            mermaidLoading = null
            throw e
        })
    return mermaidLoading
}

/**
 * Chat diagrams are untrusted (LLM output that may carry a prompt injection).
 * securityLevel 'strict' still lets DOMPurify keep `<img>` in HTML labels,
 * image shapes (`A@{ img: "https://…" }`) emit <image href>, and classDef or
 * themeCSS can carry `url(…)`. Mermaid lays the SVG out in the live document
 * while rendering, so any of these would fetch (exfiltrate) before we ever
 * see the result. Chat therefore:
 *  - rewrites off-origin `url(…)` and `img:` sources in the source text,
 *  - forbids fetching tags/attributes in labels (dompurifyConfig),
 *  - locks the config keys that could undo that or inject CSS from a
 *    `%%{init}%%` directive or front matter (`secure`),
 *  - strips anything left in the final SVG (gateSvgResources).
 */
const CHAT_DOMPURIFY = {
    FORBID_TAGS: ['style', 'img', 'image', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'link', 'use', 'feImage', 'svg', 'math'],
    FORBID_ATTR: ['style', 'src', 'srcset', 'background', 'poster', 'xlink:href'],
}
const CHAT_SECURE_KEYS = [
    'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', // mermaid's defaults
    'dompurifyConfig', 'themeCSS', 'themeVariables', 'theme', 'fontFamily', 'darkMode',
]

// mermaid.initialize() is global and render() is queued, so initialize+render
// must not interleave between a docs and a chat diagram (or two themes).
let renderChain: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = renderChain.then(fn, fn)
    renderChain = run.catch(() => undefined)
    return run
}

function createLazyMermaidPlugin(untrusted: boolean): DiagramPlugin {
    return {
        name: 'mermaid',
        type: 'diagram',
        language: 'mermaid',
        getMermaid(config) {
            return {
                initialize() { /* config is applied per render below */ },
                async render(id: string, source: string) {
                    const mermaid = await loadMermaid()
                    return exclusive(async () => {
                        mermaid.initialize({
                            startOnLoad: false,
                            suppressErrorRendering: true,
                            ...config,
                            ...(untrusted ? { dompurifyConfig: CHAT_DOMPURIFY, secure: CHAT_SECURE_KEYS } : {}),
                            // Always last.
                            securityLevel: 'strict',
                        } as Parameters<MermaidModule['initialize']>[0])
                        if (!untrusted) return mermaid.render(id, source)
                        const result = await mermaid.render(id, gateMermaidSource(source))
                        return { ...result, svg: gateSvgResources(result.svg) }
                    })
                },
            }
        },
    }
}

/** Docs diagrams are site-authored. */
export const lazyMermaidPlugin: DiagramPlugin = createLazyMermaidPlugin(false)
/** Chat diagrams are untrusted: they can never load an off-origin resource. */
export const chatMermaidPlugin: DiagramPlugin = createLazyMermaidPlugin(true)
