/**
 * Size budgets (`npm run size`, after `npm run build`). Gzip, level 9.
 *
 * Chunk names are content-hashed, so every path comes from the Vite manifest
 * (dist/aiui-manifest.json) through scripts/lib/build-manifest.mjs, never from
 * a glob on a name. "Closure" means a chunk plus everything it imports
 * statically: what the browser must download before that code can run.
 *
 * Budgets are the numbers measured when the React shell landed plus roughly
 * 10% headroom. Raise one only with a reason in the commit message.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { DIST, distPath, filesOf, loadManifest, namedChunks, staticClosure } from './scripts/lib/build-manifest.mjs'

const manifest = loadManifest()
const chunks = namedChunks(manifest)
const abs = (files) => files.map((f) => distPath(f))

// What the app shell (style `app`) loads before it can paint: the entry, the
// shell mount chunk and their static imports, with their stylesheets.
const bootClosure = staticClosure(manifest, [chunks.entry, chunks.shellMount])
const bootJs = filesOf(manifest, bootClosure)
const bootAll = filesOf(manifest, bootClosure, { css: true })

// What opening /chat adds on top of the boot closure.
const chatClosure = staticClosure(manifest, [chunks.chatPage])
const chatRouteJs = filesOf(manifest, chatClosure).filter((f) => !bootJs.includes(f))

// The chat / docs / agents / playground / custom styles: entry + legacy App.
const legacyJs = filesOf(manifest, staticClosure(manifest, [chunks.entry, chunks.legacyApp]))

// Selectable layouts (ADR 0003 §1.4). vite.config.ts names the chunks of each
// layout `layout-<id>`, the kit `layout-kit` and each layout feature
// `lf-<name>`; a group may span several chunks. A layout's cost is its
// closure minus what boot already loaded. Budgets: measured at F3 (stub
// frames) plus 10%, never above the ADR caps (layouts 24 kB, Mission 28 kB;
// kit 10 kB). A layout track raises its own up to the cap, with the reason.
// The `lf-*` features do not exist yet: their entries are the ADR caps, for
// the track that lands each one to set from its measurement. Every group in
// the build must have a budget here.
const LAYOUT_BUDGETS = {
  'layout-chat-canvas': '4.6 kB',
  'layout-workbench': '4.6 kB',
  // The Command Deck frame (track K): rail, session tabs, status bar, phone
  // frame and shortcut sheet, plus the kit pieces it imports. 11.84 kB + 10%.
  'layout-command': '13.1 kB',
  'layout-guided': '4.6 kB',
  'layout-mission': '4.6 kB',
}
const KIT_BUDGET = '5 kB'
const FEATURE_BUDGETS = {
  'lf-artifacts': '30 kB',
  // Track K, measured at 8.34 kB and 1.46 kB, + 10%.
  'lf-run-inspector': '9.2 kB',
  'lf-command-bar': '1.6 kB',
  'lf-step-tracker': '6 kB',
  'lf-mission-board': '22 kB',
}
/** The app shell's default layout (style `app`): its /chat first screen has its own budget. */
const DEFAULT_LAYOUT = 'layout-chat-canvas'

const groupKeys = new Map()
for (const [key, c] of Object.entries(manifest)) {
  if (!/^(layout|lf)-[a-z][a-z0-9-]*$/.test(c.name ?? '')) continue
  if (!groupKeys.has(c.name)) groupKeys.set(c.name, [])
  groupKeys.get(c.name).push(key)
}
// A layout or the kit whose chunk is missing from the build would otherwise
// lose its budget without a word (the frames are lazy, so Rollup drops them
// when nothing registers them). The `lf-*` features are optional until their
// tracks land.
const missing = [...Object.keys(LAYOUT_BUDGETS), 'layout-kit'].filter((group) => !groupKeys.has(group))
if (missing.length > 0) {
  throw new Error(`.size-limit.mjs: no chunk in the build for ${missing.join(', ')}; is builtin.layouts in BUILTIN_PLUGINS?`)
}
const bootSet = new Set(bootAll)
const groupFiles = (group) =>
  filesOf(manifest, staticClosure(manifest, groupKeys.get(group)), { css: true }).filter((f) => !bootSet.has(f))
const layoutEntries = [...groupKeys.keys()].sort().map((group) => {
  const limit = group === 'layout-kit' ? KIT_BUDGET : (LAYOUT_BUDGETS[group] ?? FEATURE_BUDGETS[group])
  if (!limit) throw new Error(`.size-limit.mjs: no budget for chunk group ${group}; add it to LAYOUT_BUDGETS or FEATURE_BUDGETS`)
  const what = group === 'layout-kit' ? 'layout kit' : group.startsWith('lf-') ? `layout feature ${group}` : `layout ${group} (closure minus boot)`
  return { name: what, path: abs(group === 'layout-kit' ? filesOf(manifest, groupKeys.get(group), { css: true }) : groupFiles(group)), limit, gzip: true }
})
const defaultLayoutFirstScreen = [
  {
    name: '/chat first screen JS with the default layout (boot + layout-chat-canvas + kit + chat route)',
    path: abs([...new Set([...bootJs, ...groupFiles(DEFAULT_LAYOUT).filter((f) => f.endsWith('.js')), ...chatRouteJs])]),
    limit: '270 kB',
    gzip: true,
  },
]

// Everything under dist/assets ships in the Python wheel.
const allAssets = readdirSync(path.join(DIST, 'assets'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name))

export default [
  { name: 'shell boot (JS + CSS before first paint)', path: abs(bootAll), limit: '150 kB', gzip: true },
  { name: 'chat route (added by /chat)', path: abs(chatRouteJs), limit: '140 kB', gzip: true },
  { name: '/chat first screen JS (boot + chat route)', path: abs([...bootJs, ...chatRouteJs]), limit: '250 kB', gzip: true },
  // 23.4 kB after dropping the sources no build includes from the Tailwind scan.
  { name: 'index.css', path: abs(['assets/index.css']), limit: '26 kB', gzip: true },
  // The 145 kB budget was set with `gzip -9` (reference zlib), which gives
  // 144.8 kB for this chunk. size-limit compresses with Node's zlib (Chromium's
  // fork), which gives 146.6 kB for the same bytes: 147 kB is that budget here.
  { name: 'Streamdown renderer chunk', path: abs([manifest[chunks.streamdown].file]), limit: '147 kB', gzip: true },
  { name: 'shikiPlugin chunk', path: abs([manifest[chunks.shikiPlugin].file]), limit: '55 kB', gzip: true },
  { name: 'legacy App path (entry + legacy-app-entry closure)', path: abs(legacyJs), limit: '250 kB', gzip: true },
  ...layoutEntries,
  ...defaultLayoutFirstScreen,
  // Uncompressed: this is what the wheel carries.
  { name: 'wheel: all of dist/assets (uncompressed)', path: allAssets, limit: '9 MB', brotli: false },
]
