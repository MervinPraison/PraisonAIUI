---
title: Interactive Response Examples
nav_title: Response Examples
description: Live interactive simulations of every response type an AI agent can render when a user sends a message — KPIs, forms, approvals, charts, tables, workflows, boards, and copyable outputs.
---

# Interactive Agent Response Examples

When a user sends a message in Chat, an agent does not have to reply with plain text alone. Using **A2UI surfaces** (`a2ui_surface` / `send_a2ui_messages`) or **UI component blocks** (`aiui.*`), agents can stream rich interactive UI directly into the chat thread or split Canvas.

Every example below shows the **user prompt**, a **live interactive simulation** you can click and test right here, and the **code / A2UI JSON** that produces it.

## 1. KPI & System Health Card Response

**User sends:** `"Show today's system health and active traffic."`

<ComponentPreview title="Agent Response — KPI Dashboard">
[
  {
    "type": "stat_group",
    "stats": [
      {"type": "metric", "label": "Active Sessions", "value": "1,420", "delta": "+12.4%", "sparkline": [980, 1080, 1210, 1340, 1420]},
      {"type": "metric", "label": "P95 Latency", "value": "118 ms", "delta": "-14 ms", "sparkline": [148, 138, 130, 122, 118]},
      {"type": "metric", "label": "Success Rate", "value": "99.94%", "delta": "+0.08%"}
    ]
  },
  {"type": "alert", "variant": "success", "title": "All Systems Operational", "message": "4 worker pools healthy across us-east and eu-west."}
]
</ComponentPreview>

<Tabs>
<Tab title="A2UI v0.9 JSON">
```json
[
  {"createSurface": {"surfaceId": "health", "catalogId": "basic"}},
  {"updateComponents": {"surfaceId": "health", "components": [
    {"id": "root", "component": "Column", "children": ["h1", "row"]},
    {"id": "h1", "component": "Text", "text": "System Health", "variant": "h2"},
    {"id": "row", "component": "Row", "children": ["c1", "c2"]},
    {"id": "c1", "component": "Card", "child": "m1"},
    {"id": "m1", "component": "Text", "text": "Active Sessions: 1,420 (+12.4%)"},
    {"id": "c2", "component": "Card", "child": "m2"},
    {"id": "m2", "component": "Text", "text": "P95 Latency: 118 ms (-14 ms)"}
  ]}}
]
```
</Tab>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.layout([
    aiui.stat_group([
        aiui.metric("Active Sessions", value="1,420", delta="+12.4%", sparkline=[980, 1080, 1210, 1340, 1420]),
        aiui.metric("P95 Latency", value="118 ms", delta="-14 ms"),
    ]),
    aiui.alert("4 worker pools healthy.", variant="success", title="All Systems Operational"),
])
```
</Tab>
</Tabs>

## 2. Interactive Form & Parameter Tuning Surface

**User sends:** `"Let me configure my research agent's model, temperature, and memory."`

<ComponentPreview title="Agent Response — Interactive Configuration Form (try submitting)">
{
  "type": "form_action",
  "action": "save_agent_config",
  "submit_label": "Apply Settings",
  "children": [
    {"type": "select_input", "label": "Model", "options": ["gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet", "gemini-2.5-flash"], "value": "gpt-4o", "name": "model"},
    {"type": "slider_input", "label": "Temperature", "value": 0.3, "min_val": 0, "max_val": 1, "step": 0.1, "name": "temperature"},
    {"type": "switch_input", "label": "Enable cross-session memory", "checked": true, "name": "memory"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="A2UI v0.9 (Python)">
```python
import praisonaiui as aiui

msgs = aiui.a2ui_surface(
    surface_id="agent-config",
    components=[
        {"id": "root", "component": "Column", "children": ["model", "temp", "mem", "save"]},
        {"id": "model", "component": "ChoicePicker", "label": "Model", "value": {"path": "/model"},
         "options": [{"label": "gpt-4o", "value": "gpt-4o"}, {"label": "gpt-4o-mini", "value": "gpt-4o-mini"}]},
        {"id": "temp", "component": "Slider", "label": "Temperature", "min": 0, "max": 1, "value": {"path": "/temp"}},
        {"id": "mem", "component": "CheckBox", "label": "Enable memory", "value": {"path": "/memory"}},
        {"id": "save-txt", "component": "Text", "text": "Apply Settings"},
        {"id": "save", "component": "Button", "child": "save-txt", "variant": "primary",
         "action": {"event": {"name": "save_agent_config", "context": {"model": {"path": "/model"}}}}},
    ],
    data={"model": "gpt-4o", "temp": 0.3, "memory": True},
)
```
</Tab>
<Tab title="Action Handler">
```python
@aiui.surface_action("agent-config")
async def on_config(action: dict):
    aiui.push_notification("Agent updated", f"Saved {action.get('context')}", type="success")
    return {"ok": True}
```
</Tab>
</Tabs>

## 3. Human-in-the-Loop Approval + Diff Review Response

**User sends:** `"Deploy release v0.4.0 to production and scale to 4 replicas."`

<ComponentPreview title="Agent Response — HITL Approval Gate (click Approve or Deny)">
[
  {"type": "callout", "variant": "warning", "title": "Human Approval Required", "content": "Paused before calling `deploy_release` (**high risk**). A live alert was also pushed to the Notification Center."},
  {"type": "diff_viewer", "title": "deploy.yaml", "before_label": "Production", "after_label": "Proposed", "before": "release: v0.3.183\nreplicas: 2", "after": "release: v0.4.0\nreplicas: 4"},
  {"type": "button_group", "buttons": [
    {"label": "Approve & Deploy", "action": "approve_deploy", "variant": "primary"},
    {"label": "Deny", "action": "deny_deploy", "variant": "destructive"}
  ]}
]
</ComponentPreview>

See the full runnable combined dashboard in [34-hitl-approvals-and-notifications](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/34-hitl-approvals-and-notifications).

## 4. Chart & Searchable Data Table Response

**User sends:** `"Compare weekly agent runs and show per-agent stats."`

<ComponentPreview title="Agent Response — Analytics Chart & Table">
[
  {
    "type": "chart",
    "title": "Weekly Agent Runs",
    "chart_type": "bar",
    "x": "day",
    "y": ["runs"],
    "height": 200,
    "data": [
      {"day": "Mon", "runs": 140},
      {"day": "Tue", "runs": 210},
      {"day": "Wed", "runs": 265},
      {"day": "Thu", "runs": 230},
      {"day": "Fri", "runs": 310}
    ]
  },
  {
    "type": "table",
    "headers": ["Agent", "Model", "Runs", "Avg Latency"],
    "rows": [
      ["Researcher", "gpt-4o", 412, "118 ms"],
      ["Code Reviewer", "claude-3.7-sonnet", 295, "194 ms"],
      ["Docs Helper", "gpt-4o-mini", 448, "76 ms"]
    ],
    "searchable": true,
    "sortable": true
  }
]
</ComponentPreview>

## 5. Workflow Stepper, Activity Timeline & Knowledge Tree

**User sends:** `"Show my RAG ingestion pipeline status and indexed files."`

<ComponentPreview title="Agent Response — Pipeline Status & Source Tree">
[
  {
    "type": "stepper",
    "title": "RAG Ingestion Pipeline",
    "active": 2,
    "orientation": "horizontal",
    "steps": [
      {"label": "Fetch Docs", "description": "176 files"},
      {"label": "Chunk & Embed", "description": "1,420 vectors"},
      {"label": "Verify Recall", "description": "Running evals"},
      {"label": "Live Index", "description": "Pending"}
    ]
  },
  {
    "type": "tree_view",
    "title": "Indexed Sources",
    "default_expanded": true,
    "nodes": [
      {"label": "docs/a2ui/", "children": [{"label": "overview.md", "meta": "3.1 KB"}, {"label": "response-examples.md", "meta": "Live"}]},
      {"label": "docs/components/", "children": [{"label": "card.md", "meta": "1.6 KB"}, {"label": "chart.md", "meta": "2.4 KB"}]}
    ]
  }
]
</ComponentPreview>

## 6. Copyable Command, Masked Secret & Feedback Rating

**User sends:** `"Generate my quick-install command and staging webhook token."`

<ComponentPreview title="Agent Response — Copyable Outputs & Star Rating">
[
  {"type": "copy_field", "label": "Run A2UI Studio Example", "value": "cd examples/python/30-a2ui-canvas && python app.py", "secret": false},
  {"type": "copy_field", "label": "Staging Webhook Token", "value": "aiui_stg_7d9e2c1a4b6f8e0d", "secret": true},
  {"type": "rating_input", "label": "Was this response helpful?", "value": 5, "max_stars": 5, "readonly": false, "name": "feedback_rating"}
]
</ComponentPreview>

## Run the live A2UI Studio example

```bash
cd examples/python/30-a2ui-canvas
python app.py
```

Open `http://127.0.0.1:8099` to try split **Chat + Canvas**, full-page multi-surface **Canvas**, **Agent Canvas**, and **A2UI Settings & Catalog** side by side.
