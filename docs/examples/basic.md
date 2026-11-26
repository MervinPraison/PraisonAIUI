---
title: Examples
nav_title: Basic examples
description: Curated, modern Python, zero-code YAML, UI component, plugin and docs-site examples you can run in one command.
---

# Examples

Every example below lives in [`examples/`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples) and runs with a single command (`aiui run app.py` or `aiui run chat.yaml`) in the default **React app shell** (`style: app`).

<Tip>
New to PraisonAIUI? Follow the [6-step progressive learning path](../tutorials/01-first-chat.md) to build a complete app one feature at a time.
</Tip>

## Chat UI examples

| Example | What it demonstrates | Run |
|---|---|---|
| [01-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/01-chat) | Minimal 5-line chat (`@aiui.reply` + `aiui.say()`) | `aiui run app.py` |
| [02-chat-app](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/02-chat-app) | Full lifecycle (`@welcome`, `@on_chat_start`, `@step`, `@profiles`, `@starters`, `@button`, `notify(persist=True)`) | `aiui run app.py` |
| [03-chat-with-ai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/03-chat-with-ai) | Live OpenAI token streaming, per-chat memory and feedback | `aiui run app.py` |
| [04-chat-with-praisonai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/04-chat-with-praisonai) | PraisonAI Agent with `aiui.Step` trace | `aiui run app.py` |
| [05-agent-playground](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/05-agent-playground) | Multi-agent switching with `@aiui.profiles` | `aiui run app.py` |
| [08-streaming](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/08-streaming) | Real-time PraisonAI Agent token streaming via `StreamBridge` | `aiui run app.py` |
| [09-widget](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/09-widget) | Floating or sidebar copilot chat widget (`aiui.set_chat_mode`) | `aiui run app.py` |
| [26-clean-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/26-clean-chat) | Focused Workbench chat (`aiui.only_my_pages("chat")`) | `aiui run app.py` |
| [27-custom-theme-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/27-custom-theme-chat) | Custom registered theme preset (`aiui.register_theme`) | `aiui run app.py` |
| [31-image-preview](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/31-image-preview) | Inline agent-generated images in chat (`MESSAGE_ELEMENT`) | `aiui run app.py` |

## App, UI Components & Dashboard examples

| Example | What it demonstrates | Run |
|---|---|---|
| [06-dashboard](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/06-dashboard) | Metrics, charts, typed tables, URL filters, `doc_viewer` and live notifications | `aiui run app.py` |
| [19-components-showcase](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/19-components-showcase) | Interactive UI Components & Notification Center gallery | `aiui run app.py` |
| [32-filter-page](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/32-filter-page) | URL-synced `filter_bar`, `date_range_input` and `multiselect_input` | `aiui run app.py` |
| [33-data-table](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/33-data-table) | Typed sortable/searchable `aiui.table` with sparklines & row detail drawer | `aiui run app.py` |
| [28-multica-style](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/28-multica-style) | Branded multi-page workspace with floating chat and Kanban board | `aiui run app.py` |
| [30-a2ui-canvas](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/30-a2ui-canvas) | Agent-driven A2UI canvas surfaces | `aiui run app.py` |

## Zero-code YAML, Plugins & Integrations

- **Zero-code YAML apps** (`examples/yaml/`): Ready-to-run YAML configs (`01-chat`, `02-profiles`, `03-clean-chat`, `04-tools`, `07-blocks`, `13-playground` and themed docs sites) — run with `aiui run chat.yaml` or `aiui serve`.
- **UI Plugin package** ([`examples/plugins/aiui-hello-plugin`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/plugins/aiui-hello-plugin)): Complete installable Python + React plugin using `@aiui/sdk`.
- **Advanced integrations** (`examples/python/`): Custom `BaseProvider` (`07-provider-praisonai`), `AIUIGateway` (`16-gateway-integration`, `18-full-chat`), email/AgentMail channels (`20-email-bot`–`23-agentmail-channel`), `video-studio`, `voice-agent`, `meeting-agent`, and full extensibility (`29-full-extensibility`).

## Minimal Docs Site (`aiui.yaml`)

```yaml title="aiui.yaml"
schemaVersion: 1

site:
  title: "My Docs"
  theme:
    preset: "paper"
    mode: "system"

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { type: "Header" }
      left: { type: "DocsSidebar" }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { type: "Footer" }

routes:
  - match: "/docs/**"
    template: "docs"
```

```bash
aiui validate
aiui build --strict
aiui serve
```

See [Advanced Examples](advanced.md) for multi-template docs sites, hero banners, route overrides and custom theming.
