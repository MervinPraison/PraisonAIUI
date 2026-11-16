# Playwright suites

```bash
cd src/frontend
npm ci
npx playwright install chromium     # once; CI adds --with-deps
npm run build                       # the suites serve dist/, never the committed bundle
npm run test:e2e                    # all projects, about 3 minutes
```

Every project starts its own real server through `fixtures/start-server.mjs`:
the Python package from this checkout, a scripted provider
(`fixtures/mock_server.py`) instead of an LLM, and a fresh temp directory for
`AIUI_DATA_DIR` and `HOME`. Provider keys (`*_API_KEY`, `*_TOKEN`) are
removed from the environment and entry-point plugins are not autoloaded.
`dist/` is copied to the temp directory and served with
`AIUI_TEMPLATES_DIR`, so the tracked `src/praisonaiui/templates/frontend` is
never read or written.

| Project | Server | Specs |
|---|---|---|
| `dashboard-legacy` | default style (vanilla dashboard) | `legacy-parity`, `legacy-dashboard` |
| `app-shell` | `AIUI_SHELL=app` + the example plugin, `AIUI_LAYOUT=classic` (the classic frame) | `shell-sweep`, `chat`, `plugins` |
| `chat-style` | `style: chat`, presets `zinc` and `rose`, and one with no `set_theme()` (three servers) | `theme-presets`, `chat-os-theme` |
| `docs` | `aiui build` of `fixtures/docs-site`, served by `aiui serve` | `markdown` |
| `page-reload-dashboard`, `page-reload-app` | the `dashboard-legacy` and `app-shell` servers | `page-reload` |
| `layouts-host` | `AIUI_SHELL=app` + the third-party layout plugin (`fixtures/layout-plugin/serve.py`) | `layouts-host`, `layout-<id>` |
| `page-types` | the same server, its own instance (the layout suites' chats stay out of its baselines) | `page-types`, `knowledge-page` |
| `app-pages` | the same server, its own instance (the agents it creates stay out of other suites) | `agents-page` |
| `legacy-baseline` | the v0.3.153 tree (only with `AIUI_E2E_BASELINE_SRC`) | `legacy-parity` |

## What each suite checks

- **shell-sweep**: every page id in `GET /api/shell/manifest` opens from the
  sidebar and reaches *ready* with no uncaught error. Each page is visited
  twice from a neutral page with a leak probe (`specs/leak-probe.ts`)
  counting open WebSockets, EventSources, `setInterval` timers, `window`
  listeners and `<body>` children. A page may not leave a connection open,
  and nothing may grow on the second visit. Also: every page opens from its
  own URL, six key pages fit light / dark / 390 px without sideways scroll,
  the ⌘K palette, and approval toasts.
- **chat**: WebSocket and SSE (the socket is blocked to force the fallback):
  streaming, markdown, reasoning, a tool card, an image element, references,
  reload restores the thread, Stop, approvals (success and failure), ask, and
  chat markdown safety (external link `rel`, remote images not fetched).
- **markdown**: the docs site in light, dark and at 390 px: Shiki dual-theme
  tokens, a table, KaTeX, a Mermaid diagram, an admonition, no horizontal
  page scroll, `index.js?v=` / `index.css?v=` cache-busting, and the entry
  loaded once across client-side navigation.
- **legacy-parity**: the default dashboard against screenshots of v0.3.153
  (`/overview`, `/chat`, `/logs`, `/usage`, `/agents`, `/approvals`, `/jobs`,
  dark and light, 1280×800, at most 0.5% differing pixels; the log stream and
  the usage chart's time axis are masked), plus the overscroll background check.
- **legacy-dashboard**: the default dashboard's chat renders a markdown table
  as a `<table>` and keeps reasoning and the tool step above a streaming
  answer; with no app or viewer choice (`site.themeDefault: system`) it
  follows the OS scheme, an app that asks for dark (`set_theme()`) never shows
  a light frame on a light OS, a light pick on the Theme page survives a
  reload, and light mode reaches the log panel and form fields.
- **theme-presets**: `zinc` vs `rose` paint different `--primary` colours,
  and primary, body and muted text reach 4.5:1 in light and dark.
- **chat-os-theme**: the chat style of an app that sets no theme renders
  light on a light OS and dark on a dark one, and follows the OS when it
  changes; a stored viewer choice and an app mode (`set_theme()`) win over
  the OS.
- **layouts-host**: the layout host (ADR 0003): the default layout downloads
  only its own chunks and the kit (network isolation for each built-in
  layout), `?layout=classic` previews the classic frame, the plugin layout is
  in the palette and Settings → Appearance and loads only when picked,
  switching leaks no socket, timer or listener, a frame that throws falls back
  to the classic frame, and the phone menu sheet.
- **agents-page**: the React Agents page under the default layout: the empty
  state with one New agent action, create, detail, edit, delete with a
  confirmation, the loading skeleton and the error state with Try again, and
  the phone drill-in at 390 px.
- **plugins**: the example plugin's React page, blocks page, block type, tool
  renderer and the error toast when its module fails to load.
- **page-reload**: in the default dashboard and in the app shell, opening and
  reloading `/sessions` and `/agents` (JSON APIs as well as page URLs) shows
  the page, not the API body, while the view's own `fetch` still gets JSON.

Known product defects are listed in the specs (`KNOWN_LEAKS`,
`KNOWN_BROKEN_DEEP_LINKS` in `shell-sweep.spec.ts`). Each entry is strict: the
suite fails once the defect is fixed, so the entry has to be removed.

## Legacy-parity baselines

Screenshots differ between operating systems (fonts, anti-aliasing), so
baselines live per platform in `__baseline__/<platform>/`. Only `darwin`
baselines are committed so far. On a platform without baselines the
screenshot tests are **skipped** and the DOM checks still run; this is why
the screenshot comparison is not enforced in CI (Linux) yet.

The committed `darwin` baselines are snapshots of the current build
(`--update-snapshots`), not of v0.3.153, for two intended changes:

- the sidebar shows the PraisonAI glyph instead of the lobster logo (#404);
- light mode reaches the log panel and the usage cards (`logs-light`,
  `usage-light`); v0.3.153 painted them with their dark literals on a light
  page, which was the bug.

Re-capturing from v0.3.153 would bring both defects back. Apart from these
two changes the shots match v0.3.153. A new platform's baselines start from
the release (below); then re-capture them from the current build with
`--update-snapshots` and check that only the logo and those two light shots
changed:

```bash
git worktree add /tmp/aiui-v0.3.153 6bdf6f0          # Release v0.3.153
AIUI_E2E_BASELINE_SRC=/tmp/aiui-v0.3.153 npm run test:e2e:baseline
git worktree remove /tmp/aiui-v0.3.153
```

To enforce the comparison in CI, run the same commands inside the CI image
(`mcr.microsoft.com/playwright:v1.65.0-jammy`) and commit
`__baseline__/linux/`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AIUI_E2E_PORT` | `8720` | first of ten consecutive ports |
| `AIUI_E2E_PYTHON` | `python3`, then `python` | interpreter (≥ 3.10) with the package's dependencies |
| `AIUI_E2E_REUSE` | unset | `1` reuses servers already listening on the ports |
| `AIUI_E2E_BASELINE_SRC` | unset | a v0.3.153 checkout; enables `legacy-baseline` |
| `AIUI_E2E_SWEEP_PAGES` | all | comma-separated page ids, to debug the sweep |
| `AIUI_E2E_KEEP_HOME` | unset | `1` keeps the real `HOME` (for `pip install --user` setups) |

Reports go to `e2e/.report` (HTML) and `e2e/.results` (traces of failures);
both are ignored by git. `npx playwright show-report e2e/.report` opens the
report, which also carries the key-page screenshots for review.

## In CI: parallel shards

With `CI` set, the config distributes single tests (not whole files) across
shards (`fullyParallel`; each job still runs one worker, so the tests of a job
never overlap) and writes a blob report to `e2e/.blob/`. The CI e2e job runs
four shards in parallel, and a final job merges their reports:

```bash
CI=1 npx playwright test -c e2e/playwright.config.ts --shard=1/4   # one job per shard
npx playwright merge-reports --reporter html ./all-blob-reports      # after all shards
```

Every shard starts the same servers, so any shard can run any test. Run the
same command with the same `--shard` to reproduce one CI shard locally.
Screenshot comparisons stay platform-aware: without `__baseline__/linux/`
they are skipped on the Linux runners and the DOM checks still run.
