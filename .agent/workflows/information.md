---
description: Project information and deployment reference for PraisonAIUI
---

## Project: PraisonAIUI

YAML-driven website/docs generator. One YAML file, one docs folder, one command — ship a beautiful documentation site.

## Key Files

| File | Purpose |
|------|---------|
| `aiui.template.yaml` | Site configuration (theme, nav, routes, components) |
| `docs/` | Markdown content directory |
| `src/praisonaiui/` | Python source (CLI, compiler, server, providers) |
| `src/praisonaiui/compiler/` | Build pipeline: config → static site |
| `src/praisonaiui/templates/frontend/` | Bundled React SPA (index.html + assets) |
| `.github/workflows/ci.yml` | CI (lint, test) + GitHub Pages deployment |
| `pyproject.toml` | Package metadata, dependencies, entry points |
| `CNAME` | Custom domain: `ui.praison.ai` |

## CLI Commands

```bash
aiui init             # Scaffold new project
aiui build            # Compile → static site in ./aiui/
aiui build --output site --minify  # For GitHub Pages
aiui serve            # Serve built site locally
aiui dev              # Dev mode with hot reload
aiui validate         # Validate aiui.template.yaml
```

## Build Output

`aiui build` produces a fully static SPA:
- `index.html` + `assets/` — React frontend bundle
- `ui-config.json` — compiled site configuration
- `docs-nav.json` — navigation tree from docs folder
- `route-manifest.json` — route definitions
- `docs/` — copied markdown content

## Deployment

- **CI**: On push to `main`, GitHub Actions runs `aiui build --output site --minify`
- **Deploy**: `peaceiris/actions-gh-pages@v4` pushes `./site/` to `gh-pages` branch
- **Domain**: `ui.praison.ai` via CNAME file copied into build output
- **No server required** — everything is static

## Testing

```bash
pip install -e .[dev]
pytest tests/unit tests/integration -v
ruff check src/praisonaiui
```

## Package

- PyPI name: `aiui`
- Entry points: `aiui` and `praisonaiui` (both map to `praisonaiui.cli:app`)
- Python: ≥3.9
