/**
 * Docs code block settings from ui-config.json (`site.theme.code`,
 * `site.theme.codeLanguages`, written by `aiui build`). The legacy App puts
 * them on `globalThis.__AIUI_CODE__` once the config has loaded, before any
 * page renders; the lazy Shiki plugin (shikiPlugin.ts) reads them when it
 * creates the highlighter. A global rather than a shared module, so neither
 * the chat's first screen nor the entry's preload list grows.
 */

/** A TextMate grammar the build published: fences named `name` or an alias use it. */
export interface CodeGrammar {
    name: string
    aliases?: string[]
    url: string
}

export interface CodeSettings {
    /** Shiki theme per colour mode (default github-light / github-dark). */
    code?: { light?: string; dark?: string }
    codeLanguages?: CodeGrammar[]
}

declare global {
    var __AIUI_CODE__: CodeSettings | undefined
}

/** The docs site's code settings; empty in the chat and other styles. */
export function codeSettings(): CodeSettings {
    return globalThis.__AIUI_CODE__ ?? {}
}
