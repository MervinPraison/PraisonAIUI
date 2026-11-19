// The lazy code theme loaders (scripts/lib/code-themes.mjs, a Vite plugin).
declare module 'virtual:aiui-code-themes' {
    /** Theme name -> its chunk (every bundled Shiki theme but github-light / github-dark). */
    const themes: Record<string, () => Promise<{ default: import('shiki/core').ThemeRegistrationRaw }>>
    export default themes
}
