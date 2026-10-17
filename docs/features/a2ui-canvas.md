# A2UI canvas — agent-driven UI

PraisonAIUI hosts **A2UI v0.9** surfaces: agents push structured UI messages to a live canvas while users chat in the same window or on a full-page workspace.

For dashboard extension patterns (views, plugins, layout JSON), see [Agent UI host](agent-ui-host.md).

## Quick start

```python
import praisonaiui as aiui

aiui.set_style("dashboard")
aiui.set_chat_preview(enabled=True, surface_id="main", width="38%")
aiui.set_pages(["chat-canvas", "chat", "canvas"])

@aiui.page("agent-canvas", title="Agent Canvas", icon="🖼️")
async def agent_canvas():
    return {"_surface": {"id": "main", "messages": []}}

@aiui.surface_action("main")
async def on_surface_action(action: dict):
    return {"received": action}
```

Run the full example: [`examples/python/30-a2ui-canvas/app.py`](../../examples/python/30-a2ui-canvas/app.py).

## Dashboard pages

| Page id | Route | Purpose |
|---------|-------|---------|
| `chat-canvas` | `/chat-canvas` | Split view — chat left, live A2UI preview right |
| `chat` | `/chat` | Vanilla chat (unchanged) |
| `canvas` | `/canvas` | Full-page surface workspace |

Enable the split preview with [`set_chat_preview`](../api/python.md#set_chat_previewenabled-surface_id-width). Settings appear in `/ui-config.json` as `chat.preview: { enabled, surfaceId, width }`.

## Agent integration

Agents should call **`send_a2ui_messages`** (from `praisonaiagents.tools.a2ui_tools`) with A2UI message dicts:

```python
send_a2ui_messages(messages=[
    {"createSurface": {"surfaceId": "main", "catalogId": "basic"}},
    {"updateComponents": {"components": [
        {"component": "Text", "text": {"literal": "Hello"}},
        {"component": "Button", "text": {"literal": "Submit"},
         "action": {"name": "handleSubmit"}},
    ]}},
])
```

Wrap the tool with **`coerce_a2ui_tool_messages`** so common LLM argument shapes still work:

```python
from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

@tool
def send_a2ui_messages(messages):
    coerced = coerce_a2ui_tool_messages(messages, surface_id="main")
    return sdk_send_a2ui(messages=coerced)
```

`coerce_a2ui_tool_messages` accepts:

- A JSON string or list of message dicts
- A dict with a `messages` key
- A bare `components` list (wrapped in `updateComponents`)
- A single component dict (wrapped in `updateComponents`)
- Missing `createSurface` (inserted automatically for the given `surface_id`)

Tool results are detected by [`a2ui_utils`](../../src/praisonaiui/a2ui_utils.py) and ingested into the surface store; connected clients receive WebSocket `a2ui_surface` events.

## HTTP API

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/api/surfaces` | List surfaces and message counts |
| `GET` | `/api/surfaces/{id}` | Surface state; **200 with `{ messages: [] }`** if not created yet (empty canvas is normal) |
| `POST` | `/api/surfaces/{id}/messages` | Append or replace messages (`replace: true` in body) |
| `POST` | `/api/surfaces/{id}/actions` | User action from a button/component |
| `DELETE` | `/api/surfaces/{id}` | Clear surface |

Realtime updates use the existing dashboard WebSocket (`a2ui_surface` payload).

## CLI

Manage surfaces against a running server (`--server` / `AIUI_SERVER`, default `http://127.0.0.1:8000`):

```bash
aiui surface list
aiui surface get main
aiui surface get main --json
aiui surface push main --file messages.json
aiui surface push main --file messages.json --replace
aiui surface clear main
aiui surface status
```

`messages.json` must contain `{ "messages": [ ... ] }`.

## Frontend modules

Shared dashboard JS (lazy-loaded with `chat-canvas`):

| Module | Role |
|--------|------|
| `surface-utils.js` | Load surface, WebSocket sync, post actions |
| `canvas-preview.js` | Right-hand preview panel |
| `a2ui-mapper.js` | Default DOM mapper (Text, Button, Column, Row, Card, …) |
| `plugins/views/chat-canvas.js` | Composes chat + preview without modifying `chat.js` |

Override rendering: `window.aiui.registerSurfaceRenderer("main", fn)`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Chat works but canvas stays empty | Agent did not call `send_a2ui_messages` | Strengthen instructions; wrap tool with `coerce_a2ui_tool_messages` |
| Tool error / invalid JSON | LLM passed wrong shape | Use coercion wrapper; include schema prompt from `praisonaiagents.ui.a2ui.adapter` |
| Preview shows raw JSON | Component type not in `a2ui-mapper` | Extend mapper or use supported components |
| `GET /api/surfaces/main` empty | Normal before first push | Push via agent or `aiui surface push` |
| Button click does nothing | No `@aiui.surface_action` handler | Register handler for that `surface_id` |

## Related

- [Agent UI host](agent-ui-host.md) — `registerSurfaceRenderer`, layout tiers
- [Python API — `set_chat_preview`](../api/python.md#set_chat_previewenabled-surface_id-width)
- [Python API — `@aiui.surface_action`](../api/python.md#aiuisurface_actionsurface_id)
