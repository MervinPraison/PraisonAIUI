---
title: Definition List
nav_title: Definition List
description: Clean label-and-value summary list for metadata, environment specs, and inspection panels.
---

# Definition List

`definition_list()` (alias `key_value_list()`) formats structured key-value metadata cleanly across desktop and mobile widths.

<ComponentPreview title="Definition List">
{
  "type": "key_value_list",
  "title": "Runtime Environment",
  "items": [
    {"label": "Package", "value": "aiui (PraisonAIUI)"},
    {"label": "Server", "value": "Starlette + Uvicorn"},
    {"label": "Default Shell", "value": "React App Shell (style: app)"},
    {"label": "Auth Mode", "value": "Bearer token + WebSocket tickets"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.definition_list(
    [
        {"label": "Package", "value": "aiui (PraisonAIUI)"},
        {"label": "Server", "value": "Starlette + Uvicorn"},
        {"label": "Default Shell", "value": "React App Shell (style: app)"},
    ],
    title="Runtime Environment",
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: key_value_list
  title: "Runtime Environment"
  items:
    - label: "Package"
      value: "aiui (PraisonAIUI)"
    - label: "Server"
      value: "Starlette + Uvicorn"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Ordered `{label, value}` pairs. |
| `title` | `str` | Optional heading above the list. |
