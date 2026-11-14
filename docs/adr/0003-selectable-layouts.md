# ADR 0003: Selectable layouts, a first-party plugin kind

- **Status:** Accepted (Nov 2026). The browser contract (F1) is frozen; the rest is **(planned)** and marked so below.
- **Date:** 2026-11-14
- **Extends:** [ADR 0002](0002-react-app-shell-and-plugin-sdk.md). It adds one registration kind, which R3 allows through an ADR. It supersedes nothing.
- **Scope:** `src/frontend/src/{sdk,shell,builtin,app-layouts,layout-features,chat-engine}`,
  `src/praisonaiui/{layouts.py,plugin_registry.py,builtin,schema,features}`
- **Related:** `ARCHITECTURE.md` (R1–R16, plus R17 below), `docs/features/plugins.md`, `docs/features/react-shell.md`

## Context

- The app shell (`style: app`) has one frame: the sidebar, header and page area in `shell/ReactShell.tsx`.
  The product needs several frames over the same pages: a workbench, a keyboard-first command deck,
  chat with a canvas, a guided mode for newcomers, and a mission-control overview.
- The frames differ in navigation, in who draws the session list, in how the chat thread and its
  approvals look, and in the side panels they show (artifacts, run inspector, KPIs). They do not differ
  in what a page is.
- Several names were already taken, so this ADR uses new ones:
  - `src/layouts/` belongs to the legacy React App, so new frames live in **`app-layouts/`**.
  - Manifest `layout` already holds sidebar and page settings (`layout.default` is the default page),
    so the new data is a top-level **`layouts`** key.
  - YAML `layout:` is the existing `LayoutConfig` (chat `mode`, `width`, `height`). It is extended
    additively, not replaced (R7).
  - `aiui.layout(...)` is the blocks helper, so the Python setter is **`aiui.set_layout()`**.
  - A page with the id `chat-canvas` already exists. Layout ids are a separate namespace.
- The standalone default (`dashboard`) must render byte-for-byte as before (R6).

## Decision

1. **A layout owns the frame; a page owns its content.** The frame is everything around the routed
   page: navigation, session list, top bar, side panels, status bar and phone chrome. Every manifest
   page renders inside every layout through the `Outlet` the shell passes in. The current frame becomes
   the core's own **classic frame** (`shell/ClassicFrame.tsx`, **(planned)**). It has no layout id, it
   is the fallback whenever no layout is selected, registered or able to load, and `classic` is the
   reserved id that selects it.
2. **Each built-in layout is three things** **(planned)**:
   - a Python `BuiltinPlugin` record `builtin.layout-<id>`, which `extensions.disabled` can switch off;
   - a tiny eager browser descriptor (`builtin/layouts/<id>.ts`, meta plus a loader);
   - a lazy frame chunk (`app-layouts/<id>/`).

   A third-party layout makes the same SDK call. Its Python plugin declares it with a new `layouts()`
   hook, and its ESM module is imported only while that layout is active.
3. **Isolation is a hard rule:** R17, below.
4. **Layout-specific backend data lives in separate feature modules** **(planned)**:
   `features/artifacts.py` and `features/run_ledger.py`, each with its own catalog record declaring
   `for_layouts=(...)`. Such a record mounts only when one of those layouts is available, or when it is
   named in `extensions.enabled`. Nothing goes in `server.py` (R11).
5. **Pages a layout owns are ordinary catalog pages** with `shell_only=True` and `layouts=(...)`
   **(planned)**. `shell_only` keeps them out of `/api/pages` and the dashboard (R6). The manifest
   carries `layouts` and `replaces` as data, so the core never compares page or layout ids (R1).
6. **Switching is live.** `setLayout` remounts the frame and the page without a reload. Chat state
   survives because the thread store is module state.

## Frozen contract (F1, shipped)

Additive under `SDK_VERSION = 1`. `SDK_EXPORTS` appends `registerLayout`, `getLayouts`, `useLayout`,
`setLayout`, `provideLayoutData` and `useLayoutData`. `SDK_FEATURES` appends `layouts`, `layout-data`
and `slots.dispose`. Types for plugin authors are in `sdk/aiui-sdk.d.ts`.

| Module | Holds |
|---|---|
| `sdk/layouts.ts` | registration, the active layout, storage keys, feeds |
| `sdk/layoutTypes.ts` | `Feed<S>` and the structural feed types; types only, no chat-engine import |
| `sdk/manifest.ts` | `ShellLayoutSpec`, `ShellLayouts`, `ShellManifest.layouts?`, `ShellPage.layouts?/replaces?/pageType?`, `LAYOUT_ID_PATTERN`, `CLASSIC_LAYOUT_ID` |
| `sdk/registry.ts` | `registerSlot` now returns a disposer; `toComponent` is the shared component-or-loader resolver |

**Registration.** `registerLayout(id, meta, C | () => import(...)): () => void`.
- An id matches `^[a-z][a-z0-9-]{0,39}$`, the same rule as the server. `classic` is reserved.
- A loader runs only when the shell first renders that layout, and it is retried after a failed
  chunk load.
- Registering an id again replaces it and logs a warning; the remover removes only its own
  registration.
- `meta` is `{ title, description?, preview?, chat?: ChatPresentation, approvals?: 'toast' | 'frame' }`.
  A missing title or a region that is not a loader throws. An unknown enum value (from a newer SDK) is
  dropped with a warning, so the default applies.
- `ChatPresentation`:
  - `sessions`: `page` (default), `frame`, `tabs` or `none`;
  - `thread`: `bubbles`, `quiet`, `steps` or `dense`;
  - `approvals`: `inline`, `card` or `keyboard`;
  - the lazy regions `aside`, `turnHeader`, `turnFooter` and `empty` (a `RegionLoader` each), plus `asideLabel`.

**What a frame receives.** A frame receives `LayoutProps`:
- `Outlet`: the page, with its error boundary, page toolbar slot and Suspense;
- `pageId`, `page`, `fullBleed`, `viewport` (`phone` below 768 px, `tablet` below 1024 px, else `desktop`);
- `nav: LayoutNav`: `primary` (at most 7), `groups` (the rest), `footer`, `activeId`, `go`;
- `chrome: LayoutChrome`: site title and logo, `openPalette({query})` for the one cmdk palette,
  `toggleColorMode`, the shell's `Slot` host, and `mainId` for the skip link;
- `layout: { id, available, switchTo }`.

**Which layout is on.**
- `useLayout()` returns `{ id, meta }`, or null for the classic frame. It is also null while the
  active layout is not registered yet.
- `setLayout(id, { persist = true })` writes `localStorage['aiui-layout']` and clears the tab's
  preview. With `persist: false` it writes `sessionStorage['aiui-layout-preview']` instead. `''` and
  `classic` both mean the classic frame. It then calls the layout host.
- The shell installs that host with `provideLayoutHost` (not an SDK export). The host re-runs the
  selection and reports the result with `activateLayout`.
- Storage that throws is ignored; the switch still happens.

**Feeds.** These carry the data a frame shows.
- `provideLayoutData(kind, feed | () => Promise<feed>): () => void`. A function is always a loader. It
  runs the first time a frame reads the kind, and only once.
- `useLayoutData(kind)` returns the feed, or null while nothing provides it or it is loading. A frame
  must render without the feed: it hides the panel or shows an empty state, and never crashes.
- If a loader fails, the failure is logged once and the feed stays null. Calling
  `provideLayoutData` again retries.
- The core kinds are `sessions`, `chat`, `approvals`, `runs` and `artifacts`. `LayoutDataMap` is open
  for declaration merging, so a plugin can add a kind of its own.

**Manifest.**
- `layouts?: { default, userChoice, available: ShellLayoutSpec[] }`. A `ShellLayoutSpec` has `id`,
  `title`, `description`, `order`, `source`, `module`, `css`, `integrity`, `home`, `primary` and `options`.
- If the key is absent (an older server), the shell uses the classic frame. `normalizeManifest`
  then leaves the key out.
- When `normalizeManifest` reads the key, it drops invalid and repeated ids, and it maps a `default`
  that is not a layout id (or is `classic`) to `''`.
- Ill-typed page `layouts`, `replaces` and `pageType` fields are dropped.

## R17: layout isolation (new rule)

1. **One folder and one chunk per unit.**
   - Every layout is `app-layouts/<id>/**`, emitted as the Vite chunk `layout-<id>`.
   - Every layout-specific feature is `layout-features/<name>/**`, emitted as `lf-<name>`.
   - Shared pieces live in `app-layouts/kit/**` (chunk `layout-kit`). They are never copied.
2. **Imports.**
   - A layout never imports another layout, or `@/shell/**`.
   - A layout reaches `layout-features/*` only through `import()`: a `RegionLoader` or a lazy child.
   - `layout-features` never import `app-layouts/<id>`.
   - Frames and the kit import only `@/sdk/*`, `@/components/ui/*`, `@/lib/*`, `@/app-layouts/kit`
     and the light chat-engine modules (`store`, `api`, `protocol`, `sessionList`, `feeds`).
   - They never import `Thread`, `ChatPage`, `useAiuiRuntime` or `@assistant-ui`.
3. **The core never names a layout.** `shell/`, `sdk/`, `legacy/` and `blocks/` contain no layout id
   literal and import neither folder. The F1 SDK holds to this already, and `shell/core-purity.test.ts`
   extends to it **(planned, F3)**.
4. **An inactive layout's code is never downloaded.** A static gate
   (`scripts/check-layout-isolation.mjs`) and a network e2e enforce this **(planned, F3)**.
5. **Data features gate on layouts.** A record with `for_layouts` mounts only when a listed layout is
   available, or when it is explicitly enabled **(planned, F2)**.

*Check:* `app-layouts/isolation.test.ts`, `shell/core-purity.test.ts`, `check-layout-isolation.mjs`,
`e2e/specs/layouts-isolation.spec.ts`, and `tests/unit/test_layout_gating.py` **(planned)**.

## Configuration surface (planned, F2 and F3)

- **YAML.** `LayoutConfig` gains `default`, `available`, `user_choice` (alias `userChoice`, default
  true), `primary` and `options` (keyed by layout id). `mode`, `width` and `height` are unchanged. A
  bare string is shorthand: `layout: command` means `{default: command}`.
  ```yaml
  style: app
  layout: {default: command, available: [command, chat-canvas, workbench], user_choice: true}
  ```
- **Python.** `aiui.set_layout(default=None, *, available=None, user_choice=None, primary=None, options=None)`
  lives in `praisonaiui/layouts.py`, which is exported lazily (the 200 ms import budget holds) and
  reset by `PluginRegistry.reset()`.
- **Environment.** `AIUI_LAYOUT=<id>|classic`.
- **Server precedence:** `AIUI_LAYOUT` > `set_layout()` > YAML `layout` > the style default. This
  matches `AIUI_SHELL`.
- **Browser precedence:** a `?layout=` preview (copied into sessionStorage, so navigation keeps it)
  > the stored user choice (only when `userChoice`) > the server default > classic.
- **Validation.**
  - An unknown id after plugin discovery logs one warning and falls back to the first available layout.
  - `aiui validate` warns with code 5101 on an unknown built-in id.
  - A layout set while the style is not `app` warns once ("layout ignored: style is 'dashboard'").
    The style is never flipped implicitly.
- **Per-viewer override.** Settings → Appearance offers a select of the available layouts plus
  Classic, and the palette gets "Switch layout: …" commands. v1 keeps the choice per browser;
  cross-device sync waits for user profiles.

## Defaults

- **The standalone default stays `dashboard`.** Its output is unchanged (R6):
  - `golden_dashboard_html.txt` and `builtin_pages_snapshot.json` do not change;
  - layout pages are `shell_only`;
  - the `layouts` key appears only in the shell manifest.
- **The `style: app` default is `chat-canvas`** (owner decision, **planned**). Apps that already opt in
  to `style: app` get the chat-canvas frame and a changelog entry; `layout: classic` restores today's
  frame. `AIUI_SHELL=legacy` remains the kill switch, and a layout is then ignored with a warning.
- **The classic frame** is the fallback whenever:
  - the manifest has no `layouts`;
  - the chosen id is not available;
  - the layout is not registered once plugins have settled (with a console warning);
  - the frame throws, which also raises one toast and fires `aiui:plugin-error` (R4).

## Budgets (gzip, planned in `.size-limit.mjs`)

| Budget | Cap |
|---|---|
| Shell boot (host, registry and five descriptors add at most 4 kB) | 150 kB, unchanged |
| Each `layout-<id>` closure minus boot | 24 kB (mission: 28 kB) |
| `layout-kit` | 10 kB |
| `lf-artifacts` / `lf-run-inspector` / `lf-command-bar` / `lf-step-tracker` / `lf-mission-board` | 30 / 14 / 6 / 6 / 22 kB |
| `/chat` first screen with the default layout | 270 kB |
| `/chat` first screen with the classic frame | 250 kB, unchanged |

## Compatibility

- **Everything is additive.**
  - Six exports and three features are appended.
  - `registerSlot`'s return type was `void`, and it is now a disposer.
  - Every manifest key is optional.
  - YAML `layout:` keeps its fields.
- **A plugin that must run on an older shell** checks `SDK_FEATURES?.includes('layouts')` before it
  calls `registerLayout`.
- **Older servers** send no `layouts` key and get the classic frame. A server whose layout plugin
  fails to register also falls back to classic.

## Rejected alternatives

- **One configurable frame with switches.** Every frame's code would land in the boot chunk, and each
  new frame would need core changes. That breaks R1 and R10.
- **Layouts as pages.** A page cannot own the navigation around itself, and pages would have to know
  about each other.
- **A second registry or a per-kind list in the shell.** This would break R3. Layouts use the SDK
  registry pattern, and the manifest already carries records.
- **A server-side per-user preference store now.** No user profile store exists yet. Browser storage
  ships now; sync comes with auth profiles.

## Consequences

- Frames ship and fail alone. A broken layout costs one toast and drops to the classic frame, not
  the app.
- The chat page reads one presentation object instead of growing one branch per layout.
- The data a frame shows (sessions, approvals, runs, artifacts) becomes a feed contract that tests
  and plugins can stub.
- Contract churn is the main risk. F1 is frozen once merged, and changes after that are append-only.

## Delivery

Wave 0 is F1 (this contract) plus this ADR. Wave 1 is F2 (Python config and records), F3 (shell host,
classic frame, gates), F4 (Pro tokens), C (chat presentation and feeds) and D (artifacts and run ledger
APIs). Wave 2 is the five layouts, artifacts, page templates and the praisonai-package default. The
full track plan is in `.claude/ui-reset/reports/layouts-plan.md`.
