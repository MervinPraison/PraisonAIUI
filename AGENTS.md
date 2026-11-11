# AGENTS.md — PraisonAIUI

Machine-readable context for AI coding agents.

## Project Overview

PraisonAIUI ships three products from one package (`pip install aiui`, import `praisonaiui`):

1. **Python SDK / AI dashboard** (main product) — `app.py` with `import praisonaiui as aiui`,
   run via `aiui run app.py`. Styles: `dashboard`, `app`, `chat`, `agents`, `playground`, `docs`, `custom`
   (`aiui.set_style()` / `--style`). Served by Starlette+Uvicorn from `server.py`.
2. **YAML chat mode** — `aiui run chat.yaml`, same runtime as the SDK.
3. **Documentation site generator** — `aiui init/build/serve` compiles `aiui.template.yaml`
   + Markdown into JSON manifests rendered by the React SPA.

Pick the right implementation before editing: a dashboard page or component is NOT
implemented through the docs compiler or the React source (see "Which code owns what").

## Quick Commands

```bash
# Setup
pip install -e ".[dev]"

# Lint
ruff check src/ tests/

# Test (fast — unit only, what CI runs)
pytest tests/unit -v --no-cov

# Test (all)
pytest tests/unit tests/integration -v

# Targeted tests — discover instead of relying on fixed counts
pytest --collect-only -q tests/unit | tail -1
pytest tests/unit -k dashboard --no-cov

# Run an SDK app (dashboard / chat / YAML)
aiui run app.py --style dashboard
aiui run chat.yaml

# Test with coverage
pytest tests/unit tests/integration -v --cov=src/praisonaiui

# Build frontend (requires Node.js)
cd src/frontend && npm run build

# Validate config
aiui validate --config aiui.template.yaml

# Build site
aiui build --config aiui.template.yaml --output aiui-output/

# Serve locally
aiui serve --output aiui-output/ --port 8000

# Serve with HTTPS
aiui serve --output aiui-output/ --ssl-certfile cert.pem --ssl-keyfile key.pem
```

## Directory Layout

```
PraisonAIUI/
├── src/
│   ├── praisonaiui/             # Python package (PyPI: praisonaiui)
│   │   ├── server.py            # SDK runtime: set_style/set_pages/set_custom_js/register_page, create_app(), HTML host
│   │   ├── ui.py                # Dashboard component builders (layout, card, chart, table, …)
│   │   ├── features/            # BaseFeatureProtocol feature modules (each contributes /api/* routes)
│   │   ├── dashboard_plugins.py # Third-party dashboard plugins (manifest.json) → /api/dashboard/plugins
│   │   ├── provider.py, providers/  # AI provider protocol + implementations
│   │   ├── datastore.py         # Persistence protocol + backends
│   │   ├── cli.py               # Typer CLI: run, init, validate, build, serve, dev, …
│   │   ├── compiler/
│   │   │   ├── compiler.py      # Config → JSON manifest compiler
│   │   │   ├── docs_scanner.py  # Markdown scanner with frontmatter
│   │   │   └── nav_builder.py   # Navigation tree generator
│   │   ├── schema/
│   │   │   ├── models.py        # Pydantic V2 models (Config, SiteConfig, etc.)
│   │   │   └── validators.py    # Cross-reference validation logic
│   │   ├── plugins.py           # Plugin system with hook chaining
│   │   ├── components.py        # Component registry
│   │   ├── themes.py            # Theme preset system
│   │   └── templates/frontend/  # Shipped assets (committed)
│   │       ├── index.html, assets/   # Built React bundle (synced from src/frontend/dist)
│   │       ├── plugins/              # Hand-written JS plugins, edited in place (no build)
│   │       │   ├── plugin-loader.js  # Loads plugins listed by /plugins/plugins.json
│   │       │   ├── dashboard.js      # Dashboard shell, registerView/registerComponent
│   │       │   └── views/            # Built-in dashboard page views
│   │       └── dashboard-plugins/    # Bundled manifest-based dashboard plugins
│   │
│   └── frontend/                # React 19 + Vite + TypeScript source
│       └── src/
│           ├── App.tsx           # Main app (state, routing, SEO, layout)
│           ├── types.ts          # Shared TypeScript interfaces
│           ├── Header.tsx        # Header component
│           ├── Sidebar.tsx       # Navigation sidebar
│           ├── Content.tsx       # Markdown rendering
│           ├── Widgets.tsx       # 10 zone widget components
│           ├── Toc.tsx           # Table of contents
│           ├── Footer.tsx        # Footer component
│           └── themes.ts        # Theme application logic
│
├── tests/
│   ├── unit/                    # Fast isolated tests (CI gate)
│   ├── integration/             # CLI pipeline, endpoints, gateway round-trips
│   ├── js/, browser/            # Frontend plugin / browser tests
│   └── test_feature_*.py        # Per-feature module tests
│
├── docs/                        # Markdown documentation source
├── examples/                    # python/ (SDK curriculum) and yaml/ examples
├── pyproject.toml               # Package config + tool settings
├── aiui.template.yaml           # Reference docs-site configuration
└── .github/workflows/ci.yml     # CI: ruff + pytest tests/unit (blocks on failure)
```

## Key Patterns

### Data Flow

SDK / dashboard runtime:
```
app.py (aiui.set_* / @aiui.page / @aiui.reply) → server.py module state
  → create_app(): core routes + features/*.routes() + dashboard plugin routes
  → _build_html(style) → #root + plugin-loader.js (+ React bundle unless style == "dashboard")
  → browser: /plugins/plugins.json (style-aware) → dashboard.js → /api/pages, /api/pages/{id}/data
```

Docs site:
```
YAML config → Pydantic models → Compiler → JSON manifests → React SPA
```

### Which code owns what

| Change | Where |
|--------|-------|
| Custom dashboard page (server-rendered) | `@aiui.page()` / `register_page()` in `server.py`, components from `ui.py` |
| Page whitelist / removal | `aiui.set_pages()` / `aiui.remove_page()` |
| Client-side view or component | `window.aiui.registerView()` / `registerComponent()` in `plugins/dashboard.js`, shipped from Python via `aiui.set_custom_js(path)` (served at `/custom.js`, loaded after the plugin loader) |
| Backend routes / feature state | Subclass `features/_base.py:BaseFeatureProtocol`, `register_feature()` |
| Third-party dashboard plugin | `manifest.json` folder discovered by `dashboard_plugins.py` |
| Built-in dashboard page UI | `templates/frontend/plugins/views/*.js` (edit in place, no build) |
| Docs/chat React UI | `src/frontend/src/` → rebuild + sync (see Frontend Build) |

**`#root` ownership differs by style.** With `style == "dashboard"` the React bundle is not
served; `plugins/dashboard.js` owns `#root` (adds `db-active`, replaces its contents). With
`style == "app"` the React shell owns `#root` and imports `dashboard.js` itself to host its views.
In other styles the React SPA owns `#root` and JS plugins only enhance rendered content. Do not mix them.

Custom views: `registerView(pageId, render, cleanup)` — `render(container)` runs on navigation,
`cleanup()` runs when navigating away. Guides: `docs/features/how-to-add-a-feature.md`
(extension points), `docs/features/dashboard.md` (client-side API and view lifecycle),
`docs/api/python.md` (SDK reference).

### Config Resolution
- `aiui.template.yaml` → validated via `schema/validators.py`
- Components defined in `components:` section, referenced as slot `ref:` in templates
- Routes map URL patterns to templates

### Test Patterns
- **Unit tests** use `tmp_path` fixture for filesystem isolation
- **Integration tests** use `CliRunner` from Typer for CLI testing
- **Fixtures** in `test_cli.py` create full project directories with config + docs

### Frontend Build (React docs/chat shell only — not dashboard plugins)
1. Source in `src/frontend/src/` (React 19 + TypeScript + Vite). Node version: `src/frontend/.nvmrc`.
2. Build: `cd src/frontend && npm ci && npm run build` (postbuild prunes KaTeX woff/ttf and writes `dist/aiui-externals.json`)
3. Optional A2UI renderer (full agent-driven UI catalog): `npm install @a2ui/react @a2ui/web_core`
4. Output: `src/frontend/dist/`. `assets/index.js` and `assets/index.css` keep fixed names (served as `?v=<hash>`); every other chunk is content-hashed (`assets/<name>-<hash>.js`) and listed in `dist/aiui-manifest.json`
5. Sync to templates: `npm run sync` copies `dist/{index.html,icon.svg,aiui-manifest.json,aiui-externals.json,assets/}` → `src/praisonaiui/templates/frontend/` and **deletes the old `assets/` first**, so stale hashed chunks never linger. To serve a build without touching the tracked tree: `node scripts/sync-templates.mjs --dest "$TMP/frontend"` and `AIUI_TEMPLATES_DIR="$TMP/frontend"`
6. Compiler copies templates to the output dir during `aiui build` and rewrites `index.html` to `/assets/index.js?v=<sha256[:10]>` (same for `index.css`); `AIUI_TEMPLATES_DIR` overrides the bundle there too
7. Gates (CI frontend job): `npx tsc -b`, `npm test`, `npm run test:scripts`, `npm run size` (gzip budgets in `.size-limit.mjs`), `npm run check:closure` (no Streamdown/Shiki/Mermaid/KaTeX/assistant-ui before first paint), and on PRs that touch the frontend `npm run check:bundle` (committed bundle == fresh build; fix with `npm run build && npm run sync`)
8. Browser suites: `npm run test:e2e` (Playwright, chromium; see `src/frontend/e2e/README.md`). They serve `dist/`, so build first

UI styles: `dashboard` (vanilla JS, the default) and the opt-in React shell `app` (`style: app`, `aiui.set_style("app")` or `AIUI_SHELL=app`; `AIUI_SHELL=legacy` is the kill switch). Do not change the default. See `docs/features/react-shell.md`.

Chat inline media (agent-generated images): `RunEventType.MESSAGE_ELEMENT` — see `docs/features/image-preview-chat.md`

## Gotchas

- **Frontend bundle is committed** — changes to `src/frontend/src/` require `npm run build && npm run sync` and committing `templates/frontend/` (CI's bundle-sync check fails otherwise; after a merge to main a bot PR resyncs it); files under `templates/frontend/plugins/` are source and are edited directly
- **Hashed chunks** — never reference a chunk by name; read `aiui-manifest.json` (see `src/frontend/scripts/lib/build-manifest.mjs`)
- **Pydantic V2** — uses `model_config = ConfigDict(populate_by_name=True)`, not deprecated `class Config`
- **SPA fallback** — serve returns `index.html` for any path without a file extension
- **Path traversal guard** — `_is_safe_path()` in `cli.py` blocks `../` regardless of encoding
- **Icon path** — favicon is at `/icon.svg` (root), not `/assets/icon.svg`
