# AGENTS.md — PraisonAIUI

Machine-readable context for AI coding agents.

## Read first

- [`ARCHITECTURE.md`](ARCHITECTURE.md): layer map, the numbered rules (R1-R16),
  the stack table and the PR review checklist. Every PR is reviewed against it.
- [`prd.md`](prd.md): current product requirements (top section) and flip criteria.
- [`src/frontend/DESIGN.md`](src/frontend/DESIGN.md): visual rules and tokens for any UI change.

## Project Overview

PraisonAIUI (PyPI `aiui`, import `praisonaiui`) is a Python package and
Starlette+Uvicorn server that gives AI agents a web UI: the default vanilla-JS
`dashboard` style, an opt-in React app shell (`style: app`), React chat/agents/
playground styles, and a YAML-driven docs site (`aiui build`). Pages and
features extend through UI plugins (see `docs/features/plugins.md`).

## Quick Commands

```bash
# Setup
pip install -e ".[dev]"

# Lint (CI runs `ruff check src/praisonaiui`)
ruff check src/ tests/

# Test (all)
pytest tests/unit tests/integration -v

# Test (fast — unit only)
pytest tests/unit -v

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
│   ├── praisonaiui/             # Python package (PyPI: aiui)
│   │   ├── cli.py               # Typer CLI: run, build, serve, plugins, doctor, …
│   │   ├── server.py            # Starlette host: create_app, HTML, shell manifest
│   │   ├── plugin_registry.py   # UI plugin registry + ExtensionPolicy (entry points)
│   │   ├── builtin/             # First-party plugin records (catalog.py: pages + features)
│   │   ├── features/            # Feature protocols (domain APIs)
│   │   ├── http_guard.py        # Public surface, WS tickets, origin guard, log redaction
│   │   ├── compiler/
│   │   │   ├── compiler.py      # Config → JSON manifest compiler
│   │   │   ├── docs_scanner.py  # Markdown scanner with frontmatter
│   │   │   └── nav_builder.py   # Navigation tree generator
│   │   ├── schema/
│   │   │   ├── models.py        # Pydantic V2 models (Config, SiteConfig, etc.)
│   │   │   └── validators.py    # Cross-reference validation logic
│   │   ├── plugins.py           # Docs compiler hooks (not UI plugins)
│   │   ├── components.py        # Component registry
│   │   ├── themes.py            # Theme preset system
│   │   └── templates/frontend/  # Built React bundle (committed) + vanilla dashboard plugins/
│   │
│   └── frontend/                # React 19 + Vite + TypeScript source
│       └── src/
│           ├── main.tsx          # Boot split: shell/mount (style app) or legacy-app-entry
│           ├── shell/ sdk/       # Core: app shell, registries, @aiui/sdk (names no page)
│           ├── builtin/          # First-party browser plugins (chat, approvals)
│           ├── chat-engine/ markdown/ blocks/ legacy/   # Engines used by plugins
│           ├── components/ui/    # shadcn primitives on radix-ui
│           ├── App.tsx           # Legacy React App (chat/docs/agents/playground styles)
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
│   ├── unit/                    # Fast isolated tests (pytest tests/unit)
│   │   └── fixtures/            # golden_dashboard_html.txt, builtin_pages_snapshot.json
│   └── integration/             # CLI pipeline tests (test_cli.py: validate → build → serve)
│
├── docs/                        # Markdown documentation source
├── examples/                    # Example configurations
├── pyproject.toml               # Package config + tool settings
├── aiui.template.yaml           # Reference configuration
└── .github/workflows/ci.yml     # CI: python (ruff + pytest), frontend, e2e, bundle-sync
```

## Key Patterns

### Data Flow
```
YAML config → Pydantic models → Compiler → JSON manifests → React SPA
```

### Config Resolution
- `aiui.template.yaml` → validated via `schema/validators.py`
- Components defined in `components:` section, referenced as slot `ref:` in templates
- Routes map URL patterns to templates

### Test Patterns
- **Unit tests** use `tmp_path` fixture for filesystem isolation
- **Integration tests** use `CliRunner` from Typer for CLI testing
- **Fixtures** in `test_cli.py` create full project directories with config + docs

### Frontend Build
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

- **Frontend bundle is committed** — changes to `src/frontend/src/` require `npm run build && npm run sync` and committing `templates/frontend/` (CI's bundle-sync check fails otherwise; after a merge to main a bot PR resyncs it)
- **Hashed chunks** — never reference a chunk by name; read `aiui-manifest.json` (see `src/frontend/scripts/lib/build-manifest.mjs`)
- **Pydantic V2** — uses `model_config = ConfigDict(populate_by_name=True)`, not deprecated `class Config`
- **SPA fallback** — serve returns `index.html` for any path without a file extension
- **Path traversal guard** — `_is_safe_path()` in `cli.py` blocks `../` regardless of encoding
- **Icon path** — favicon is at `/icon.svg` (root), not `/assets/icon.svg`
