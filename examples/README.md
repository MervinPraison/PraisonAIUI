# PraisonAIUI Examples

> Each example teaches exactly **one new concept** — no overlap.

See also: [`docs/examples/basic.md`](../docs/examples/basic.md) and [`docs/examples/advanced.md`](../docs/examples/advanced.md).

**Note:** Some folders share numeric prefixes (`02-*`, `19-*`) — treat the path name as the canonical ID, not the number alone.

---

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
| 10 | [feature-showcase](python/10-feature-showcase/) | All protocol features seeded, `create_app()` | `aiui run app.py` |
| 11 | [ui-integration](python/11-ui-integration/) | Gradio ASGI mount, Streamlit iframe, REST embedding | `aiui run app.py` |
| 12 | ~~agent-dashboard~~ → [dashboard-test](python/15-dashboard-test/) | *Removed in v0.5.0* — Use secure protocol-first dashboard | `python app.py` |
| 13 | [real-dashboard](python/13-real-dashboard/) | Real PraisonAI Agent + native dashboard + live metrics | `aiui run app.py --style dashboard` |
| 14 | [all-features](python/14-all-features/) | Integration test suite for all 16 feature APIs | `python app.py` |
| 15 | [dashboard-test](python/15-dashboard-test/) | Protocol-first page registration, view registry | `python app.py` |
| 16 | [gateway-integration](python/16-gateway-integration/) | `AIUIGateway` — real agent execution + WebSocket streaming | `python app.py` |
| 17 | [three-column-demo](python/17-three-column-demo/) | Three-column feature explorer with gateway | `python app.py` |
| 18 | [full-chat](python/18-full-chat/) | `aiui.set_pages()` page curation + custom explorer page | `python app.py` |
| 19 | [components-showcase](python/19-components-showcase/) | All 54 UI component types in one dashboard | `aiui run app.py --style dashboard` |
| 20 | [email-bot](python/20-email-bot/) | `EmailBot` IMAP/SMTP + agent replies + subject commands | `python app.py` |
| 21 | [email-channel](python/21-email-channel/) | Email as AIUI dashboard channel via `/api/channels` | `aiui run app.py` |
| 22 | [agentmail-bot](python/22-agentmail-bot/) | `AgentMailBot` API-first email + programmatic inbox lifecycle | `python app.py` |
| 23 | [agentmail-channel](python/23-agentmail-channel/) | AgentMail as AIUI dashboard channel via `/api/channels` | `aiui run app.py` |
| 24 | [e2e-components-test](python/24-e2e-components-test/) | Components, docs, and chat rendering in one app | `python app.py` |
| 25 | [custom-design](python/25-custom-design/) | Every chat design knob (`set_theme`, branding, layout) | `aiui run app.py` |
| 26 | [clean-chat](python/26-clean-chat/) | `set_dashboard(sidebar=False)` — dashboard chat without left nav | `aiui run app.py` |
| 27 | [custom-theme-chat](python/27-custom-theme-chat/) | `register_theme()` — dynamic custom theme (teal/cyan) | `aiui run app.py` |
| 28 | [multica-style](python/28-multica-style/) | Multica-inspired UI features (glass, gradients, motion) | `python app.py` |
| 29 | [full-extensibility](python/29-full-extensibility/) | All extension points: pages, forms, `set_custom_js`, plugins | `python app.py` |
| 30 | [a2ui-canvas](python/30-a2ui-canvas/) | A2UI canvas + `send_a2ui_messages` integration | `python app.py` |
| 31 | [image-preview](python/31-image-preview/) | `ImageAgent` inline chat image preview via `MESSAGE_ELEMENT` | `aiui run app.py` |
| — | [external-agent-dashboard](python/external-agent-dashboard/) | Minimal external agent on dashboard shell | `aiui run app.py` |
| — | [platform-board](python/platform-board/) | Kanban board from PraisonAI Platform issues API | `aiui run app.py` |
| — | [praisonai-claw-board](python/praisonai-claw-board/) | Kanban board from `aiui` jobs store | `aiui run app.py` |
| — | [video-studio](python/video-studio/) | Video Studio — YAML scenes via Video engine sidecar | `aiui run app.py` |

---

## YAML Chat Track

| # | Name | Shows | Run |
|---|---|---|---|
| 01 | [chat](yaml/01-chat/) | Zero-code YAML chat agent | `aiui run chat.yaml` |
| 02 | [clean-chat](yaml/02-clean-chat/) | `dashboard.sidebar: false` — dashboard chat without left nav | `aiui run clean-chat.yaml` |
| 02 | [profiles](yaml/02-profiles/) | YAML agent profiles / persona switching | `aiui run chat.yaml` |
| 03 | [tools](yaml/03-tools/) | Built-in YAML tool registration | `aiui run chat.yaml` |
| 04 | [features](yaml/04-features/) | Feature flags and dashboard options in YAML | `aiui run chat.yaml` |
| 12 | [playground](yaml/12-playground/) | YAML agent playground with multiple profiles | `aiui run chat.yaml --style agents` |

---

## YAML Track — Site Templates

| # | Name | Shows | Run |
|---|---|---|---|
| 05 | [minimal](yaml/05-minimal/) | 5-line YAML → live docs site | `aiui build --config aiui.template.yaml` |
| 06 | [blocks](yaml/06-blocks/) | shadcn component dependency installation | `aiui build --config aiui.template.yaml` |
| 07 | [colorful](yaml/07-colorful/) | Colourful marketing theme with hero zones | `aiui build --config aiui.template.yaml` |
| 08 | [corporate](yaml/08-corporate/) | Corporate docs with SEO, i18n, and a11y fields | `aiui build --config aiui.template.yaml` |
| 09 | [dark-modern](yaml/09-dark-modern/) | Dark-mode modern docs layout | `aiui build --config aiui.template.yaml` |
| 10 | [developer-portal](yaml/10-developer-portal/) | API reference sidebar and route overrides | `aiui build --config aiui.template.yaml` |
| 11 | [full-featured](yaml/11-full-featured/) | Full enterprise config (SEO, i18n, a11y, search) | `aiui build --config aiui.template.yaml` |
