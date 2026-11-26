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
  // 12.373 kB (+1 B, exactly the overage): the docs App's first-screen icons moved into its own chunk (virtual:aiui-icons/inline), so the one-icon chunks it shared with the layouts regrouped; no layout code changed.
  // 12.377 kB (+4 B, exactly the overage): buildLayoutNav reads layout.groups.shown (the app's own groups).
  // 12.428 kB (+51 B, exactly the overage, 2026-11-22): app page icons (lib/PageGlyph: any lucide name from the lazy icon buckets, image URLs, emoji) at the nav call site.
  // 12.436 kB (+8 B, exactly the overage, 2026-11-26): chunk hash rename from navigate() query params; no layout code changed.
  // 12.438 kB (+2 B, exactly the overage, 2026-11-26): chunk hash rename from table/gallery polish; no layout code changed.
  // 12.47 kB (+32 B, exactly the overage, 2026-11-26): NavList renders string/numeric page.badge across selectable layouts.
  'layout-chat-canvas': '12.47 kB',
  // Integrated (all five frames, kit v2, the shared page-icon table in
  // lib/): 9.42 kB + 10%.
  // +0.1 kB (10.43 kB measured, #418): the kit's ConnectionStatus, now used by
  // Chat + Canvas too, splits into a shared kit chunk in this closure.
  'layout-workbench': '10.5 kB',
  // The Command Deck frame (track K): rail, session tabs, status bar, phone
  // frame and shortcut sheet, plus the kit pieces it imports. 11.84 kB on
  // its branch; integrated with kit v2 (which every frame's closure holds,
  // split into seven chunks across the five frames) 13.85 kB + 10%.
  // 15.259 kB (+59 B, exactly the overage, 2026-11-22): app page icons (lib/PageGlyph: any lucide name from the lazy icon buckets, image URLs, emoji) at the nav call site.
  // 15.265 kB (+6 B, exactly the overage, 2026-11-26): chunk hash rename from navigate() query params; no layout code changed.
  // 15.266 kB (+1 B, exactly the overage, 2026-11-26): chunk hash rename from table/gallery polish; no layout code changed.
  // 15.267 kB (+1 B, exactly the overage, 2026-11-26): chunk hash rename from remote select & pagination blocks; no layout code changed.
  // 15.318 kB (+51 B, exactly the overage, 2026-11-26): command rail & NavList string/numeric page.badge support.
  'layout-command': '15.318 kB',
  // Guided (frame, phone tabs, chat regions, Home and Templates pages, every
  // chunk of the group) measured 15.25 kB + 10%.
  // Design fixes (kit group headers with a chevron, outline New chat, the
  // chat header rules in guided.css): 16.92 kB + 10%.
  'layout-guided': '18.6 kB',
  // Mission (frame, top bar, nav counts, phone tabs, data hooks) measured
  // 9.52 kB on its branch; integrated with kit v2 (5.85 kB of kit chunks in
  // its closure, up from 3.05) 12.01 kB + 10%. describeCall ships in
  // lf-mission-board.
  // 13.207 kB (+7 B, exactly the overage): the docs App's first-screen icons moved into its own chunk (virtual:aiui-icons/inline), so the one-icon chunks it shared with the layouts regrouped; no layout code changed.
  // 13.21 kB (+3 B, exactly the overage): buildLayoutNav reads layout.groups.shown (the app's own groups).
  // 13.26 kB (+50 B, exactly the overage, 2026-11-22): app page icons (lib/PageGlyph: any lucide name from the lazy icon buckets, image URLs, emoji) at the nav call site.
  // 13.271 kB (+11 B, exactly the overage, 2026-11-26): chunk hash rename from navigate() query params; no layout code changed.
  // 13.272 kB (+1 B, exactly the overage, 2026-11-26): chunk hash rename from remote select & pagination blocks; no layout code changed.
  // 13.304 kB (+32 B, exactly the overage, 2026-11-26): NavList string/numeric page.badge support.
  'layout-mission': '13.304 kB',
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
    // 270,273 B (+273 B, exactly the overage, 2026-11-26): live sidebar badge/manifest updates in ShellApp + NavList badge fallback.
    limit: '270273 B',
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

// Try it on endpoint pages (docs/ApiPlayground.tsx, its CSS and what it alone
// imports): a lazy chunk the endpoint bar loads on first hover, focus or click.
// Measured 4.83 kB + 10%. 7,161 B (+1,861 B, exactly the overage): authentication
// inputs, file inputs and streamed responses (sessionStorage, FormData, SSE list).
// 7,162 B (+1 B, exactly the overage): docs components forward the page's utility
// classes (docs/docsClasses.ts), which moves a shared chunk boundary; no Try it code changed.
const tryItKey = Object.keys(manifest).find((key) => key === 'src/docs/ApiPlayground.tsx')
if (!tryItKey) throw new Error('.size-limit.mjs: no src/docs/ApiPlayground.tsx chunk in the build')
const legacyAll = new Set(filesOf(manifest, staticClosure(manifest, [chunks.entry, chunks.legacyApp]), { css: true }))
const tryItFiles = filesOf(manifest, staticClosure(manifest, [tryItKey]), { css: true }).filter((f) => !legacyAll.has(f))

// The chart block (blocks/chart/ChartBlock.tsx with recharts), a lazy chunk:
// its closure minus boot and minus the blocks page (BlockPage) closure.
const chartKey = 'src/blocks/chart/ChartBlock.tsx'
const blockPageKey = Object.keys(manifest).find((key) => manifest[key].name === 'BlockPage')
if (!manifest[chartKey] || !blockPageKey) throw new Error('.size-limit.mjs: no ChartBlock or BlockPage chunk in the build')
const blockPageFiles = new Set(filesOf(manifest, staticClosure(manifest, [blockPageKey]), { css: true }))
const chartFiles = filesOf(manifest, staticClosure(manifest, [chartKey]), { css: true }).filter(
  (f) => !bootSet.has(f) && !blockPageFiles.has(f),
)

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
  // 141,909 B (measured, raised by exactly the overage, +10 B): the docs
  // sanitizer schema keeps <img noZoom> and the light/dark image classes and
  // <source src> (markdown/Markdown.tsx), which the chat shares.
  // 141,933 B (+24 B, exactly the overage): the SDK modules (sdk/install and what it
  // imports) became their own shared chunk, since docs pages that use a site component
  // load them lazily (docs/customBlocks.ts); the chat route imports them from it.
  // 142,278 B (+345 B, exactly the overage): voice input's probe in the composer
  // (chat-engine/voice.ts, one GET /api/realtime/voice per page view) and the lazy
  // import of the recorder chunk; the recorder itself is not in the route.
  // 143,081 B (+803 B, exactly the overage): each message a reply sends is its own
  // block (message_id on reply text, the segment divider, message_update / remove /
  // actions / action_remove, saved segments on reload) and the toast frame through the
  // lazy toaster (sdk notify). Splitting the edits into a lazy chunk measured +137 B
  // more (the loader and holding later frames cost more than the code it moves).
  // 143,082 B (+1 B, exactly the overage): CommandDialog passes cmdk's controlled `value`
  // through (the docs search keeps a row highlighted when results arrive late).
  // 143,579 B (+497 B, exactly the overage): the reply's steps (step_* events build one
  // `step` part per top-level step in the reducer; the tree is the lazy parts/StepTree chunk).
  // 143,581 B (+2 B, exactly the overage): chunk hashes renamed by the shown nav groups; no chat code changed.
  // 143,597 B (+13 B, exactly the overage, 2026-11-22): media and overlay blocks; chunk names regrouped, no chat code changed.
  // 143,604 B (+7 B, exactly the overage, 2026-11-22): forms submit on change (blocks/useFormSubmit.ts).
  // 143,624 B (+20 B, exactly the overage, 2026-11-22): chunk hashes renamed by the data table, inputs, chart kinds and page icons; no chat code changed.
  // 143,628 B (+4 B, exactly the overage, 2026-11-26): chunk hash rename from doc viewer & sidebar badges; no chat code changed.
  { name: 'chat route (added by /chat)', path: abs(chatRouteJs), limit: '143628 B', gzip: true },
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
  // 254,331 B (measured, raised by exactly the overage, +39 B): the chat
  // route's +10 B above and new hashed docs chunk names in the entry's preload map.
  // 254,332 B (+1 B, exactly the overage): site.theme.strict in the shared
  // applyStoredThemePreference (themes.ts); no chat code changed.
  // 254,333 B (+1 B, exactly the overage): lazy redirects chunk name in the preload map.
  // 254,374 B (+41 B, exactly the overage): builtin.api-reference's lazy page
  // registration in the boot chunk (the page itself is a lazy chunk).
  // 254,397 B (+23 B, exactly the overage): new hashed chunk names in the entry's
  // preload map (the docs MCP menu items); no boot or chat code changed.
  // 254,411 B (+14 B, exactly the overage): docs tab panels carry data-title (the
  // printed tab titles) in the shared MkdocsTabs.
  // 254,412 B (+1 B, exactly the overage): the lazy brandIcons chunk name in the
  // entry's preload map; no boot or chat code changed.
  // 254,460 B (+48 B, exactly the overage): the lazy Ask AI chunk names in the entry's
  // preload map (docs/AskAi.tsx); no boot or chat code changed.
  // 255,228 B (+768 B, exactly the overage): the SDK modules the shell boots with
  // (sdk/install and its imports) are a chunk of their own now that docs pages with a
  // site component load them lazily (docs/customBlocks.ts); same code, one more file.
  // 255,578 B (+350 B, exactly the overage): voice input's probe in the chat route (above).
  // 256,385 B (+807 B, exactly the overage): the reply's messages as blocks (chat route, above).
  // 256,562 B (+177 B, exactly the overage): the entry's boot-failure message with Reload and
  // the cache-busting reload after a deploy (main.tsx, chunkReload.ts).
  // 256,563 B (+1 B, exactly the overage): docLoader's reader for the manifests aiui build
  // inlines in each page (inlinedManifest).
  // 256,565 B (+2 B, exactly the overage): CommandDialog's controlled `value` (above).
  // 257,066 B (+501 B, exactly the overage): the reply's steps (chat route, above).
  // 257,069 B (+2 B, exactly the overage, 2026-11-22): chunk hashes renamed by the lazy sections; no chat code changed.
  // 257,135 B (+66 B, exactly the overage, 2026-11-22): media and overlay blocks; chunk names regrouped, no chat code changed.
  // 257,139 B (+4 B, exactly the overage, 2026-11-22): forms submit on change (chat route, above).
  // 257,144 B (+5 B, exactly the overage, 2026-11-22): chunk hash renames from the filter bar fix; no chat code changed.
  // 257,741 B (+597 B, exactly the overage, 2026-11-22): app page icons (lib/PageGlyph) in the classic sidebar, which is in the boot chunk, plus chunk renames from the data table and inputs.
  // 257,910 B (+169 B, exactly the overage, 2026-11-26): navigate(pageId, { params }) query serialization in sdk/services.ts & shell/router.ts.
  // 258,339 B (+429 B, exactly the overage, 2026-11-26): sidebar page badge pill, layoutNav propagation, live badge/manifest refresh in ShellApp.
  { name: '/chat first screen JS (boot + chat route)', path: abs([...bootJs, ...chatRouteJs]), limit: '258339 B', gzip: true },
  // 23.4 kB after dropping the sources no build includes from the Tailwind scan.
  { name: 'index.css', path: abs(['assets/index.css']), limit: '26 kB', gzip: true },
  // The 145 kB budget was set with `gzip -9` (reference zlib), which gives
  // 144.8 kB for this chunk. size-limit compresses with Node's zlib (Chromium's
  // fork), which gives 146.6 kB for the same bytes: 147 kB was that budget.
  // +1 kB for the chat's collapsible code blocks (markdown/CodeBlock.tsx:
  // 12-line collapse, wrap toggle, sideways-scroll fade), 147.4 kB measured.
  // 100 kB (down from 148): the HTML parser (rehype-raw, parse5) is its own chunk,
  // loaded only for markdown with HTML (markdown/rehypeRawGate.ts), and the small
  // syntax-tree helpers moved to `markdown-kit`; 97.47 kB measured.
  { name: 'Streamdown renderer chunk', path: abs([manifest[chunks.streamdown].file]), limit: '100 kB', gzip: true },
  { name: 'shikiPlugin chunk', path: abs([manifest[chunks.shikiPlugin].file]), limit: '55 kB', gzip: true },
  { name: 'legacy App path (entry + legacy-app-entry closure)', path: abs(legacyJs), limit: '250 kB', gzip: true },
  // 7,566 B (+404 B, exactly the overage): the Check, ClipboardCopy and X icons Try it
  // imports were shared with the docs App before; the docs App now draws its own
  // (virtual:aiui-icons/inline), so they count here. They load with Try it instead of on
  // every docs page.
  // 7,568 B (+2 B, exactly the overage, 2026-11-26): chunk hash rename from doc viewer & sidebar badges; no Try it code changed.
  { name: 'docs Try it chunk (lazy, minus the legacy App path)', path: abs(tryItFiles), limit: '7568 B', gzip: true },
  // 127.8 kB measured + 10% (2026-11-22). Never on the boot path (npm run
  // check:closure fails if recharts reaches it).
  { name: 'chart block chunk (lazy, recharts; minus boot and the blocks page)', path: abs(chartFiles), limit: '140.6 kB', gzip: true },
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
  // 9,596,640 B (measured, raised by exactly the overage, +8,159 B): docs
  // videos and embeds, light/dark images, copy/download in the zoom view
  // (docs/DocsMedia.tsx, docs/embeds.ts, docs.css).
  // 9,597,840 B (measured, raised by exactly the overage, +1,200 B): docs
  // branding (logo per mode, strict mode, background decorations in docs.css).
  // 9,601,062 B (+3,222 B, exactly the overage): not-found redirects + suggestions chunk.
  // 9,611,961 B (+10,899 B, exactly the overage): the API Reference page chunk
  // (app-pages/api-reference).
  // 9,627,383 B (+15,422 B, exactly the overage): Try it on endpoint pages (the lazy
  // ApiPlayground chunk and its CSS, the endpoint bar in docs.css and ApiFields.tsx).
  // 9,632,798 B (+5,415 B, exactly the overage): changelog entries and their tag
  // filter (docs/DocsUpdate.tsx, docs.css).
  // 9,637,745 B (+4,947 B, exactly the overage): docs page feedback (the lazy
  // DocsFeedback chunk, PageFooter.tsx, docs.css).
  // 9,643,947 B (+6,202 B, exactly the overage): docs tabs that navigate, tab menus,
  // sidebar anchors and the dropdown switcher (docs/DivisionNav.tsx, the lazy NavMenu chunk).
  // 9,645,651 B (+1,704 B, exactly the overage): the docs MCP items in the page menu
  // (docs/PageActions.tsx, two lucide icons).
  // 9,648,980 B (+3,329 B, exactly the overage): the docs print stylesheet and the
  // Download as PDF page action.
  // 9,668,391 B (+19,411 B, exactly the overage): header link icons, the GitHub star
  // count, footer social marks (the lazy brandIcons chunk, 12.9 kB) and the banner.
  // 9,675,842 B (+7,451 B, exactly the overage): Try it authentication, file inputs and
  // streamed responses (the ApiPlayground chunk, playground.css, the endpoint bar's auth mode).
  // 9,678,344 B (+2,502 B, exactly the overage): related pages under docs pages (the lazy
  // RelatedPages chunk, its styles and the link helper in the legacy App chunk).
  // 9,682,765 B (+4,421 B, exactly the overage): page actions you choose (AI targets, links
  // of your own, per-page lists, the Ctrl+C copy) and the lazy listen-to-page chunk.
  // 9,697,885 B (+15,120 B, exactly the overage): Ask AI in the docs site (the lazy panel
  // chunk, its styles, the header button, selection chip and search row).
  // 11,121,923 B (+1,424,038 B, exactly the overage): docs code block themes (all 65
  // bundled themes, each a lazy chunk trimmed to what highlighting reads, 707,638 B) and
  // 46 more lazily loaded grammars with their embedded languages; about 250 kB in the
  // compressed wheel. No loaded chunk grows.
  // 11,123,573 B (+1,650 B, exactly the overage): docs versions (the switcher, version-scoped
  // sidebar, tabs and search in the legacy App chunk).
  // 11,128,025 B (+4,452 B, exactly the overage): docs content languages (switcher, language-scoped nav).
  // 11,132,290 B (+4,265 B, exactly the overage): site components in docs pages
  // (docs/CustomBlock.tsx, the lazy docs/customBlocks.ts and the SDK chunk split).
  // 11,132,753 B (+463 B, exactly the overage): phone fixes in the chat (an artifact table's
  // actions leave with it; a long app name wraps below the hero's mark).
  // 11,138,755 B (+6,002 B, exactly the overage): voice input (the lazy VoiceInput chunk
  // with its recorder rules, and the probe in the chat route).
  // 11,160,284 B (+21,529 B, exactly the overage): utility classes on docs pages (the
  // generated docs/utilities.css in the docs stylesheet, 281 classes; docs/docsClasses.ts).
  // 11,162,854 B (+2,570 B, exactly the overage): the reply's messages as blocks in the chat
  // route (above).
  // 11,164,096 B (+1,242 B, exactly the overage): docs pages that never stay on the skeleton
  // (docLoader body limit, error boundaries for lazy parts, boot-failure Reload).
  // 11,164,574 B (+478 B, exactly the overage): a stalled page download is retried after
  // 5 s without a byte (docLoader reads the body chunk by chunk).
  // 11,164,896 B (+322 B, exactly the overage): the manifests inlined in each built page
  // (docLoader inlinedManifest, App.tsx reads them before fetching).
  // 11,168,215 B (+3,319 B, exactly the overage): the split search index reader
  // (docs/searchShards.ts in the lazy search chunk) and CommandDialog's controlled `value`.
  // 11,168,707 B (+492 B, exactly the overage): the HTML parser as a lazy chunk of its own
  // (markdown/rehypeRawGate.ts, the needsRaw hint, the chunk's import/export glue). No
  // loaded chunk grows: the renderer chunk is 49.6 kB gzip smaller.
  // 11,173,363 B (+4,656 B, exactly the overage): the reply's steps (the lazy StepTree chunk
  // and the reducer in the chat route, above), on top of the parser split.
  // 11,175,114 B (+1,751 B, exactly the overage): the docs App's first-screen icons drawn
  // into its chunk (virtual:aiui-icons/inline) next to lucide-react's own for the shell.
  // 11,176,912 B (+1,798 B, exactly the overage): the docs loader's aiui:docs-load records
  // (docs/loadEvents.ts) and its retry notice.
  // 11,176,942 B (+30 B, exactly the overage): chunkReload reads the content-named entry (index-<hash>.js).
  // 11,178,629 B (+1,687 B, exactly the overage): the opt-in load telemetry chunk (docs/fieldTelemetry.ts).
  // 11,178,685 B (+56 B, exactly the overage): layout.groups.shown read by navGroups and buildLayoutNav.
  // 11,179,230 B (+545 B, exactly the overage): .html and wrong-case docs URLs (docs/navMatch.ts, stripHtmlSuffix).
  // 11,180,139 B (+909 B, exactly the overage): optional docs work after load (docs/afterLoad.ts) and the
  // network-change retry (docs/networkChange.ts).
  // 11,180,375 B (+236 B, exactly the overage): docs retries move to a fresh connection pool.
  // 11,181,896 B (+1,521 B, exactly the overage): hedged docs requests and the connection warm-up.
  // 11,573,449 B (+391,553 B, exactly the overage): the chart block and recharts (one lazy chunk plus
  // the d3 scale chunks it shares with mermaid), 2026-11-22.
  // 11,573,583 B (+134 B, exactly the overage): recharts measuring-span cleanup in the chart block.
  // 11,577,511 B (+3,928 B, exactly the overage): page params in the URL, auto refresh and the status block.
  // 11,579,911 B (+2,400 B, exactly the overage): lazy tab and expander bodies (blocks/pageBlocks.tsx LazySection).
  // 11,580,023 B (+112 B, exactly the overage, 2026-11-22): LazySection skips re-fetching closed sections until reopened.
  // 11,584,787 B (+4,764 B, exactly the overage, 2026-11-22): the sandboxed html block, Markdown callouts and metric captions (blocks chunk).
  // 11,598,491 B (+13,704 B, exactly the overage, 2026-11-22): native media, navigation and overlay blocks (blocks/mediaBlocks.tsx), card_grid, gallery links.
  // 11,608,392 B (+9,901 B, exactly the overage, 2026-11-22): the filter inputs' lazy chunks (blocks/inputs).
  // 11,608,459 B (+67 B, exactly the overage, 2026-11-22): filter bar keeps focus (remount only after a chip or Reset).
  // 11,641,429 B (+32,970 B, exactly the overage, 2026-11-22): data table v2 with row details and date/sparkline columns, multi-select/tags/date range/segmented inputs, heatmap/sparkline/small-multiple charts, app page icons.
  // 11,643,737 B (+2,308 B, exactly the overage, 2026-11-26): URL _params on action POSTs, filter_bar(method="get"), SPA page_link/params navigation.
  // 11,646,736 B (+2,999 B, exactly the overage, 2026-11-26): chart x_domain, log scales, histogram clamping, heatmap clip/tooltip, barh y2, free facets.
  // 11,648,443 B (+1,707 B, exactly the overage, 2026-11-26): table numeric threshold tones, lazy row detail drawer, gallery caption alongside title.
  // 11,652,890 B (+4,447 B, exactly the overage, 2026-11-26): remote combobox options_url, native color_picker_input & pagination blocks.
  // 11,658,218 B (+5,328 B, exactly the overage, 2026-11-26): BlockPage markdown doc viewer with TOC, sidebar page badges across all layouts, live badge/manifest refresh.
  { name: 'wheel: all of dist/assets (uncompressed)', path: allAssets, limit: '11658218 B', brotli: false },
]
