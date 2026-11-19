/**
 * Every bundled Shiki theme for docs code blocks (`site.theme.code`), each
 * its own lazy chunk, without growing any loaded chunk.
 *
 * A Vite plugin. `import('virtual:aiui-code-themes')` is a small map from a
 * theme name to the loader of its chunk. A theme keeps only what highlighting
 * reads (token colours, the editor background and text colour), about half
 * of the published file. The default pair (github-light, github-dark) is
 * imported directly by markdown/shikiPlugin.ts, so it is not in the map.
 * The build also writes `aiui-code.json` (every theme with its type,
 * background and text colour), which `aiui build` reads to check
 * `site.theme.code` and to set the code block background
 * (src/praisonaiui/compiler/code_theme.py).
 */
import { normalizeTheme } from 'shiki/core'

export const CODE_FILE = 'aiui-code.json'
export const DEFAULT_THEMES = ['github-light', 'github-dark']
const INDEX = 'virtual:aiui-code-themes'
const PREFIX = `${INDEX}/`

/** What highlighting reads of a theme (see shiki's normalizeTheme). */
export function trimTheme(theme) {
  const colors = {}
  for (const key of ['editor.background', 'editor.foreground']) if (theme.colors?.[key]) colors[key] = theme.colors[key]
  const strip = (rules) => rules?.map(({ name: _name, ...rule }) => rule)
  return {
    name: theme.name,
    displayName: theme.displayName,
    type: theme.type,
    colors,
    ...(theme.tokenColors ? { tokenColors: strip(theme.tokenColors) } : {}),
    ...(theme.settings ? { settings: strip(theme.settings) } : {}),
    ...(theme.colorReplacements ? { colorReplacements: theme.colorReplacements } : {}),
    ...(theme.fg ? { fg: theme.fg } : {}),
    ...(theme.bg ? { bg: theme.bg } : {}),
  }
}

/** The Vite plugin: `virtual:aiui-code-themes` and a chunk per theme; `aiui-code.json` in a build. */
export function codeThemes() {
  let info
  const all = () => (info ??= import('shiki/themes').then((m) => m.bundledThemesInfo))
  const load = async (id) => (await (await all()).find((t) => t.id === id).import()).default
  return {
    name: 'aiui-code-themes',
    resolveId(id) {
      if (id === INDEX) return '\0aiui-code-themes'
      return id.startsWith(PREFIX) ? `\0aiui-code-theme-${id.slice(PREFIX.length)}` : null
    },
    async load(id) {
      if (id === '\0aiui-code-themes') {
        const names = (await all()).map((t) => t.id).filter((name) => !DEFAULT_THEMES.includes(name))
        const entries = names.map((name) => `  ${JSON.stringify(name)}: () => import('${PREFIX}${name}'),`)
        return `export default {\n${entries.join('\n')}\n}`
      }
      if (!id.startsWith('\0aiui-code-theme-')) return null
      const theme = trimTheme(await load(id.slice('\0aiui-code-theme-'.length)))
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(theme))})`
    },
    async generateBundle() {
      const themes = {}
      for (const t of await all()) {
        const { type, bg, fg } = normalizeTheme(await load(t.id))
        themes[t.id] = { type, bg, fg }
      }
      this.emitFile({ type: 'asset', fileName: CODE_FILE, source: JSON.stringify({ themes }) + '\n' })
    },
  }
}
