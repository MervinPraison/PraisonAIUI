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
// An `lf-*` feature that has not landed yet keeps the ADR cap as its entry,
// for the track that lands it to set from its measurement. Every group in
// the build must have a budget here.
//
// Track W (kit v2: page icons, session times, ConnectionStatus, Brand, feed
// hooks) measured the kit at 6.62 kB, each stub frame at 6.1 kB (a layout's
// closure includes the kit) and the Workbench frame at 8.49 kB: each limit is
// that plus 10%. Every layout's closure holds the kit chunks, so a frame that
// uses a different part of the kit splits it for all of them (the Command
// Deck uses no BasicFrame or ShortcutHint; Guided's frame uses no BasicFrame
// and its Home page only useSessions; Mission is the first to use PhoneTabs,
// and the mission board shares useSessions with the frames).
const LAYOUT_BUDGETS = {
  // The Chat + Canvas frame (track CC), measured at 8.34 kB + 10%.
  // Design fixes round 2 (the connection dot in the top bar, one-line chat
  // rows with compact times, Share on the chat only, the brand tile):
  // 9.74 kB + 10%.
  // Design parity part 3 (#418: two-line chat rows with artifact counts,
  // More ⌘K, the connection line, the Canvas toggle slot) measured 10.99 kB;
  // the owner approved 11.5 kB for the remaining parity work (the Paper look
  // and the conversation land at 11.45 kB).
  'layout-chat-canvas': '11.5 kB',
  // Integrated (all five frames, kit v2, the shared page-icon table in
  // lib/): 9.42 kB + 10%.
  // +0.1 kB (10.43 kB measured, #418): the kit's ConnectionStatus, now used by
  // Chat + Canvas too, splits into a shared kit chunk in this closure.
  'layout-workbench': '10.5 kB',
  // The Command Deck frame (track K): rail, session tabs, status bar, phone
  // frame and shortcut sheet, plus the kit pieces it imports. 11.84 kB on
  // its branch; integrated with kit v2 (which every frame's closure holds,
  // split into seven chunks across the five frames) 13.85 kB + 10%.
  'layout-command': '15.2 kB',
  // Guided (frame, phone tabs, chat regions, Home and Templates pages, every
  // chunk of the group) measured 15.25 kB + 10%.
  // Design fixes (kit group headers with a chevron, outline New chat, the
  // chat header rules in guided.css): 16.92 kB + 10%.
  'layout-guided': '18.6 kB',
  // Mission (frame, top bar, nav counts, phone tabs, data hooks) measured
  // 9.52 kB on its branch; integrated with kit v2 (5.85 kB of kit chunks in
  // its closure, up from 3.05) 12.01 kB + 10%. describeCall ships in
  // lf-mission-board.
  'layout-mission': '13.2 kB',
}
// Design fixes round 2 (BrandTile with the single-colour glyph, the chat
// list's search toggle, NavSection's title-row action): 7.51 kB + 10%.
const KIT_BUDGET = '8.3 kB'
const FEATURE_BUDGETS = {
  'lf-artifacts': '30 kB',
  // Track K, measured at 8.34 kB and 1.46 kB, + 10%.
  'lf-run-inspector': '9.2 kB',
  'lf-command-bar': '1.6 kB',
  // Measured at 5.08 kB (StepTracker and its labels, one chunk); ADR cap 6 kB.
  'lf-step-tracker': '5.6 kB',
  // Measured at 10.75 kB (one chunk, mission-board/index.ts) plus 10%; ADR cap 22 kB.
  'lf-mission-board': '11.8 kB',
}
// ADR 0003 §1.4 caps: a budget may be raised up to its cap, never past it.
const CAPS = {
  layout: 24,
  'layout-mission': 28,
  'layout-kit': 10,
  'lf-artifacts': 30,
  'lf-run-inspector': 14,
  'lf-command-bar': 6,
  'lf-step-tracker': 6,
  'lf-mission-board': 22,
}
const kB = (limit) => Number.parseFloat(limit)
for (const [group, limit] of [...Object.entries(LAYOUT_BUDGETS), ['layout-kit', KIT_BUDGET], ...Object.entries(FEATURE_BUDGETS)]) {
  const cap = CAPS[group] ?? (group.startsWith('layout-') ? CAPS.layout : undefined)
  if (cap === undefined || !limit.endsWith(' kB') || kB(limit) > cap) {
    throw new Error(`.size-limit.mjs: budget ${limit} for ${group} is not in kB under its ADR cap (${cap ?? 'none'} kB)`)
  }
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

// The Pro type (styles/fonts.css): Geist and Geist Mono from
// @fontsource-variable (OFL-1.1), latin woff2 only, fetched by the Pro pages
// (layouts, docs site) on first paint and by nothing else. woff2 is already
// compressed, so the budget is the served bytes: 52.53 kB measured + 10%.
const PRO_FONTS = Object.keys(manifest)
  .filter((key) => /@fontsource-variable\/geist(-mono)?\/files\/[\w-]+\.woff2$/.test(key))
  .map((key) => manifest[key].file)
if (PRO_FONTS.length !== 2) {
  throw new Error(`.size-limit.mjs: expected the two Geist woff2 files in the build, found ${PRO_FONTS.length}`)
}

// The Paper look's type (app-layouts/chat-canvas/paper.css): Newsreader,
// Source Sans 3 and JetBrains Mono from @fontsource-variable (OFL-1.1),
// latin woff2 only, fetched only while Chat + Canvas paints with its own
// look. Served bytes (woff2 is compressed): PAPER_MEASURED + 10%.
const PAPER_FONTS = Object.keys(manifest)
  .filter((key) => /@fontsource-variable\/(newsreader|source-sans-3|jetbrains-mono)\/files\/[\w-]+\.woff2$/.test(key))
  .map((key) => manifest[key].file)
if (PAPER_FONTS.length !== 3) {
  throw new Error(`.size-limit.mjs: expected the three Paper woff2 files in the build, found ${PAPER_FONTS.length}`)
}

// Everything under dist/assets ships in the Python wheel.
const allAssets = readdirSync(path.join(DIST, 'assets'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name))

export default [
  { name: 'shell boot (JS + CSS before first paint)', path: abs(bootAll), limit: '150 kB', gzip: true },
  // +0.5 kB / +1 kB: the app pages (src/app-pages, lazy) share icon modules
  // with the chat's lazy children, so Rollup splits two of them (x, pause)
  // into chunks of their own: 140.15 kB and 250.4 kB measured. The chat's
  // own code grew by a few bytes ("Connected" at every width).
  // +0.5 kB (140.72 kB measured), design fixes round 2: the inline approval
  // always shows the exact command before Approve (a safety fix, with the
  // small presentation/command module), the tool row's risk chip, the
  // card-merged row, the transport's reconnect() for Retry, and the
  // connection field on the chat feed.
  // +0.1 kB (141.09 kB measured, owner-approved: exactly the cost of the
  // fixes): the tool row's "→ first line of output" and the Send button that
  // stays an aria-disabled button with nothing to send.
  { name: 'chat route (added by /chat)', path: abs(chatRouteJs), limit: '141.1 kB', gzip: true },
  // 252.5 kB, three raises. +1 kB (251.48 kB measured, #373): builtin.artifacts
  // joins the boot list (its record and the lazy ArtifactsPage loader in
  // pluginLoaders/mount), and the new-chat hero draws the PraisonAI glyph
  // instead of the emoji mascot. The docs Pro restyle (docs/pro-style) then
  // added two paths to the entry's preload map for the lazy legacy App chunk
  // (its docs/docs.css stylesheet and the Spinner chunk): 251.53 kB measured
  // with both, inside the 252 kB #373 set, so the larger need stands alone.
  // +0.5 kB (252.02 kB measured, #387): the Knowledge page's registration
  // (one more lazy pagePlugin loader in builtin/appPages, next to Agents).
  // +0.1 kB (252.55 kB measured, #419, owner-approved): the layout host sets
  // a layout's look (<html data-aiui-look>, Chat + Canvas's Paper) and
  // builtin.layouts registers "Switch look: Paper / Pro".
  // +0.2 kB (252.8 kB measured): the chat route's +0.17 kB above and the
  // composerTool region wiring in the boot path (the "@" loader, meta.chat
  // validation), 0.06 kB.
  { name: '/chat first screen JS (boot + chat route)', path: abs([...bootJs, ...chatRouteJs]), limit: '252.8 kB', gzip: true },
  // 23.4 kB after dropping the sources no build includes from the Tailwind scan.
  { name: 'index.css', path: abs(['assets/index.css']), limit: '26 kB', gzip: true },
  // The 145 kB budget was set with `gzip -9` (reference zlib), which gives
  // 144.8 kB for this chunk. size-limit compresses with Node's zlib (Chromium's
  // fork), which gives 146.6 kB for the same bytes: 147 kB was that budget.
  // +1 kB for the chat's collapsible code blocks (markdown/CodeBlock.tsx:
  // 12-line collapse, wrap toggle, sideways-scroll fade), 147.4 kB measured.
  { name: 'Streamdown renderer chunk', path: abs([manifest[chunks.streamdown].file]), limit: '148 kB', gzip: true },
  { name: 'shikiPlugin chunk', path: abs([manifest[chunks.shikiPlugin].file]), limit: '55 kB', gzip: true },
  { name: 'legacy App path (entry + legacy-app-entry closure)', path: abs(legacyJs), limit: '250 kB', gzip: true },
  ...layoutEntries,
  ...defaultLayoutFirstScreen,
  { name: 'Pro fonts (Geist + Geist Mono, latin woff2, as served)', path: abs(PRO_FONTS), limit: '58 kB', brotli: false },
  { name: 'Paper fonts (Newsreader + Source Sans 3 + JetBrains Mono, latin woff2, as served)', path: abs(PAPER_FONTS), limit: '140 kB', brotli: false },
  // Uncompressed: this is what the wheel carries.
  // 9.1 MB (9.07 MB measured, #419, owner-approved): the Paper look's three
  // woff2 files (127 kB). 9,105,362 B (measured, raised by exactly the
  // overage): docs page actions and section links (+6,965 B on main's
  // 9,098,397 B; the docs Paper type and search took the rest of the headroom).
  // 9,105,873 B (measured, raised by exactly the overage): no layout shift
  // from the docs hero image or the phone's folded TOC (+511 B).
  // 9,110,651 B (measured, raised by exactly the overage): docs code block
  // file names, highlighted lines and code groups (+4,778 B).
  // 9,120,786 B (measured, raised by exactly the overage): docs authoring
  // components (callouts, steps, cards, tabs, accordions, frames) and image
  // zoom (+10,135 B).
  // 9,124,255 B (measured, raised by exactly the overage): docs page footer,
  // edit this page, last updated and was this page helpful (+3,469 B).
  // 9,124,592 B (measured, raised by exactly the overage): each docs page's
  // markdown read from its HTML (docLoader.adoptInlinedDoc, +337 B).
  { name: 'wheel: all of dist/assets (uncompressed)', path: allAssets, limit: '9124592 B', brotli: false },
]
