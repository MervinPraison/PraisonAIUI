/**
 * Every lucide icon for docs `icon` values, without growing any loaded chunk.
 *
 * A Vite plugin. `import('virtual:aiui-icons')` is a tiny module whose default
 * export loads one icon's drawing: the icons are split by a hash of the name
 * into ICON_BUCKETS lazy chunks (2.5-5 kB gzip each), so a page fetches only
 * the buckets its icons are in; the loader maps old names (aliases) to the
 * icon. The drawings come from the installed lucide-react (ISC), so the set
 * follows its version. The build also writes
 * `aiui-icons.json` (every name, aliases included), which `aiui validate`
 * reads to warn about a name that is not an icon (compiler/content_lint.py).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const ICON_BUCKETS = 32
export const ICON_NAMES_FILE = 'aiui-icons.json'
const INDEX = 'virtual:aiui-icons'

/** The bucket an icon name is in. Inlined into the browser module, so it must stay self-contained. */
export function iconBucket(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  return h % 32
}

/**
 * lucide-react's icons from its ESM build: `nodes` (name → `[tag, attrs][]`,
 * React keys dropped) and `aliases` (an old name → the icon's name).
 */
export async function lucideIconNodes(esmDir) {
  const imports = readFileSync(path.join(esmDir, 'dynamicIconImports.js'), 'utf8')
  const nodes = {}
  const aliases = {}
  for (const m of imports.matchAll(/"([a-z0-9-]+)": \(\) => import\('\.\/icons\/([a-z0-9-]+)\.js'\)/g)) {
    const [, name, file] = m
    if (name !== file) aliases[name] = file
    else nodes[name] = (await import(pathToFileURL(path.join(esmDir, 'icons', `${file}.js`)).href)).__iconNode.map(([tag, { key: _key, ...attrs }]) => [tag, attrs])
  }
  if (Object.keys(nodes).length < 1000) throw new Error(`lucide-icons: found ${Object.keys(nodes).length} icons in ${esmDir}; did lucide-react change its layout?`)
  return { nodes, aliases }
}

/** The Vite plugin: `virtual:aiui-icons` (the loader) and its bucket chunks; `aiui-icons.json` in a build. */
export function lucideIcons(root) {
  let icons
  const all = () => (icons ??= lucideIconNodes(path.join(root, 'node_modules', 'lucide-react', 'dist', 'esm')))
  return {
    name: 'aiui-lucide-icons',
    resolveId(id) {
      if (id === INDEX) return '\0aiui-icons'
      const bucket = /^virtual:aiui-icons\/(\d+)$/.exec(id)
      return bucket ? `\0aiui-icons-${bucket[1]}` : null
    },
    async load(id) {
      if (id === '\0aiui-icons') {
        const loaders = Array.from({ length: ICON_BUCKETS }, (_, i) => `() => import('${INDEX}/${i}')`)
        return [
          `const buckets = [${loaders.join(', ')}]`,
          `const aliases = ${JSON.stringify((await all()).aliases)}`,
          `const iconBucket = ${iconBucket.toString()}`,
          'export default (name) => {',
          '  const icon = Object.hasOwn(aliases, name) ? aliases[name] : name',
          '  return buckets[iconBucket(icon)]().then((m) => (Object.hasOwn(m.default, icon) ? m.default[icon] : undefined))',
          '}',
        ].join('\n')
      }
      const bucket = /^\0aiui-icons-(\d+)$/.exec(id)
      if (!bucket) return null
      const mine = Object.entries((await all()).nodes).filter(([name]) => iconBucket(name) === Number(bucket[1]))
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(Object.fromEntries(mine)))})`
    },
    async generateBundle() {
      const { nodes, aliases } = await all()
      const names = [...Object.keys(nodes), ...Object.keys(aliases)].sort()
      this.emitFile({ type: 'asset', fileName: ICON_NAMES_FILE, source: JSON.stringify(names) + '\n' })
    },
  }
}
