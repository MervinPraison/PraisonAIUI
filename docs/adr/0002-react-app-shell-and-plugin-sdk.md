# ADR 0002: One React app shell and a plugin SDK, migrated from the vanilla dashboard by strangler

- **Status:** Accepted (Nov 2026)
- **Date:** 2026-11-12 (decision), shipped in v0.3.154 / v0.3.155
- **Base:** v0.3.153
- **Scope:** `src/frontend/src/{main.tsx,shell,legacy,chat-engine,markdown,sdk,blocks,builtin,styles}`,
  `src/praisonaiui/{server.py,plugin_registry.py,builtin,themes.py}`, `features/chat.py`
- **Related:** `ARCHITECTURE.md` (code map), `docs/features/react-shell.md`, `docs/features/plugins.md`,
  `docs/reports/ui-reset-2026-11.md` (project record)

## Context

- The default style was the vanilla-JS `dashboard`: about 26k lines in
  `templates/frontend/plugins` (`dashboard.js` alone 3,560 lines, plus 41 `views/*.js`). For
  this style the React app rendered nothing and the server skipped the React script.
- The React styles (chat, agents, playground, docs, custom) shipped one monolithic entry of
  437 KB gzip, over the 250 KB first-screen budget, mostly from eagerly loaded
  react-markdown, react-syntax-highlighter and mermaid.
- Theming was split three ways: React `hsl(var(--x))` triples, dashboard `--db-*` hex
  tables, and about twelve feature plugins with hard-coded dark hex.
- Vite emitted unhashed chunk names, and CI never checked that the committed bundle
  matched a fresh build.
- Five spikes (all "works with caveats") de-risked the plan:
  1. **chat-runtime**: assistant-ui ExternalStoreRuntime runs over our SSE and WS protocol unchanged.
  2. **markdown**: Streamdown replaces react-markdown, the highlighter and mermaid code; entry 437 KB → 166 KB gzip.
  3. **legacy-host**: a React shell mounted 41 of 41 legacy pages with 0 page errors; first screen ~130 KB gzip.
  4. **design-system**: radix-ui migration plus a seed / color-mix `theme.css`.
  5. **python-plugins**: entry-point registry, shell manifest and import-map externals.

## Decision

1. **One React shell**, selected by a new style `app`. Opt-in: `style: app`,
   `set_style("app")`, or `AIUI_SHELL=app` (alias `react`). `AIUI_SHELL=legacy` maps `app`
   back to `dashboard` and is the kill switch after the flip. The `dashboard` style stays
   byte-for-byte the same and stays the default.
2. **One Vite build.** The entry stays `assets/index.js` (cache-busted with `?v=`); chunks
   become `assets/[name]-[hash].js` (also needed because Shiki's `markdown.js` and our
   `Markdown.js` collide on case-insensitive filesystems). `main.tsx` is ~1 KB: with
   `<html data-aiui-shell="react">` it lazy-imports `shell/mount`, otherwise
   `legacy-app-entry` (the previous App, unchanged).
3. **Strangler host.** The shell owns `#root`, sidebar, header and routing. Page resolution:
   1. SDK registry (ported React pages and plugin pages)
   2. `kind=blocks`, rendered by BlockPage
   3. `LegacyViewHost`, which calls `dashboard.js` `mountView()` (imported as a runtime only;
      `buildDashboard()` never runs)

   Nothing users have today disappears.
4. **Chat.** `@assistant-ui/react` ExternalStoreRuntime behind `useAiuiRuntime` (the only
   file that touches the assistant-ui runtime API). Thread built from assistant-ui primitives
   in the AI Elements visual idiom. WebSocket `/api/chat/ws` is canonical; SSE `/run` is the
   fallback.
5. **Markdown.** One `<Markdown variant="chat"|"docs">` on Streamdown, always behind
   `React.lazy`, with a curated Shiki plugin (shiki/core, JS regex engine, 28 languages),
   lazy Mermaid and KaTeX. MkDocs admonitions and tabs are preprocessed into `<aiui-*>` tags
   allowed by an extended rehype-sanitize schema. `rehype-sanitize` stays in every rehype
   list; never use `allowedTags` (it corrupts code blocks).
6. **Tokens.** One `styles/theme.css`: seeds → color-mix tiers → shadcn vars as full colours
   (`var(--x)`, not `hsl(var(--x))`). The `--db-*` bridge lives in `legacy/bridge.css`,
   scoped to `html[data-aiui-shell='react']`. Python emits seeds only
   (`themes.get_seed_theme_css`).
7. **Plugins.** Python entry-point group `praisonaiui.plugins` (`plugin_registry.py`,
   `SDK_API_VERSION = 1`), YAML `extensions:`, `GET /api/shell/manifest`. Browser
   `window.__AIUI_SDK__` with React shared through an import map to `/_aiui/externals/*.js`.
   A thin block registry renders `{type, props, children}` for `kind=blocks` pages.
8. **Design system.** `shadcn migrate radix` (unified `radix-ui`), adding only the components
   used. No `shadcn add -o` refresh. `next-themes` with `storageKey="aiui-theme-preference"`,
   matching the server's theme bootstrap. Rules live in `src/frontend/DESIGN.md`.

### Resolved product questions

| Question | Decision |
|---|---|
| Links in chat markdown | Real `<a>`; external links get `target=_blank rel="noopener noreferrer nofollow"` |
| Images in chat markdown | Auto-load only same-origin, `data:image/`, `blob:`; others are click-to-load placeholders showing the host (exfiltration guard) |
| Shiki languages | Curated 28; others render as plain code |
| Docs path preloading Streamdown over budget | Accepted, documented exception |
| Legacy hex token pass | New `--db-p-*` namespace with the original hex as fallback, so the dashboard is pixel-identical |
| Transport | WS canonical; on SSE the ask UI disables input and says a live connection is needed |
| Plugin JS surfaces | Default-deny when auth is required or the host is not loopback |
| Unused markdown deps | Removed once no imports remain |
| `dashboard.shell` alias | Not added; only `style: app` and `AIUI_SHELL` |

## Frozen contracts

These were frozen before parallel work started. Changing them is a breaking change for
plugins and needs a new ADR or an SDK version bump.

### Shell manifest (`sdk/manifest.ts`, mirrors the server's `_build_shell_manifest()`)

```ts
interface ShellPage { id: string; title: string;
  kind: 'native' | 'react' | 'blocks' | 'legacy' | 'iframe';
  icon?; group?; order?; description?; apiEndpoint?; actionEndpoint?;
  module?; css?; integrity?; layout?; source? }
interface ShellManifest { sdk: number; version: string; style: string; site;
  layout: { sidebar?; pageHeader? }; pages: ShellPage[];
  blocks: {type, module, integrity?, source}[];
  toolRenderers: {toolName, module, integrity?, source}[];
  plugins: {name, version?, status: 'ok'|'error'|'disabled'|'incompatible', error?}[];
  legacy: { customJs: string | null; viewsBase: string } }
readBootManifest()   // inline #aiui-boot JSON
fetchManifest()      // GET /api/shell/manifest
```

### Registry (`sdk/registry.ts`)

`registerPage(id, component | lazy)`, `registerBlock(type, component)`,
`registerToolRenderer(toolName, component)`, `registerSlot(slot, component)`, the matching
getters, `subscribe(fn)` and `useRegistryVersion()`. The exported name list is
`SDK_EXPORTS`; `/_aiui/externals/sdk.js` must export exactly these names. Shell services
(`navigate`, `notify`, `fetchJson`, `useManifest`, `registerCommand`, `onActivate`) were added
additively later.

### Module entry points

| Module | Export |
|---|---|
| `legacy/runtime.ts` | `ensureLegacyRuntime()`, `preloadLegacyRuntime()`, `setLegacyNavigator(fn)` |
| `legacy/LegacyViewHost.tsx` | `LegacyViewHost({ pageId, page? })` |
| `markdown/LazyMarkdown.tsx` | `Markdown({ children, variant?, streaming?, className?, components? })`, `preloadMarkdown` |
| `chat-engine/ChatPage.tsx` | default `ChatPage({ page })` |
| `shell/mount.tsx` | `mountShell(el)` |
| `sdk/install.ts` | `installSdk()`, `loadManifestPlugins(manifest)` |
| `blocks/BlockPage.tsx` | default `BlockPage({ page })` |

### Chat hook and transport

```ts
useAiuiRuntime({ sessionId, onSessionCreated?, transport?, agentName?, starters?, historyUrl?,
  sessions?, onSelectSession?, onRenameSession?, onDeleteSession? })
  => { runtime, thread, sessionId, transport }
interface AiuiTransport { kind: 'sse' | 'ws';
  send({ sessionId, text, agentName?, attachmentIds?, signal, onEvent }): Promise<void>;
  cancel(sid, runId?): Promise<void>; respondAsk(sid, runId, text): Promise<void>; status? }
```

Wire events map to assistant-ui parts in the chat-engine reducer (text, reasoning,
tool-call upsert by `tool_call_id`, `data-element`, `data-a2ui`, `data-references`,
`data-memory`, approvals and ask as tool-calls with an approval, finalize / error /
cancelled status). `message_element` becomes `data-element`, never `image`, because
assistant-ui drops non-https/blob/data image URLs. Cancel aborts locally, then calls
`transport.cancel` (SSE `POST /cancel`, WS `chat_abort{run_id}`).

### Window and server contracts

- `window.__AIUI_BUILD__` carries the cache-bust string; the legacy runtime uses it for view
  imports instead of `Date.now()`.
- `dashboard.js` exports `initHostRuntime({ navigate, palette: false, approvalUi: 'event-only' })`
  and `mountView`. `selectPage` delegates to the host navigator only when one is set.
- Window events are unchanged (`aiui:page-change`, `aiui:session-select`,
  `aiui:prefill-composer`, `aiui:approval-required`); new: `aiui:view-registered`,
  `aiui:locationchange`.

### Python plugin contract

```toml
[project.entry-points."praisonaiui.plugins"]
name = "pkg:plugin"        # instance, class or zero-arg factory
```

`AiuiPlugin`: `name`, `version?`, `sdk = 1`, and optional `pages()`, `blocks()`,
`tool_renderers()`, `routes()` (mounted at `/api/plugins/<name>`), `static_dir()` (served at
`/_plugins/<name>/` with sha384 SRI), `features()`, `cli_commands()`, `setup(ctx)`.
YAML `extensions: {enabled: [...], disabled: [...]}` (a bare list means enabled; disabled
wins and is never imported). `AIUI_DISABLE_PLUGIN_AUTOLOAD=1` skips the group. SDK major
mismatch gives status `incompatible`. Merge precedence: app `register_page`, built-in,
entry-point plugin, dashboard-plugin folder; a shadowed page logs a warning.

**Trust model:** `pip install` means trust. Plugins run in-process and their JS runs
same-origin, unsandboxed. The `iframe` kind is the sandboxed option.

### Theme layers

| Layer | Contents |
|---|---|
| L0 seeds | `--seed-accent`, `--seed-tint`, `--tint-mix`, `--accent-mix`, mode seeds (ink, paper, sunken, raised), semantic colours, `--radius`, `--density`, `--font-size-base` |
| L1 tiers | `--ui-bg-*`, `--ui-fill-1..4`, `--ui-stroke-1..4`, `--ui-text-1..4`, all `color-mix(in oklab, ...)` |
| L2 shadcn vars | Full colours, plus automatic-contrast `--primary-foreground` under `@supports` |
| L3 legacy bridge | `legacy/bridge.css`, 28 `--db-*` aliases mapped onto L2, only under the app shell |

Neutral presets set `--accent-mix: 0%`; colour presets seed from `PRESET_COLORS`.
`get_theme_css` is kept for API back-compat.

## Compatibility

| Existing API | `dashboard` (default) | `app` (opt-in) |
|---|---|---|
| `register_page` with handler / `@aiui.page` | unchanged | `kind=blocks` → BlockPage |
| `register_page` without handler | unchanged | `kind=legacy` → custom.js `registerView` via LegacyViewHost |
| `register_page_action` | unchanged | `actionEndpoint` in the manifest |
| `set_pages`, config `pages.enabled/disabled` | unchanged | applied to the manifest |
| `set_custom_js` / `set_custom_css` | unchanged | still injected; HSL triples in custom CSS warn |
| `set_theme`, `set_brand_color`, `register_theme` | unchanged | converted to seeds |
| dashboard-plugins (kanban, sample-board, video-studio) | unchanged | legacy kind via the runtime |
| docs / chat / agents / playground / custom styles | same App, lazy-loaded, Streamdown, new tokens | n/a |

**Breaking:** an HSL triple such as `--primary: 221 83% 53%` in user CSS is no longer a
valid shadcn variable value (noted in the changelog).

## Quality gates

- `npx tsc -b && npm test && npm run build`, eslint on the new frontend directories.
- `npm run size` (gzip) budgets: shell boot ≤ 150 KB, chat route ≤ 140 KB, `/chat` first
  screen ≤ 250 KB, Streamdown ≤ 145 KB, shikiPlugin ≤ 55 KB, legacy App path ≤ 250 KB,
  `index.css` ≤ 32 KB.
- `check-entry-closure`: streamdown, shiki, mermaid, katex and `@assistant-ui` must not be in
  the static closure of `index.js` or the shell mount chunk.
- `check-bundle-sync`: rebuild and diff against `templates/frontend/`; runs on PRs that touch
  `src/frontend/**`.
- Playwright: app-shell page sweep with leak deltas, chat over SSE and WS against a mock
  provider, markdown in light/dark/390px, legacy dashboard parity against v0.3.153
  (screenshot comparison non-blocking until Linux baselines exist).
- `ruff check` and `pytest tests/unit tests/integration`.

## Rollout and flip criteria

| Phase | Content | Status |
|---|---|---|
| P0 | `app` opt-in: React chat, legacy host for every other page, tokens, Streamdown, plugin registry, SDK, gates | Shipped (0.3.154 / 0.3.155) |
| P1 | Chat parity backlog, light-mode review, native ports (overview, usage, logs, sessions, agents, config, memory, knowledge, skills), split `dashboard.js` | Planned |
| P2 | Flip: default `_style or "app"`; `AIUI_SHELL=legacy` is the kill switch | Planned |
| P3 | Delete dashboard-shell code; Config v2; Astryx at 1.0 | Planned |

**Make `style: app` the default only when all of these hold:**

1. Every `/api/pages` id renders in the app shell with status ready, 0 page errors and 0 leak
   delta (WebSockets, EventSources, intervals, window listeners, body children) in the
   Playwright sweep.
2. Chat parity is complete. Still required: message queue, channel messages with unread
   dots, context ring and compaction banner, cost chip, memory panel, floating and focus
   modes.
3. Light mode is correct on every page, and the owner signs off the light and dark
   snapshot set.
4. All gates are green: size budgets, bundle-sync, entry-closure, snapshots, pytest, tsc.
5. `set_custom_js`, custom.js `registerView` and the three bundled dashboard-plugins work
   under `app`.
6. One minor release has shipped with `app` opt-in, plus two weeks with no open P1 from
   opt-in users.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Separate `/_shell` Vite build | Two bundles, two Reacts, harder sync; one build with hashed chunks gives the same caching |
| `@streamdown/code` | Statically imports all of Shiki (440 files, 15.2 MB, wasm) |
| `@assistant-ui/react-streamdown` | Redundant with our Markdown; type mismatch |
| Vendoring the AI Elements registry | Needs shims and patches, fights the Thread viewport over scroll, ~360 KB gzip; deferred |
| `shadcn add -o` full refresh | Major bumps (recharts 3, react-day-picker 10) and snapshot churn |
| `cn` package | +12 KB gzip next to tailwind-merge |
| Stubbing rehype-raw globally | Docs admonitions and tabs need raw HTML |
| `use-stick-to-bottom` in the Thread | Two scroll owners would fight |
| Legacy views in iframes | Loses the shared runtime, events and auth fetch |
| Big-bang React port of 26k lines | Strangler instead |
| Flipping the default in P0 | Flip criteria not met |
| Astryx now | Deferred to its 1.0 |

## Consequences

- Users see no change unless they opt in; `dashboard` output is byte-identical (golden
  HTML test).
- New pages and plugins target one SDK and one manifest; built-in pages and features are
  first-party plugin records in `praisonaiui/builtin` and can be disabled through
  `extensions.disabled`.
- Two UIs coexist until P3, so `dashboard.js` changes must keep both the standalone
  dashboard and `mountView` working.
- Hashed chunks plus a committed bundle mean every frontend change must be rebuilt and
  synced; CI's bundle-sync check enforces it.
- Bundle headroom is thin (markdown chunk and chat route near their budgets); new
  dependencies in those paths need a budget review.
- Known modularity debt (shell page knowledge, `server.py` size, registration paths) is
  tracked in `docs/reports/ui-reset-2026-11.md`.
