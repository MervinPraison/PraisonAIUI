---
nav_title: All-in-One Playground
description: Run and test every A2UI feature, setting, protocol version, and multi-surface flow in one complete example.
---

# All-in-One A2UI Playground

Want to test **every A2UI feature in one place**—on the same page, across multiple pages, from Python, from the CLI, and via HTTP? Run the bundled showcase example:

```bash
python examples/python/30-a2ui-canvas/app.py
```

Source: [`examples/python/30-a2ui-canvas/app.py`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/30-a2ui-canvas/app.py)

## What you can try immediately

| Route / Page | What to test |
|---|---|
| `/chat-canvas` | Ask an agent to generate UI in chat while watching the live A2UI preview panel on the right |
| `/canvas` | Full-screen A2UI canvas with a **Surface switcher** dropdown to flip between multiple surfaces on one page |
| `/agent-canvas` | Interactive Basic Catalog demo (`Card`, `Text`, `Divider`, `TextField`, `CheckBox`, `Slider`, `Row`, `Button`) with live `updateDataModel` and `@aiui.surface_action` |
| `/a2ui-settings` | Live view of `GET /api/surfaces/capabilities` showing all 18 components, 14 functions, and supported protocol versions |

## Test 1 — Push a second surface and switch live on `/canvas`

While the server is running on port `8099`, push a brand-new surface `"checkout"` via `curl`:

```bash
curl -X POST http://127.0.0.1:8099/api/surfaces/checkout/messages \
  -H "Content-Type: application/json" \
  -d '{
    "replace": true,
    "messages": [
      {"version": "v0.9", "createSurface": {"surfaceId": "checkout", "catalogId": "basic", "theme": {"primaryColor": "#0f766e"}}},
      {"version": "v0.9", "updateComponents": {"surfaceId": "checkout", "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["hdr", "picker", "pay"]},
        {"id": "hdr", "component": "Text", "text": {"path": "/title"}, "variant": "h2"},
        {"id": "picker", "component": "ChoicePicker", "label": "Plan", "value": {"path": "/plan"},
         "options": [{"label": "Monthly ($19)", "value": "monthly"}, {"label": "Annual ($190)", "value": "annual"}]},
        {"id": "pay-lbl", "component": "Text", "text": "Continue"},
        {"id": "pay", "component": "Button", "child": "pay-lbl", "variant": "primary",
         "action": {"event": {"name": "checkout_submit", "context": {"plan": {"path": "/plan"}}}}}
      ]}},
      {"version": "v0.9", "updateDataModel": {"surfaceId": "checkout", "path": "/", "value": {"title": "Upgrade Plan", "plan": "annual"}}}
    ]
  }'
```

Open `/canvas`, click **Refresh**, and pick **`checkout`** from the **Surface** selector—or open `/canvas?surface=checkout` directly.

## Test 2 — Verify v0.8 backwards compatibility

Push a legacy **v0.8** payload (`surfaceUpdate` + `dataModelUpdate` + `beginRendering`) to surface `"legacy"`:

```bash
curl -X POST http://127.0.0.1:8099/api/surfaces/legacy/messages \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"surfaceUpdate": {"surfaceId": "legacy", "components": [
        {"id": "hero", "component": {"Text": {"text": {"path": "/headline"}, "usageHint": "h1"}}}
      ]}},
      {"dataModelUpdate": {"surfaceId": "legacy", "path": "/", "contents": [
        {"key": "headline", "valueString": "Upgraded automatically from A2UI v0.8!"}
      ]}},
      {"beginRendering": {"surfaceId": "legacy", "root": "hero"}}
    ]
  }'
```

PraisonAIUI automatically upgrades it to v0.9 and renders it on `/canvas?surface=legacy`.

## Test 3 — Stream JSONL with the CLI

```bash
cat <<'EOF' > demo.jsonl
{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"basic"}}
{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Text","text":{"path":"/msg"},"variant":"h2"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"main","path":"/","value":{"msg":"Streamed from JSONL!"}}}
EOF

aiui surface push main --file demo.jsonl --replace --server http://127.0.0.1:8099
aiui surface capabilities --server http://127.0.0.1:8099
```

## Test 4 — Clear a surface with `deleteSurface`

```bash
curl -X POST http://127.0.0.1:8099/api/surfaces/legacy/messages \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"version": "v0.9", "deleteSurface": {"surfaceId": "legacy"}}]}'
```
