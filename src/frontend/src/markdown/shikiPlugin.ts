/**
 * Curated Shiki highlighter for Streamdown.
 *
 * Replaces @streamdown/code, which imports the full `shiki` bundle (about 330
 * grammar and 60 theme chunks plus a wasm engine, ~15 MB in the committed
 * bundle and wheel). Same plugin contract; JavaScript regex engine (no wasm);
 * 74 languages, each grammar its own lazily imported chunk, plus the docs
 * site's own grammars (`site.theme.codeLanguages`, fetched on first use).
 * Unknown languages render as plain text. Themes: github-light / github-dark,
 * or the docs site's `site.theme.code` (any bundled Shiki theme, each its own
 * chunk: scripts/lib/code-themes.mjs).
 *
 * Streaming: a fence that is still arriving is re-highlighted on every token.
 * Re-tokenizing the whole block each time is O(n²) over a long fence, so
 * incomplete blocks are tokenized incrementally: completed lines are tokenized
 * once and the grammar state at their end is kept; each update tokenizes only
 * the newly completed lines plus the trailing partial line. Results are
 * returned synchronously once the highlighter and grammar are loaded, so the
 * code block never lags behind the text. Completed blocks go into an LRU.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration, type ThemeRegistrationRaw } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { GrammarState, ThemedToken, TokensResult } from 'shiki/core'
import type { PluginConfig } from 'streamdown'
import { codeSettings, type CodeGrammar } from './codeConfig'

type CodePlugin = NonNullable<PluginConfig['code']>
type HighlightResult = NonNullable<ReturnType<CodePlugin['highlight']>>
type LangModule = { default: LanguageRegistration[] }
type Themes = [light: string, dark: string]
type ThemeModule = { default: ThemeRegistrationRaw }

const LANGS: Record<string, () => Promise<LangModule>> = {
    apache: () => import('shiki/langs/apache.mjs'),
    astro: () => import('shiki/langs/astro.mjs'),
    awk: () => import('shiki/langs/awk.mjs'),
    bash: () => import('shiki/langs/bash.mjs'),
    bat: () => import('shiki/langs/bat.mjs'),
    bicep: () => import('shiki/langs/bicep.mjs'),
    c: () => import('shiki/langs/c.mjs'),
    clojure: () => import('shiki/langs/clojure.mjs'),
    cmake: () => import('shiki/langs/cmake.mjs'),
    cpp: () => import('shiki/langs/cpp.mjs'),
    csharp: () => import('shiki/langs/csharp.mjs'),
    css: () => import('shiki/langs/css.mjs'),
    csv: () => import('shiki/langs/csv.mjs'),
    dart: () => import('shiki/langs/dart.mjs'),
    diff: () => import('shiki/langs/diff.mjs'),
    docker: () => import('shiki/langs/docker.mjs'),
    dotenv: () => import('shiki/langs/dotenv.mjs'),
    elixir: () => import('shiki/langs/elixir.mjs'),
    elm: () => import('shiki/langs/elm.mjs'),
    fish: () => import('shiki/langs/fish.mjs'),
    fsharp: () => import('shiki/langs/fsharp.mjs'),
    gleam: () => import('shiki/langs/gleam.mjs'),
    glsl: () => import('shiki/langs/glsl.mjs'),
    go: () => import('shiki/langs/go.mjs'),
    graphql: () => import('shiki/langs/graphql.mjs'),
    groovy: () => import('shiki/langs/groovy.mjs'),
    handlebars: () => import('shiki/langs/handlebars.mjs'),
    haskell: () => import('shiki/langs/haskell.mjs'),
    hcl: () => import('shiki/langs/hcl.mjs'),
    html: () => import('shiki/langs/html.mjs'),
    http: () => import('shiki/langs/http.mjs'),
    ini: () => import('shiki/langs/ini.mjs'),
    java: () => import('shiki/langs/java.mjs'),
    javascript: () => import('shiki/langs/javascript.mjs'),
    jinja: () => import('shiki/langs/jinja.mjs'),
    json: () => import('shiki/langs/json.mjs'),
    jsonl: () => import('shiki/langs/jsonl.mjs'),
    jsx: () => import('shiki/langs/jsx.mjs'),
    julia: () => import('shiki/langs/julia.mjs'),
    kotlin: () => import('shiki/langs/kotlin.mjs'),
    lua: () => import('shiki/langs/lua.mjs'),
    make: () => import('shiki/langs/make.mjs'),
    markdown: () => import('shiki/langs/markdown.mjs'),
    matlab: () => import('shiki/langs/matlab.mjs'),
    nginx: () => import('shiki/langs/nginx.mjs'),
    nix: () => import('shiki/langs/nix.mjs'),
    'objective-c': () => import('shiki/langs/objective-c.mjs'),
    perl: () => import('shiki/langs/perl.mjs'),
    php: () => import('shiki/langs/php.mjs'),
    powershell: () => import('shiki/langs/powershell.mjs'),
    prisma: () => import('shiki/langs/prisma.mjs'),
    proto: () => import('shiki/langs/proto.mjs'),
    python: () => import('shiki/langs/python.mjs'),
    r: () => import('shiki/langs/r.mjs'),
    regexp: () => import('shiki/langs/regexp.mjs'),
    ruby: () => import('shiki/langs/ruby.mjs'),
    rust: () => import('shiki/langs/rust.mjs'),
    sass: () => import('shiki/langs/sass.mjs'),
    scala: () => import('shiki/langs/scala.mjs'),
    scss: () => import('shiki/langs/scss.mjs'),
    solidity: () => import('shiki/langs/solidity.mjs'),
    sql: () => import('shiki/langs/sql.mjs'),
    svelte: () => import('shiki/langs/svelte.mjs'),
    swift: () => import('shiki/langs/swift.mjs'),
    terraform: () => import('shiki/langs/terraform.mjs'),
    toml: () => import('shiki/langs/toml.mjs'),
    tsx: () => import('shiki/langs/tsx.mjs'),
    typescript: () => import('shiki/langs/typescript.mjs'),
    vb: () => import('shiki/langs/vb.mjs'),
    vue: () => import('shiki/langs/vue.mjs'),
    wgsl: () => import('shiki/langs/wgsl.mjs'),
    xml: () => import('shiki/langs/xml.mjs'),
    yaml: () => import('shiki/langs/yaml.mjs'),
    zig: () => import('shiki/langs/zig.mjs'),
}
const ALIASES: Record<string, string> = {
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript',
    py: 'python', python3: 'python', rb: 'ruby', rs: 'rust', yml: 'yaml', md: 'markdown',
    dockerfile: 'docker', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', kt: 'kotlin',
    htm: 'html', svg: 'xml', jsonc: 'json', json5: 'json', cfg: 'ini', env: 'dotenv', gql: 'graphql',
    batch: 'bat', cmd: 'bat', clj: 'clojure', 'f#': 'fsharp', fs: 'fsharp', hbs: 'handlebars', hs: 'haskell',
    jl: 'julia', makefile: 'make', mk: 'make', objc: 'objective-c', ps: 'powershell', ps1: 'powershell',
    pwsh: 'powershell', protobuf: 'proto', regex: 'regexp', tf: 'terraform', tfvars: 'terraform', ex: 'elixir',
    exs: 'elixir', pl: 'perl', nginxconf: 'nginx', sol: 'solidity', glslang: 'glsl', 'jinja2': 'jinja', j2: 'jinja',
}

/** Curated language ids. */
export const CURATED_LANGUAGES = Object.keys(LANGS)

/** The docs site's grammar for a language id or alias (site.theme.codeLanguages). */
function siteGrammar(lang: string): CodeGrammar | undefined {
    return codeSettings().codeLanguages?.find((g) => g.name === lang || g.aliases?.includes(lang))
}

/** A fence's language as a grammar id; the site's own grammars win over the curated ones. */
export function resolveLanguage(lang: string): string {
    const l = (lang || '').trim().toLowerCase()
    return siteGrammar(l)?.name ?? ALIASES[l] ?? l
}

const known = (lang: string): boolean => lang in LANGS || !!siteGrammar(lang)

// ── themes ──
const DEFAULT_THEMES: Themes = ['github-light', 'github-dark']
const BUILT_IN_THEMES: Record<string, () => Promise<ThemeModule>> = {
    'github-light': () => import('shiki/themes/github-light.mjs'),
    'github-dark': () => import('shiki/themes/github-dark.mjs'),
}

/** The [light, dark] theme names to use: site.theme.code over `fallback`. */
export function chosenThemes(fallback: Themes, code = codeSettings().code): Themes {
    return [code?.light || fallback[0], code?.dark || fallback[1]]
}

/** A bundled theme by name; the default of its mode when the build has no such theme. */
async function loadTheme(name: string, mode: 0 | 1): Promise<ThemeRegistrationRaw> {
    try {
        if (Object.hasOwn(BUILT_IN_THEMES, name)) return (await BUILT_IN_THEMES[name]()).default
        const more = (await import('virtual:aiui-code-themes')).default
        if (Object.hasOwn(more, name)) return (await more[name]()).default
    } catch (e) {
        console.error(`[aiui markdown] code theme ${name} failed to load`, e)
    }
    return (await BUILT_IN_THEMES[DEFAULT_THEMES[mode]]()).default
}

// Lines longer than this are not tokenized (minified JSON, base64 ...): they
// would otherwise be re-tokenized on every streamed token.
const MAX_LINE_LENGTH = 1000
const TOKENIZE_TIME_LIMIT_MS = 200

let hl: Promise<HighlighterCore> | null = null
let ready: HighlighterCore | null = null
/** The theme names the highlighter was created with (null until then). */
let active: Themes | null = null
const getHighlighter = (wanted: Themes): Promise<HighlighterCore> => {
    hl ??= Promise.all([loadTheme(wanted[0], 0), loadTheme(wanted[1], 1)]).then(([light, dark]) => {
        active = [light.name ?? DEFAULT_THEMES[0], dark.name ?? DEFAULT_THEMES[1]]
        return createHighlighterCore({
            engine: createJavaScriptRegexEngine({ forgiving: true }),
            themes: [light, dark],
            langs: [],
        })
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
        const own = siteGrammar(lang)
        p = (own ? loadSiteGrammar(h, own) : LANGS[lang]().then((m) => h.loadLanguage(m.default)))
            .catch((e: unknown) => {
                langLoading.delete(lang)
                throw e
            })
        langLoading.set(lang, p)
    }
    return p
}

/** A site grammar (TextMate JSON published by the build), after the curated languages it embeds. */
async function loadSiteGrammar(h: HighlighterCore, g: CodeGrammar): Promise<void> {
    const res = await fetch(g.url)
    if (!res.ok) throw new Error(`${g.url}: HTTP ${res.status}`)
    const grammar = (await res.json()) as LanguageRegistration
    for (const dep of grammar.embeddedLangs ?? []) {
        const id = resolveLanguage(dep)
        if (id in LANGS) await loadLanguage(h, id)
    }
    await h.loadLanguage({ ...grammar, name: g.name, aliases: g.aliases ?? [] })
}

/** Resolved grammar id if it can be used synchronously right now, else null. */
function readyLanguage(h: HighlighterCore, lang: string): string | null {
    if (!known(lang)) return 'text'
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

/** `themes`: [light, dark] unless the docs site set site.theme.code. */
export function createCuratedCodePlugin(themes: Themes): CodePlugin {
    const wanted = chosenThemes(themes)
    return {
        name: 'shiki',
        type: 'code-highlighter',
        getThemes: () => (active ?? wanted) as never,
        getSupportedLanguages: () => [...CURATED_LANGUAGES, ...(codeSettings().codeLanguages ?? []).map((g) => g.name)] as never,
        supportsLanguage: (lang) => known(resolveLanguage(lang)),
        highlight({ code, language, isIncomplete = false }, cb) {
            const lang = resolveLanguage(language)
            if (!isIncomplete) {
                const hit = cacheGet(`${known(lang) ? lang : 'text'}\n${code}`)
                if (hit) return hit
            }
            // Fast path: everything loaded, answer synchronously.
            if (ready && active) {
                const use = readyLanguage(ready, lang)
                if (use) {
                    try {
                        return highlightNow(ready, code, use, active, isIncomplete)
                    } catch (e) {
                        console.error('[aiui markdown] highlight failed', e)
                        return null
                    }
                }
            }
            void (async () => {
                const h = await getHighlighter(wanted)
                if (known(lang)) await loadLanguage(h, lang)
                const use = readyLanguage(h, lang) ?? 'text'
                cb?.(highlightNow(h, code, use, active ?? wanted, isIncomplete))
            })().catch((e: unknown) => console.error('[aiui markdown] highlight failed', e))
            return null
        },
    }
}
