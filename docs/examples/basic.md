# Basic Examples

> Simple examples to get started with PraisonAIUI.

Simple examples to get started with PraisonAIUI.

## Python Examples Reference

The apps live in [`examples/python/`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python).
Each one adds one concept; run it from its folder.

| Example | Concept | Run |
|---|---|---|
| [01-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/01-chat) | `@aiui.reply` + `aiui.say()`: the minimal chat | `aiui run app.py` |
| [02-chat-app](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/02-chat-app) | Lifecycle callbacks (`@welcome`, `@button`, `@profiles`, `@starters`, `@goodbye`) | `aiui run app.py` |
| [03-chat-with-ai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/03-chat-with-ai) | OpenAI streaming with `aiui.stream_token()` | `aiui run app.py` |
| [04-chat-with-praisonai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/04-chat-with-praisonai) | A PraisonAI agent behind `@aiui.reply` | `aiui run app.py` |
| [05-agent-playground](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/05-agent-playground) | Several agents with `@aiui.profiles` switching | `aiui run app.py` |
| [06-dashboard](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/06-dashboard) | Custom pages with `@aiui.page` | `aiui run app.py --style dashboard` |
| [07-provider-praisonai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/07-provider-praisonai) | A custom `BaseProvider` and the `RunEvent` protocol | `aiui run app.py` |
| [08-streaming](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/08-streaming) | PraisonAI agent token streaming | `aiui run app.py` |
| [09-widget](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/09-widget) | Chat as a floating widget or sidebar | `aiui run app.py` |
| [10-feature-showcase](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/10-feature-showcase) | Every built-in dashboard page, with `create_app()` | `python app.py` |
| [11-ui-integration](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/11-ui-integration) | PraisonAIUI next to Gradio and Streamlit | `python app.py` |
| [13-real-dashboard](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/13-real-dashboard) | Dashboard with real PraisonAI agents | `aiui run app.py --style dashboard` |
| [14-all-features](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/14-all-features) | API test suite over the features (Starlette `TestClient`) | `python app.py` |
| [15-dashboard-test](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/15-dashboard-test) | Dashboard component rendering | `python app.py` |
| [16-gateway-integration](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/16-gateway-integration) | `AIUIGateway` with execution and streaming | `python app.py` |
| [17-three-column-demo](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/17-three-column-demo) | Three-column feature explorer on the gateway | `python app.py` |
| [18-full-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/18-full-chat) | Chat-focused dashboard with `aiui.set_pages()` | `python app.py` |
| [19-components-showcase](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/19-components-showcase) | The dashboard UI components | `aiui run app.py --style dashboard` |
| [20-email-bot](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/20-email-bot) | An agent on an email inbox | `python app.py` |
| [21-email-channel](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/21-email-channel) | Email as a dashboard channel | `aiui run app.py` |
| [22-agentmail-bot](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/22-agentmail-bot) | AgentMail bot with programmatic inboxes | `python app.py` |
| [23-agentmail-channel](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/23-agentmail-channel) | AgentMail as a dashboard channel | `python app.py` |
| [24-e2e-components-test](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/24-e2e-components-test) | Components, docs and chat in one app (end-to-end test) | `python app.py` |
| [25-custom-design](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/25-custom-design) | A fully themed chat with `set_custom_css()` | `aiui run app.py` |
| [26-clean-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/26-clean-chat) | Dashboard chat without the sidebar | `aiui run app.py` |
| [27-custom-theme-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/27-custom-theme-chat) | A custom theme with `register_theme()` | `aiui run app.py` |
| [28-multica-style](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/28-multica-style) | Floating chat window, collapsible sidebar, brand colour | `aiui run app.py --style dashboard` |
| [29-full-extensibility](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/29-full-extensibility) | Every extension point in one app | `python app.py` |
| [30-a2ui-canvas](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/30-a2ui-canvas) | A2UI canvas surfaces | `python app.py` |
| [31-image-preview](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/31-image-preview) | Agent-generated images in chat | `aiui run app.py` |

YAML chat apps (`aiui run chat.yaml`) are in
[`examples/yaml/`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml).

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
      left: { type: "DocsSidebar" }
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
├── aiui.yaml
├── docs/
│   ├── index.md
│   ├── getting-started/
│   │   ├── installation.md
│   │   └── quickstart.md
│   └── guides/
│       └── configuration.md
```

```bash
aiui validate
aiui build      # writes ./aiui
aiui serve      # builds and serves on http://127.0.0.1:8000
```

## Related pages

- [Quick Start](https://ui.praison.ai/docs/getting-started/quickstart.md)
- [Bootstrap](https://ui.praison.ai/docs/concepts/bootstrap.md)
- [Reference](https://ui.praison.ai/docs/api.md)
