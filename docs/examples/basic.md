# Chat & Agent Examples

> Curated, modern Python chat and AI agent examples you can run in one command.

Every example below lives in [`examples/`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples) and runs with one command (`aiui run app.py`) in the default **React app shell** (`style: app`).

> **Tip:**
> New to PraisonAIUI? Follow the [6-step progressive learning path](https://ui.praison.ai/docs/tutorials/first-chat.md) to build an app one feature at a time, or browse [Apps, Components & A2UI](https://ui.praison.ai/docs/examples/app-and-components.md) and [Zero-Code YAML & Plugins](https://ui.praison.ai/docs/examples/yaml-and-plugins.md).

## Agent UI & Streaming

| Example | What it demonstrates | Run |
|---|---|---|
| [01-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/01-chat) | Minimal 5-line chat (`@aiui.reply` + `aiui.say()`) | `aiui run app.py` |
| [02-chat-app](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/02-chat-app) | Full lifecycle (`@welcome`, `@on_chat_start`, `@step`, `@profiles`, `@starters`, `@button`, `notify(persist=True)`) | `aiui run app.py` |
| [03-chat-with-ai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/03-chat-with-ai) | Live OpenAI token streaming, per-chat memory and feedback | `aiui run app.py` |
| [04-chat-with-praisonai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/04-chat-with-praisonai) | PraisonAI Agent with `aiui.Step` trace | `aiui run app.py` |
| [05-agent-playground](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/05-agent-playground) | Multi-agent switching with `@aiui.profiles` | `aiui run app.py` |
| [07-provider-praisonai](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/07-provider-praisonai) | Custom `BaseProvider` subclass and `RunEvent` protocol | `aiui run app.py` |
| [08-streaming](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/08-streaming) | Real-time PraisonAI Agent token streaming via `StreamBridge` | `aiui run app.py` |
| [09-widget](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/09-widget) | Floating or sidebar copilot chat widget (`aiui.set_chat_mode`) | `aiui run app.py` |
| [26-clean-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/26-clean-chat) | Focused Workbench chat (`aiui.only_my_pages("chat")`) | `aiui run app.py` |
| [27-custom-theme-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/27-custom-theme-chat) | Custom registered theme preset (`aiui.register_theme`) | `aiui run app.py` |
| [31-image-preview](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/31-image-preview) | Inline agent-generated images in chat (`MESSAGE_ELEMENT`) | `aiui run app.py` |

## Minimal 5-Line Starter

```python title="app.py"
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

```bash
aiui run app.py
```

## Explore More Tracks

- **[Apps, Components & A2UI](https://ui.praison.ai/docs/examples/app-and-components.md)** — Dashboards, all 76 UI components, typed tables, filters, A2UI surfaces, gateways, channels, voice, and video.
- **[Zero-Code YAML & Plugins](https://ui.praison.ai/docs/examples/yaml-and-plugins.md)** — Run complete chat apps, A2UI surfaces, dashboards, and docs sites purely from YAML, plus installable UI plugins.
- **[Advanced Docs Sites](https://ui.praison.ai/docs/examples/advanced.md)** — Multi-template docs sites, hero banners, route overrides, and custom theming.

## Related pages

- [Apps, Components & A2UI Examples](https://ui.praison.ai/docs/examples/app-and-components.md)
- [Zero-Code YAML & Plugin Examples](https://ui.praison.ai/docs/examples/yaml-and-plugins.md)
- [Agent UI Overview](https://ui.praison.ai/docs/chat-ui/overview.md)
