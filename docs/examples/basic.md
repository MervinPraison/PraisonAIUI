# Basic Examples

Simple examples to get started with PraisonAIUI.

## Python Examples Reference

Each example teaches exactly **one new concept** — no overlap.

| # | Name | Unique Concept | Run |
|---|---|---|---|
| 01 | chat | `@reply` + `aiui.say()` — minimal hello-world | `aiui run app.py` |
| 02 | chat-app | Full lifecycle callbacks (`@welcome`, `@button`, `@profiles`, `@starters`, `@goodbye`) | `aiui run app.py` |
| 03 | chat-with-ai | OpenAI streaming via `stream_token()` | `aiui run app.py` |
| 04 | chat-with-praisonai | PraisonAI Agent, `asyncio.to_thread()`, `stream=False` | `aiui run app.py` |
| 05 | agent-playground | Multi-agent `@profiles` switching | `aiui run app.py` |
| 06 | dashboard | `@page` decorator, `@on("event")` syntax | `aiui run app.py` |
| 07 | provider-praisonai | Custom `BaseProvider` subclass, `RunEvent` protocol | `aiui run app.py` |
| 08 | streaming | PraisonAI Agent streaming via `stream_emitter` | `aiui run app.py` |
| 09 | widget | Copilot/sidebar mode | `aiui run app.py` |
| 10 | feature-showcase | All protocol features seeded, `create_app()` | `python app.py` |
| 11 | ui-integration | Gradio ASGI mount, Streamlit iframe, REST embedding | `python app.py` |
| 12 | agent-dashboard | OpenClaw-style rendered HTML admin panel | `python app.py` |
| 13 | real-dashboard | Production dashboard with seeded data | `python app.py` |
| 14 | all-features | Comprehensive 16-feature API test suite | `python app.py` |

## Minimal Docs Site

The simplest configuration:

```yaml
schemaVersion: 1

site:
  title: "My Docs"

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      main: { type: "DocContent" }

routes:
  - match: "/docs/**"
    template: "docs"
```

## With Header and Footer

Add branding:

```yaml
schemaVersion: 1

site:
  title: "My Project"

content:
  docs:
    dir: "./docs"

components:
  header:
    type: "Header"
    props:
      logoText: "My Project"
      cta:
        label: "GitHub"
        href: "https://github.com/myorg/myproject"

  footer:
    type: "Footer"
    props:
      text: "© 2024 My Company"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header" }
      left: { type: "DocsSidebar", props: { source: "docs-nav" } }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "footer" }

routes:
  - match: "/docs/**"
    template: "docs"
```

## Directory Structure

```
my-docs/
├── aiui.template.yaml
├── docs/
│   ├── index.md
│   ├── getting-started/
│   │   ├── installation.md
│   │   └── quickstart.md
│   └── guides/
│       └── configuration.md
└── package.json
```
