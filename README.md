# PraisonAIUI

[![Python Tests](https://github.com/MervinPraison/PraisonAIUI/actions/workflows/ci.yml/badge.svg)](https://github.com/MervinPraison/PraisonAIUI/actions)
[![PyPI version](https://badge.fury.io/py/praisonaiui.svg)](https://badge.fury.io/py/praisonaiui)

> **One YAML file → One complete website**

PraisonAIUI is a YAML-driven website generator. Write one config file, point to a docs folder, run `aiui build` — get a modern, production-ready documentation site.

## Philosophy

> **We are a wrapper, not a framework.**

We integrate best-in-class libraries instead of reinventing them:

| Feature | Library |
|---------|---------|
| Markdown | `react-markdown` + `remark-gfm` |
| UI Components | shadcn/ui |
| Theming | Tailwind CSS + CSS variables |
| Validation | Pydantic |

## Quick Start

```bash
pip install praisonaiui
aiui init
aiui build
aiui serve
```

Open http://localhost:8000 — your site is ready.

## Configuration

```yaml
# aiui.template.yaml
schemaVersion: 1

site:
  title: "My Docs"
  theme:
    preset: "blue"      # zinc, slate, green, blue, violet, orange, rose, yellow
    radius: "md"        # none, sm, md, lg, xl
    darkMode: false

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"   # or TwoColumnLayout, CenteredLayout
    slots:
      main: { type: "DocContent" }

routes:
  - match: "/docs/**"
    template: "docs"
```

## Layouts

| Layout | Description |
|--------|-------------|
| `ThreeColumnLayout` | Sidebar + Content + TOC (classic docs) |
| `TwoColumnLayout` | Sidebar + Content (no TOC) |
| `CenteredLayout` | Centered content, no sidebar |
| `FullWidthLayout` | Full-width content |

## Theme Presets

8 built-in [shadcn themes](https://ui.shadcn.com/themes): `zinc`, `slate`, `green`, `blue`, `violet`, `orange`, `rose`, `yellow`

Each with light/dark mode support.

## CLI Commands

```bash
aiui init              # Create aiui.template.yaml
aiui init --frontend   # Scaffold full React project
aiui validate          # Validate YAML config
aiui build             # Compile to static site
aiui serve             # Dev server with hot reload
```

## Architecture

```
aiui.template.yaml     →  aiui build  →  aiui/
       ↓                                    ├── index.html
    docs/*.md                               ├── docs/*.md
                                            ├── ui-config.json
                                            └── assets/
```

## Development

```bash
git clone https://github.com/MervinPraison/PraisonAIUI.git
cd PraisonAIUI
pip install -e .[dev]
pytest tests -v
```

## License

MIT © [Praison Limited](https://praison.ai)
