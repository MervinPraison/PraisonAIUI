# PraisonAIUI Examples

Start at **01** and work your way up. Each example adds exactly one new concept.

---

## 🐍 Python Track — `python/`

Build chat apps with an incremental decorator-based API.

| # | Folder | New Concept | Run |
|---|--------|-------------|-----|
| 01 | [chat](python/01-chat/) | `@reply`, `aiui.say()` | `aiui run app.py` |
| 02 | [chat-app](python/02-chat-app/) | `@welcome`, `@button`, `@profiles`, `@starters`, `@goodbye` | `aiui run app.py` |
| 03 | [chat-with-ai](python/03-chat-with-ai/) | OpenAI streaming, context, lazy client | `aiui run app.py` |
| 04 | [chat-with-praisonai](python/04-chat-with-praisonai/) | PraisonAI Agent, `asyncio.to_thread()` | `aiui run app.py` |
| 05 | [agent-playground](python/05-agent-playground/) | Multi-agent profiles, per-session context | `aiui run app.py --datastore json` |
| 06 | [praisonai-playground](python/06-praisonai-playground/) | Multi PraisonAI Agents, context-aware starters | `aiui run app.py --datastore json` |
| 07 | [dashboard](python/07-dashboard/) | `@page` decorator (analytics + docs), `@on()` syntax | `aiui run app.py --style dashboard` |
| 08 | [provider-praisonai](python/08-provider-praisonai/) | Custom `BaseProvider`, `RunEvent` protocol | `aiui run app.py` |
| 09 | [feature-showcase](python/09-feature-showcase/) | All 10 protocol features, auto-discovery | `aiui run app.py` |
| 10 | [streaming](python/10-streaming/) | PraisonAI Agent streaming, `stream_emitter` | `aiui run app.py` |
| 11 | [non-streaming](python/11-non-streaming/) | Explicit non-streaming, `agent.chat(stream=False)` | `aiui run app.py` |
| 12 | [widget](python/12-widget/) | Copilot widget/sidebar mode, floating panel | `aiui run app.py` |
| 13 | [full-dashboard](python/13-full-dashboard/) | All features seeded, server via `create_app()` | `python app.py` |
| 15 | [ui-integration](python/15-ui-integration/) | Gradio/Streamlit mount, REST embedding | `python app.py` |
| 16 | [agent-dashboard](python/16-agent-dashboard/) | OpenClaw-style admin panel, sidebar nav | `python app.py` |

---

## 📄 YAML Track — `yaml/`

Configure agents and sites entirely in YAML — zero Python.

### Chat Agents (01–04)

| # | Folder | New Concept | Run |
|---|--------|-------------|-----|
| 01 | [chat](yaml/01-chat/) | `name`, `instructions`, `welcome`, `starters` | `aiui run chat.yaml` |
| 02 | [profiles](yaml/02-profiles/) | `profiles`, `goodbye` | `aiui run chat.yaml` |
| 03 | [tools](yaml/03-tools/) | `model`, `tools` (web_search, calculate) | `aiui run chat.yaml` |
| 04 | [features](yaml/04-features/) | `features: true` — all 8 protocol modules | `aiui run chat.yaml` |

### Site Templates (05–11)

Theme variants for docs/marketing sites. Each has an `aiui.template.yaml`.

| # | Folder | Theme | Run |
|---|--------|-------|-----|
| 05 | [minimal](yaml/05-minimal/) | Zinc | `aiui dev -e examples/yaml` |
| 06 | [blocks](yaml/06-blocks/) | Blocks layout | `aiui dev -e examples/yaml` |
| 07 | [colorful](yaml/07-colorful/) | Vibrant palette | `aiui dev -e examples/yaml` |
| 08 | [corporate](yaml/08-corporate/) | Professional | `aiui dev -e examples/yaml` |
| 09 | [dark-modern](yaml/09-dark-modern/) | Dark mode | `aiui dev -e examples/yaml` |
| 10 | [developer-portal](yaml/10-developer-portal/) | API docs | `aiui dev -e examples/yaml` |
| 11 | [full-featured](yaml/11-full-featured/) | Kitchen sink | `aiui dev -e examples/yaml` |
