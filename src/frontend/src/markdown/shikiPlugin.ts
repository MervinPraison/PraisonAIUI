/**
 * Curated Shiki highlighter for Streamdown.
 *
 * Replaces @streamdown/code, which imports the full `shiki` bundle (about 330
 * grammar and 60 theme chunks plus a wasm engine, ~15 MB in the committed
 * bundle and wheel). Same plugin contract; JavaScript regex engine (no wasm);
 * 28 languages, each grammar its own lazily imported chunk. Unknown languages
 * render as plain text.
 *
 * Streaming: a fence that is still arriving is re-highlighted on every token.
 * Re-tokenizing the whole block each time is O(n²) over a long fence, so
 * incomplete blocks are tokenized incrementally: completed lines are tokenized
 * once and the grammar state at their end is kept; each update tokenizes only
 * the newly completed lines plus the trailing partial line. Results are
 * returned synchronously once the highlighter and grammar are loaded, so the
 * code block never lags behind the text. Completed blocks go into an LRU.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { GrammarState, ThemedToken, TokensResult } from 'shiki/core'
import type { PluginConfig } from 'streamdown'

type CodePlugin = NonNullable<PluginConfig['code']>
type HighlightResult = NonNullable<ReturnType<CodePlugin['highlight']>>
type LangModule = { default: LanguageRegistration[] }
type Themes = ['github-light', 'github-dark']

const LANGS: Record<string, () => Promise<LangModule>> = {
    bash: () => import('shiki/langs/bash.mjs'),
    c: () => import('shiki/langs/c.mjs'),
    cpp: () => import('shiki/langs/cpp.mjs'),
    csharp: () => import('shiki/langs/csharp.mjs'),
    css: () => import('shiki/langs/css.mjs'),
    diff: () => import('shiki/langs/diff.mjs'),
    docker: () => import('shiki/langs/docker.mjs'),
    go: () => import('shiki/langs/go.mjs'),
    graphql: () => import('shiki/langs/graphql.mjs'),
    html: () => import('shiki/langs/html.mjs'),
    ini: () => import('shiki/langs/ini.mjs'),
    java: () => import('shiki/langs/java.mjs'),
    javascript: () => import('shiki/langs/javascript.mjs'),
    json: () => import('shiki/langs/json.mjs'),
    jsx: () => import('shiki/langs/jsx.mjs'),
    kotlin: () => import('shiki/langs/kotlin.mjs'),
    markdown: () => import('shiki/langs/markdown.mjs'),
    php: () => import('shiki/langs/php.mjs'),
    python: () => import('shiki/langs/python.mjs'),
    ruby: () => import('shiki/langs/ruby.mjs'),
    rust: () => import('shiki/langs/rust.mjs'),
    sql: () => import('shiki/langs/sql.mjs'),
    swift: () => import('shiki/langs/swift.mjs'),
    toml: () => import('shiki/langs/toml.mjs'),
    tsx: () => import('shiki/langs/tsx.mjs'),
    typescript: () => import('shiki/langs/typescript.mjs'),
    xml: () => import('shiki/langs/xml.mjs'),
    yaml: () => import('shiki/langs/yaml.mjs'),
}
const ALIASES: Record<string, string> = {
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript',
    py: 'python', python3: 'python', rb: 'ruby', rs: 'rust', yml: 'yaml', md: 'markdown',
    dockerfile: 'docker', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', kt: 'kotlin',
    htm: 'html', svg: 'xml', jsonc: 'json', json5: 'json', cfg: 'ini', env: 'ini', gql: 'graphql',
}

/** Curated language ids (the owner-approved list of 28). */
export const CURATED_LANGUAGES = Object.keys(LANGS)

export function resolveLanguage(lang: string): string {
    const l = (lang || '').trim().toLowerCase()
    return ALIASES[l] ?? l
}

// Lines longer than this are not tokenized (minified JSON, base64 ...): they
// would otherwise be re-tokenized on every streamed token.
const MAX_LINE_LENGTH = 1000
const TOKENIZE_TIME_LIMIT_MS = 200

let hl: Promise<HighlighterCore> | null = null
let ready: HighlighterCore | null = null
const getHighlighter = (): Promise<HighlighterCore> => {
    hl ??= createHighlighterCore({
        engine: createJavaScriptRegexEngine({ forgiving: true }),
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
    }).then(
        (h) => (ready = h),
        (e: unknown) => {
            hl = null
            throw e
        },
    )
    return hl
}

const langLoading = new Map<string, Promise<void>>()
function loadLanguage(h: HighlighterCore, lang: string): Promise<void> {
    let p = langLoading.get(lang)
    if (!p) {
        p = LANGS[lang]()
            .then((m) => h.loadLanguage(m.default))
            .catch((e: unknown) => {
                langLoading.delete(lang)
                throw e
            })
        langLoading.set(lang, p)
    }
    return p
}

/** Resolved grammar id if it can be used synchronously right now, else null. */
function readyLanguage(h: HighlighterCore, lang: string): string | null {
    if (!LANGS[lang]) return 'text'
    return h.getLoadedLanguages().includes(lang) ? lang : null
}

// ── completed blocks: LRU ──
const MAX_CACHE = 500
const cache = new Map<string, HighlightResult>()
function cacheGet(key: string): HighlightResult | undefined {
    const hit = cache.get(key)
    if (hit) {
        cache.delete(key) // refresh recency
        cache.set(key, hit)
    }
    return hit
}
function cacheSet(key: string, value: HighlightResult): void {
    cache.set(key, value)
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
}

// ── streaming blocks: incremental tokenization ──
interface StreamState {
    lang: string
    /** The completed-lines prefix that `lines` covers (always ends with '\n', or ''). */
    done: string
    lines: ThemedToken[][]
    grammar?: GrammarState
    meta: Pick<TokensResult, 'fg' | 'bg' | 'rootStyle'>
}
const MAX_STREAMS = 16
let streams: StreamState[] = []

/** Instrumentation for tests: characters handed to the tokenizer. */
export const shikiStats = { tokenizedChars: 0 }

export function resetShikiCaches(): void {
    cache.clear()
    streams = []
    shikiStats.tokenizedChars = 0
}

function tokenize(h: HighlighterCore, code: string, lang: string, themes: Themes, grammar?: GrammarState): TokensResult {
    shikiStats.tokenizedChars += code.length
    return h.codeToTokens(code, {
        lang,
        themes: { light: themes[0], dark: themes[1] },
        tokenizeMaxLineLength: MAX_LINE_LENGTH,
        tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS,
        ...(grammar ? { grammarState: grammar } : {}),
    })
}

function toResult(tokens: ThemedToken[][], meta: StreamState['meta']): HighlightResult {
    return { tokens, fg: meta.fg, bg: meta.bg, rootStyle: meta.rootStyle } as unknown as HighlightResult
}

function findStream(lang: string, code: string): StreamState | undefined {
    let best: StreamState | undefined
    for (const s of streams) {
        if (s.lang === lang && code.startsWith(s.done) && (!best || s.done.length > best.done.length)) best = s
    }
    return best
}

function touchStream(s: StreamState): void {
    streams = streams.filter((x) => x !== s)
    streams.push(s)
    if (streams.length > MAX_STREAMS) streams.shift()
}

/**
 * Tokenize `code` reusing the longest matching streamed prefix. Only the newly
 * completed lines and the trailing partial line are tokenized.
 */
function highlightIncremental(h: HighlighterCore, code: string, lang: string, themes: Themes, keepStream: boolean): HighlightResult {
    let s = findStream(lang, code)
    if (!s) {
        s = { lang, done: '', lines: [], meta: {} }
        // Seed fg/bg/rootStyle (cheap: empty input).
        const empty = tokenize(h, '', lang, themes)
        s.meta = { fg: empty.fg, bg: empty.bg, rootStyle: empty.rootStyle }
    }
    const cut = code.lastIndexOf('\n') + 1
    if (cut > s.done.length) {
        // New completed lines: tokenize them (without the final '\n') from the saved state.
        const fresh = code.slice(s.done.length, cut - 1)
        const res = tokenize(h, fresh, lang, themes, s.grammar)
        s.lines = s.lines.concat(res.tokens)
        s.grammar = res.grammarState
        s.done = code.slice(0, cut)
    }
    const tail = code.slice(cut)
    const tailTokens = tail ? tokenize(h, tail, lang, themes, s.grammar).tokens : [[]]
    if (keepStream) touchStream(s)
    else streams = streams.filter((x) => x !== s)
    return toResult(s.lines.concat(tailTokens), s.meta)
}

function highlightNow(h: HighlighterCore, code: string, lang: string, themes: Themes, isIncomplete: boolean): HighlightResult {
    if (isIncomplete) return highlightIncremental(h, code, lang, themes, true)
    const key = `${lang}\n${code}`
    const hit = cacheGet(key)
    if (hit) return hit
    // A block that just finished streaming reuses its prefix state.
    const result = findStream(lang, code)
        ? highlightIncremental(h, code, lang, themes, false)
        : (tokenize(h, code, lang, themes) as unknown as HighlightResult)
    cacheSet(key, result)
    return result
}

export function createCuratedCodePlugin(themes: Themes): CodePlugin {
    return {
        name: 'shiki',
        type: 'code-highlighter',
        getThemes: () => themes,
        getSupportedLanguages: () => CURATED_LANGUAGES,
        supportsLanguage: (lang) => resolveLanguage(lang) in LANGS,
        highlight({ code, language, isIncomplete = false }, cb) {
            const lang = resolveLanguage(language)
            if (!isIncomplete) {
                const hit = cacheGet(`${LANGS[lang] ? lang : 'text'}\n${code}`)
                if (hit) return hit
            }
            // Fast path: everything loaded, answer synchronously.
            if (ready) {
                const use = readyLanguage(ready, lang)
                if (use) {
                    try {
                        return highlightNow(ready, code, use, themes, isIncomplete)
                    } catch (e) {
                        console.error('[aiui markdown] highlight failed', e)
                        return null
                    }
                }
            }
            void (async () => {
                const h = await getHighlighter()
                if (LANGS[lang]) await loadLanguage(h, lang)
                const use = readyLanguage(h, lang) ?? 'text'
                cb?.(highlightNow(h, code, use, themes, isIncomplete))
            })().catch((e: unknown) => console.error('[aiui markdown] highlight failed', e))
            return null
        },
    }
}
