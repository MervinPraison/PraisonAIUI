/**
 * Read dist/aiui-manifest.json (the Vite manifest) and answer "which files
 * does this chunk load?".
 *
 * Chunk file names are content-hashed, so gates must not glob for them. The
 * manifest maps a key (a source module, or `_<chunk>.js` for a shared chunk)
 * to `{ file, imports, dynamicImports, css, isEntry, isDynamicEntry }`, where
 * `imports` (static) and `dynamicImports` (lazy) hold other manifest keys.
 *
 * Used by .size-limit.mjs and scripts/check-entry-closure.mjs.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DIST = path.join(FRONTEND_ROOT, 'dist')
export const MANIFEST_NAME = 'aiui-manifest.json'

/** Manifest key of the app entry (vite.config.ts: rollupOptions.input). */
export const ENTRY_KEY = 'index.html'

export class ManifestError extends Error {}

export function loadManifest(dist = DIST) {
  const file = path.join(dist, MANIFEST_NAME)
  if (!existsSync(file)) {
    throw new ManifestError(`${path.relative(process.cwd(), file) || file} is missing; run \`npm run build\` first`)
  }
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  if (!manifest[ENTRY_KEY]?.isEntry) throw new ManifestError(`${MANIFEST_NAME} has no "${ENTRY_KEY}" entry`)
  return manifest
}

function chunk(manifest, key) {
  const c = manifest[key]
  if (!c) throw new ManifestError(`${MANIFEST_NAME} has no chunk "${key}"`)
  return c
}

/**
 * Keys of every chunk loaded together with `keys`: the chunks themselves plus
 * everything they import statically, transitively. Lazy imports are not followed.
 */
export function staticClosure(manifest, keys) {
  const seen = new Set()
  const stack = [...keys]
  while (stack.length) {
    const key = stack.pop()
    if (seen.has(key)) continue
    seen.add(key)
    for (const dep of chunk(manifest, key).imports ?? []) stack.push(dep)
  }
  return seen
}

/** dist-relative files (JS, and CSS when `css` is true) of a set of keys. */
export function filesOf(manifest, keys, { css = false } = {}) {
  const files = new Set()
  for (const key of keys) {
    const c = chunk(manifest, key)
    if (/\.js$/.test(c.file) || css) files.add(c.file)
    if (css) for (const sheet of c.css ?? []) files.add(sheet)
  }
  return [...files].sort()
}

/**
 * Find exactly one chunk key. `test(key, chunk)` picks it; the error names
 * `what` so a renamed module fails loudly instead of measuring nothing.
 */
export function findKey(manifest, what, test) {
  const hits = Object.keys(manifest).filter((key) => test(key, manifest[key]))
  if (hits.length !== 1) {
    throw new ManifestError(
      `expected exactly one ${what} chunk in ${MANIFEST_NAME}, found ${hits.length}${hits.length ? `: ${hits.join(', ')}` : ''}. ` +
        'If the module was renamed or its chunking changed, update scripts/lib/build-manifest.mjs.',
    )
  }
  return hits[0]
}

/** The lazy chunks the entry (main.tsx) chooses between, found by what they are. */
function entryLazyKeys(manifest) {
  return chunk(manifest, ENTRY_KEY).dynamicImports ?? []
}

/**
 * Named chunks the gates care about.
 *
 *   entry        assets/index.js (main.tsx): the boot split
 *   shellMount   shell/mount.tsx, loaded when <html data-aiui-shell="react">
 *   legacyApp    legacy-app-entry.tsx, loaded for the chat/docs/agents/... styles
 *   chatPage     chat-engine/ChatPage.tsx, the shell's chat route
 *   streamdown   the Streamdown renderer (markdown/Markdown.tsx and streamdown itself)
 *   shikiPlugin  markdown/shikiPlugin.ts (curated Shiki core)
 */
export function namedChunks(manifest) {
  const lazy = entryLazyKeys(manifest)
  const legacyApp = findKey(manifest, 'legacy-app-entry', (key) => key === 'src/legacy-app-entry.tsx')
  if (!lazy.includes(legacyApp)) throw new ManifestError('the entry no longer lazy-loads src/legacy-app-entry.tsx')
  // Rollup merges shell/mount.tsx with modules it shares, so the chunk has no
  // `src` key of its own: it is the entry's other lazy import.
  const others = lazy.filter((key) => key !== legacyApp)
  if (others.length !== 1) {
    throw new ManifestError(`expected the entry to lazy-load the shell mount and legacy-app-entry, found: ${lazy.join(', ')}`)
  }
  const shellMount = others[0]
  if (chunk(manifest, shellMount).name !== 'mount') {
    throw new ManifestError(`the entry's shell chunk is "${chunk(manifest, shellMount).name}", expected "mount"`)
  }
  const chatPage = findKey(manifest, 'ChatPage', (_key, c) => c.name === 'ChatPage' && c.isDynamicEntry === true)
  // Streamdown's renderer chunk is named after one of streamdown's internal
  // modules, so identify it by behaviour: it is the chunk that lazy-loads
  // streamdown's own highlighted-body module.
  const streamdown = findKey(manifest, 'Streamdown renderer', (_key, c) =>
    (c.dynamicImports ?? []).some((dep) => /node_modules\/streamdown\/dist\/highlighted-body-/.test(dep)),
  )
  const shikiPlugin = findKey(manifest, 'shikiPlugin', (key) => key === 'src/markdown/shikiPlugin.ts')
  return { entry: ENTRY_KEY, shellMount, legacyApp, chatPage, streamdown, shikiPlugin }
}

/** dist-relative path -> absolute path. */
export function distPath(file, dist = DIST) {
  return path.join(dist, file)
}
