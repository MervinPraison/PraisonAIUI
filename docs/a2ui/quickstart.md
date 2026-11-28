# Step-by-Step Quickstart

> Build and run your first interactive A2UI surface in PraisonAIUI step by step.

Follow these five steps to go from zero to a live, interactive A2UI workspace.

## Step 1 — Install PraisonAIUI

```bash
pip install aiui
```

If you want PraisonAI agents to generate A2UI surfaces via tool calls, also install the optional agent SDK:

```bash
pip install "praisonaiagents[a2ui]"
```

## Step 2 — Create your first A2UI app

Save this as `app.py`. It enables the split **Chat + Canvas** view, a full-page **Canvas**, and a custom **Agent Canvas** page backed by surface `"main"`:

```python
import praisonaiui as aiui

aiui.set_branding(title="My A2UI App")
aiui.set_chat_preview(enabled=True, surface_id="main", width="40%")
aiui.set_pages(["chat-canvas", "chat", "canvas", "agent-canvas"])

def build_card(clicks: int = 0) -> list[dict]:
    return aiui.a2ui_surface(
        surface_id="main",
        theme={"primaryColor": "#2563eb"},
        components=[
            {"id": "root", "component": "Column", "children": ["title", "count", "btn"]},
            {"id": "title", "component": "Text", "text": "Hello from A2UI!", "variant": "h2"},
            {"id": "count", "component": "Text", "text": {"path": "/label"}},
            {"id": "btn-text", "component": "Text", "text": "Increment"},
            {
                "id": "btn",
                "component": "Button",
                "child": "btn-text",
                "variant": "primary",
                "action": {"event": {"name": "inc", "context": {}}},
            },
        ],
        data={"clicks": clicks, "label": f"Button clicked {clicks} time(s)."},
    )

state = {"clicks": 0}

@aiui.page("agent-canvas", title="Agent Canvas", group="A2UI")
async def agent_canvas():
    return {"_surface": {"id": "main", "messages": build_card(state["clicks"])}}

@aiui.surface_action("main")
async def on_action(action: dict):
    if action.get("action") == "inc":
        state["clicks"] += 1
        await aiui.push_surface("main", build_card(state["clicks"]), replace=True)
    return {"clicks": state["clicks"]}
```

## Step 3 — Run the server

```bash
aiui run app.py
```

Open `http://127.0.0.1:8000` and switch between **Chat + Canvas**, **Canvas**, and **Agent Canvas**. Click **Increment** to watch the surface update live over WebSocket.

## Step 4 — Push updates from the CLI (JSON or JSONL)

Save a JSONL file `hello.jsonl`:

```json
{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"basic"}}
{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Text","text":{"path":"/msg"},"variant":"h1"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"main","path":"/","value":{"msg":"Pushed live from CLI!"}}}
```

Push it to your running server:

```bash
aiui surface push main --file hello.jsonl --replace
aiui surface capabilities
```

## Step 5 — Let an AI agent drive the canvas

Wrap `send_a2ui_messages` with `coerce_a2ui_tool_messages` so any LLM output shape (JSON, JSONL, v0.8, or v0.9) is normalized automatically:

```python
from praisonaiagents import Agent
from praisonaiagents.tools.a2ui_tools import send_a2ui_messages as sdk_send
from praisonaiagents.tools.decorator import tool
from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

@tool
def send_a2ui_messages(messages):
    """Push A2UI v0.9 messages to the live canvas."""
    return sdk_send(messages=coerce_a2ui_tool_messages(messages, surface_id="main"))

aiui.register_agent(
    "ui-builder",
    Agent(name="ui-builder", instructions="Always call send_a2ui_messages to render UI.", tools=[send_a2ui_messages]),
)
```

Next: explore all **[18 Basic Catalog Components & 14 Functions](https://ui.praison.ai/docs/a2ui/components.md)**.

## Related pages

- [All-in-One A2UI Playground](https://ui.praison.ai/docs/a2ui/all-in-one-playground.md)
- [A2UI canvas — agent-driven UI](https://ui.praison.ai/docs/features/a2ui-canvas.md)
- [A2UI — Agent-to-User Interface](https://ui.praison.ai/docs/a2ui/overview.md)
