---
title: Badge & Status
nav_title: Badge & Status
description: Compact inline labels and live job status rows with state icons, progress, and log tails.
---

# Badge & Status

Use `badge()` for compact state pills (`default`, `success`, `warning`, `error`, `info`) and `status()` for live background task rows with progress bars and expandable log tails.

<ComponentPreview title="Badges & Job Status">
[
  {"type": "columns", "children": [
    {"type": "badge", "text": "Production", "variant": "success"},
    {"type": "badge", "text": "Beta", "variant": "info"},
    {"type": "badge", "text": "Rate Limited", "variant": "warning"},
    {"type": "badge", "text": "Offline", "variant": "error"}
  ]},
  {"type": "status", "label": "Indexing knowledge base", "state": "running", "detail": "420 / 500 docs embedded", "progress": 84},
  {"type": "status", "label": "Nightly eval suite", "state": "done", "detail": "98.6% pass rate across 140 prompts"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.badge("Production", variant="success")
aiui.status(
    "Indexing knowledge base",
    state="running",
    detail="420 / 500 docs embedded",
    progress=84,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: badge
  text: "Production"
  variant: "success"
- type: status
  label: "Indexing knowledge base"
  state: "running"
  detail: "420 / 500 docs embedded"
  progress: 84
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `badge` | `text`, `variant` | Label text and tone (`default`, `success`, `warning`, `error`, `info`). |
| `status` | `label`, `state`, `detail`, `progress`, `log` | Job label, state (`idle`, `running`, `done`, `error`), detail string, 0–100 progress, and optional log lines. |
