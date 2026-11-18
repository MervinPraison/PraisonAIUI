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
  // 12.348 kB (measured, raised by exactly the overage, +848 B): the groups
  // plugins declare and the Plugin settings row in every layout (R2; kit
  // DeclaredNavGroups, PluginSettingsRow, NavSection now in this closure).
  // 12.35 kB (measured, raised by exactly the overage, +2 B): the chat
  // engine's run_attach code moved a chunk boundary (reload adoption).
  // 12.354 kB (measured, raised by exactly the overage, +4 B): the
  // @aiui.welcome greeting in the new-chat hero moved a chunk boundary.
  // 12.36 kB (measured, raised by exactly the overage, +6 B): base-path hosting
  // (aiui build --base-path): chunks, preloads and CSS url()s resolve relative
  // to import.meta.url (vite renderBuiltUrl), so each dynamic import passes
  // import.meta.url; src/lib/url.ts joins the legacy App chunk.
  // 12.362 kB (+2 B, exactly the overage): chunk hashes renamed by the docs
  // component tags change; no layout code changed.
  // 12.372 kB (+10 B, exactly the overage): chunk hashes renamed; no layout code changed.
  'layout-chat-canvas': '12.372 kB',
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
  // 141,167 B (measured, raised by exactly the overage, +67 B): the docs style's
  // layouts became lazy chunks (R4) and Rollup re-split a shared module (input) the
  // chat route also uses; every docs page loads 53.6 KB gzip less.
  // 141,169 B (measured, raised by exactly the overage, +2 B): plugin layout
  // cssIntegrity in the manifest normalizer moved a shared module's gzip window.
  // 141,178 B (measured, raised by exactly the overage, +9 B): the access-token
  // fetch wrapper and the sign-in prompt (lib/auth, lib/TokenGate) are shared
  // with the legacy React App now, so Rollup re-split the chunks around them.
  // 141,274 B (measured, raised by exactly the overage, +96 B): the
  // @aiui.welcome greeting on the empty thread (its fetch is a lazy chunk).
  // 141,882 B (measured, raised by exactly the overage, +608 B): a tab
  // reloaded mid-reply takes its run back (run_attach, replay, seq).
  // 141,891 B (measured, raised by exactly the overage, +9 B): the
  // @aiui.welcome greeting in the layouts' new-chat hero.
  // 141,892 B (measured, raised by exactly the overage, +1 B): base-path hosting
  // (aiui build --base-path): chunks, preloads and CSS url()s resolve relative
  // to import.meta.url (vite renderBuiltUrl), so each dynamic import passes
  // import.meta.url; src/lib/url.ts joins the legacy App chunk.
  // 141,898 B (+6 B, exactly the overage): the <Visibility> entry in DOCS_TAGS.
  // 141,899 B (+1 B, exactly the overage): one more lazy page chunk name in the
  // shared preload map (builtin.connect).
  { name: 'chat route (added by /chat)', path: abs(chatRouteJs), limit: '141899 B', gzip: true },
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
  // 253,124 B (measured, raised by exactly the overage, +324 B): the same re-split.
  // 253,128 B (measured, raised by exactly the overage, +4 B): no code added;
  // the classic chat's error boundary gives legacy-app-entry a new content
  // hash, and index.js, which names that chunk, gzips 4 B larger.
  // 253,145 B (measured, raised by exactly the overage, +17 B): the manifest
  // keeps a plugin layout's cssIntegrity and the loader sets it on the <link>.
  // 253,161 B (+16 B, exactly the overage): LayoutHost clears a server-set look.
  // 253,339 B (measured, raised by exactly the overage, +178 B): the same
  // re-split (lib/auth and lib/TokenGate in a chunk the shell and the legacy
  // App share) and the 401 hook for docs content.
  // 253,419 B (measured, raised by exactly the overage, +80 B): the same greeting.
  // 253,464 B (measured, raised by exactly the overage, +45 B): LayoutHost
  // passes the declared nav groups and chrome.openSettings to the frame.
  // 254,080 B (measured, raised by exactly the overage, +616 B): the same.
  // 254,082 B (measured, raised by exactly the overage, +2 B): new hashed names of
  // the lazy docs App chunks (hidden pages, seoMeta) in the entry's preload map;
  // no chat code changed.
  // 254,090 B (measured, raised by exactly the overage, +8 B): the
  // @aiui.welcome greeting in the layouts' new-chat hero.
  // 254,157 B (measured, raised by exactly the overage, +67 B): base-path hosting
  // (aiui build --base-path): chunks, preloads and CSS url()s resolve relative
  // to import.meta.url (vite renderBuiltUrl), so each dynamic import passes
  // import.meta.url; src/lib/url.ts joins the legacy App chunk.
  // 254,171 B (+14 B, exactly the overage): the <Visibility> entry in DOCS_TAGS.
  // 254,172 B (+1 B, exactly the overage): new hashed DocsSearch chunk name in
  // the entry's preload map (docs full-text search); no chat code changed.
  // 254,292 B (+120 B, exactly the overage): builtin.connect's lazy page
  // registration in the boot chunk (the page itself is a lazy chunk).
  { name: '/chat first screen JS (boot + chat route)', path: abs([...bootJs, ...chatRouteJs]), limit: '254292 B', gzip: true },
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
  // 9,125,726 B (measured, raised by exactly the overage): docs sidebar icons
  // and the phone breadcrumb (+1,134 B).
  // 9,125,858 B (measured, raised by exactly the overage): docs code blocks laid
  // out at their real height from the first frame (+132 B).
  // 9,134,317 B (measured, raised by exactly the overage, +8,459 B): the style
  // layouts as lazy chunks; the bytes are chunk boundaries, no page loads more.
  // 9,134,625 B (measured, raised by exactly the overage, +308 B): the classic
  // chat's element error boundary (MultimediaElements), which replaces a
  // try/catch that could not catch render errors.
  // 9,134,657 B (measured, raised by exactly the overage, +32 B): plugin
  // layout css SRI (cssIntegrity) in the manifest normalizer and loader.
  // 9,134,666 B (+9 B, exactly the overage): the same LayoutHost change.
  // 9,135,130 B (measured, raised by exactly the overage, +464 B): the legacy
  // App's sign-in (AuthGate) and the shared auth chunk.
  // 9,136,671 B (measured, raised by exactly the overage, +1,541 B): the
  // @aiui.welcome greeting (chat engine, its lazy chunk and the chat style).
  // 9,138,410 B (measured, raised by exactly the overage, +1,739 B): plugin
  // nav groups and the Plugin settings entry in every layout frame.
  // 9,140,565 B (measured, raised by exactly the overage, +2,155 B): a tab
  // reloaded mid-reply takes its run back.
  // 9,140,919 B (measured, raised by exactly the overage, +354 B): hidden docs
  // pages (sidebar, pager, search) and the docs seoMeta helper.
  // 9,141,034 B (measured, raised by exactly the overage, +115 B): the
  // @aiui.welcome greeting in the layouts' new-chat hero.
  // 9,141,792 B (measured, raised by exactly the overage, +758 B): base-path hosting
  // (aiui build --base-path): chunks, preloads and CSS url()s resolve relative
  // to import.meta.url (vite renderBuiltUrl), so each dynamic import passes
  // import.meta.url; src/lib/url.ts joins the legacy App chunk.
  // 9,145,081 B (measured, raised by exactly the overage, +3,289 B): docs
  // component tags anywhere (docsTags.ts, one component per element, {#id}).
  // 9,151,241 B (measured, raised by exactly the overage, +6,160 B): docs code
  // block options (codeMeta.ts, DocsPre.tsx, docs.css: titles, flags, focus,
  // diff notation, <CodeBlock>).
  // 9,160,731 B (measured, raised by exactly the overage, +9,490 B): docs layout
  // component options (DocsBlocks.tsx, DocsTabs.tsx, tabSync.ts, docs.css) and the
  // lazy TabsSelect chunk of dropdown code groups.
  // 9,167,917 B (measured, raised by exactly the overage, +7,186 B): docs API
  // fields (ApiFields.tsx, panels.ts, docs.css: field rows, Expandable, the
  // examples side column).
  // 9,168,243 B (+326 B, exactly the overage): <Visibility> and docPathToSource (agent-ready .md).
  // 9,172,759 B (measured, raised by exactly the overage, +4,516 B): docs
  // full-text search (searchIndex.ts BM25, searchRank.ts, tab chips in DocsSearch).
  // 9,176,036 B (measured, raised by exactly the overage, +3,277 B): docs
  // sidebar groups that fold, group pages, drilldown and breadcrumbs.
  // 9,179,031 B (measured, raised by exactly the overage, +2,995 B): page
  // front matter (description lede, badges, modes, external links, meta).
  // 9,196,121 B (measured, raised by exactly the overage, +17,090 B): docs
  // Callout, Badge, Tooltip, Tree, Prompt, Tile, Color (DocsWidgets.tsx, docs.css).
  // 9,573,966 B (measured, raised by exactly the overage, +377,845 B): every
  // lucide icon for docs icons, in 32 lazy chunks no page loads unless it shows
  // one of their icons (scripts/lib/lucide-icons.mjs; ~1,670 drawings, 377 kB).
  // 9,588,481 B (measured, raised by exactly the overage, +14,515 B): the
  // Connect page chunk (app-pages/connect).
  { name: 'wheel: all of dist/assets (uncompressed)', path: allAssets, limit: '9588481 B', brotli: false },
]
