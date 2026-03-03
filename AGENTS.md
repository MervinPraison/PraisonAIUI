# AGENTS.md — PraisonAIUI

Machine-readable context for AI coding agents.

## Project Overview

PraisonAIUI is a YAML-driven static site generator for documentation websites.
It compiles `aiui.template.yaml` into a React SPA with a Starlette+Uvicorn server.

## Quick Commands

```bash
# Setup
pip install -e ".[dev]"

# Lint
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
│   ├── praisonaiui/             # Python package (PyPI: praisonaiui)
│   │   ├── cli.py               # Typer CLI: init, validate, build, serve, dev
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
│   │   └── templates/frontend/  # Built React bundle (committed)
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
│   ├── unit/                    # 62 fast isolated tests
│   │   ├── test_schema.py       # 9 tests — Pydantic models
│   │   ├── test_validators.py   # 4 tests — config validation
│   │   ├── test_compiler.py     # 16 tests — compilation pipeline
│   │   ├── test_scanner.py      # 7 tests — docs scanner
│   │   ├── test_serve.py        # 9 tests — serve command
│   │   ├── test_plugins.py      # 8 tests — plugin system
│   │   └── test_i18n_a11y.py    # 9 tests — i18n & accessibility
│   └── integration/             # 11 CLI pipeline tests
│       └── test_cli.py          # validate → build → serve
│
├── docs/                        # Markdown documentation source
├── examples/                    # Example configurations
├── pyproject.toml               # Package config + tool settings
├── aiui.template.yaml           # Reference configuration
└── .github/workflows/ci.yml     # CI: ruff + pytest (blocks on failure)
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
1. Source in `src/frontend/src/` (React 19 + TypeScript + Vite)
2. Build: `cd src/frontend && npm run build`
3. Output: `src/frontend/dist/`
4. Sync to templates: copy `dist/{index.html,assets/,icon.svg}` → `src/praisonaiui/templates/frontend/`
5. Compiler copies templates to output dir during `aiui build`

## Gotchas

- **Frontend bundle is committed** — changes to `src/frontend/src/` require rebuilding and syncing to `templates/frontend/`
- **Pydantic V2** — uses `model_config = ConfigDict(populate_by_name=True)`, not deprecated `class Config`
- **SPA fallback** — serve returns `index.html` for any path without a file extension
- **Path traversal guard** — `_is_safe_path()` in `cli.py` blocks `../` regardless of encoding
- **Icon path** — favicon is at `/icon.svg` (root), not `/assets/icon.svg`
