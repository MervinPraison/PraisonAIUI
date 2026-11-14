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
| `dashboard-legacy` | default style (vanilla dashboard) | `legacy-parity` |
| `app-shell` | `AIUI_SHELL=app` + the example plugin | `shell-sweep`, `chat`, `plugins` |
| `chat-style` | `style: chat`, presets `zinc` and `rose` (two servers) | `theme-presets` |
| `docs` | `aiui build` of `fixtures/docs-site`, served by `aiui serve` | `markdown` |
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
- **theme-presets**: `zinc` vs `rose` paint different `--primary` colours,
  and primary, body and muted text reach 4.5:1 in light and dark.
- **plugins**: the example plugin's React page, blocks page, block type, tool
  renderer and the error toast when its module fails to load.

Known product defects are listed in the specs (`KNOWN_LEAKS`,
`KNOWN_BROKEN_DEEP_LINKS` in `shell-sweep.spec.ts`). Each entry is strict: the
suite fails once the defect is fixed, so the entry has to be removed.

## Legacy-parity baselines

Screenshots differ between operating systems (fonts, anti-aliasing), so
baselines live per platform in `__baseline__/<platform>/`. Only `darwin`
baselines are committed so far. On a platform without baselines the
screenshot tests are **skipped** and the DOM checks still run; this is why
the screenshot comparison is not enforced in CI (Linux) yet.

Baselines are captured from the v0.3.153 release itself, with the same spec:

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
| `AIUI_E2E_PORT` | `8720` | first of six consecutive ports |
| `AIUI_E2E_PYTHON` | `python3`, then `python` | interpreter (≥ 3.10) with the package's dependencies |
| `AIUI_E2E_REUSE` | unset | `1` reuses servers already listening on the ports |
| `AIUI_E2E_BASELINE_SRC` | unset | a v0.3.153 checkout; enables `legacy-baseline` |
| `AIUI_E2E_SWEEP_PAGES` | all | comma-separated page ids, to debug the sweep |
| `AIUI_E2E_KEEP_HOME` | unset | `1` keeps the real `HOME` (for `pip install --user` setups) |

Reports go to `e2e/.report` (HTML) and `e2e/.results` (traces of failures);
both are ignored by git. `npx playwright show-report e2e/.report` opens the
report, which also carries the key-page screenshots for review.
