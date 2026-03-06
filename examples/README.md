# PraisonAIUI Examples

> Each example teaches exactly **one new concept** — no overlap.

## Python Track

| # | Name | Unique Concept | Run |
|---|---|---|---|
| 01 | [chat](python/01-chat/) | `@reply` + `aiui.say()` — minimal hello-world | `aiui run app.py` |
| 02 | [chat-app](python/02-chat-app/) | Full lifecycle callbacks (`@welcome`, `@button`, `@profiles`, `@starters`, `@goodbye`) | `aiui run app.py` |
| 03 | [chat-with-ai](python/03-chat-with-ai/) | OpenAI streaming via `stream_token()` | `aiui run app.py` |
| 04 | [chat-with-praisonai](python/04-chat-with-praisonai/) | PraisonAI Agent, `asyncio.to_thread()`, `stream=False` | `aiui run app.py` |
| 05 | [agent-playground](python/05-agent-playground/) | Multi-agent `@profiles` switching | `aiui run app.py` |
| 06 | [dashboard](python/06-dashboard/) | `@page` decorator, `@on("event")` syntax | `aiui run app.py` |
| 07 | [provider-praisonai](python/07-provider-praisonai/) | Custom `BaseProvider` subclass, `RunEvent` protocol | `aiui run app.py` |
| 08 | [streaming](python/08-streaming/) | PraisonAI Agent streaming via `stream_emitter` | `aiui run app.py` |
| 09 | [widget](python/09-widget/) | Copilot/sidebar mode | `aiui run app.py` |
| 10 | [feature-showcase](python/10-feature-showcase/) | All protocol features seeded, `create_app()` | `python app.py` |
| 11 | [ui-integration](python/11-ui-integration/) | Gradio ASGI mount, Streamlit iframe, REST embedding | `python app.py` |
| 12 | [agent-dashboard](python/12-agent-dashboard/) | OpenClaw-style rendered HTML admin panel | `python app.py` |
| 13 | [real-dashboard](python/13-real-dashboard/) | Real PraisonAI Agent + native dashboard + live metrics | `aiui run app.py --style dashboard` |

---

## YAML Track — Site Templates

| # | Name | Shows |
|---|---|---|
| 01 | minimal | 5-line YAML → live docs site |
| 02 | with-sidebar | `DocsSidebar` slot, directory-based navigation |
| 03 | with-toc | `Toc` slot, right-column table of contents |
| 04 | multi-section | Multiple content directories and grouped routes |
| 05 | custom-homepage | `Hero` + `FeatureList` slot components |
| 06 | fullstack | Header/Footer refs, CTA buttons, dark mode |
| 07 | seo-config | `<meta>` tags, `<title>` per-page, Open Graph |
| 08 | api-reference | `ApiSidebar`, route-level slot overrides |
| 09 | typescript-custom | Custom TypeScript component registration |
| 10 | i18n-ready | Multi-language content directories |
| 11 | monorepo | Workspaces, shared components, per-package docs |
