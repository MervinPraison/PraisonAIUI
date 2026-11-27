---
title: Tabs
nav_title: Tabs
description: Switch between panels of components with keyboard navigation and optional lazy loading.
---

# Tabs

Organize parallel views on one page with `tabs()`. Supports arrow-key navigation and optional `lazy=True` per-tab loading.

<ComponentPreview title="Tabs">
{
  "type": "tabs",
  "items": [
    {
      "label": "Overview",
      "children": [
        {"type": "metric", "label": "Requests Today", "value": "18,420", "delta": "+9.4%"}
      ]
    },
    {
      "label": "Configuration",
      "children": [
        {"type": "key_value_list", "items": [{"label": "Model", "value": "gpt-4o"}, {"label": "Timeout", "value": "30s"}]}
      ]
    },
    {
      "label": "Status",
      "children": [
        {"type": "alert", "variant": "success", "message": "All 4 workers healthy."}
      ]
    }
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.tabs(
    [
        {"label": "Overview", "children": [aiui.metric("Requests Today", value="18,420", delta="+9.4%")]},
        {"label": "Configuration", "children": [aiui.definition_list([{"label": "Model", "value": "gpt-4o"}])]},
        {"label": "Status", "children": [aiui.alert("All 4 workers healthy.", variant="success")]},
    ],
    lazy=False,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: tabs
  items:
    - label: "Overview"
      children:
        - type: metric
          label: "Requests Today"
          value: "18,420"
          delta: "+9.4%"
    - label: "Status"
      children:
        - type: alert
          variant: "success"
          message: "All 4 workers healthy."
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Each tab item has `label` and `children` (or `load` URL for lazy fetching). |
| `lazy` | `bool` | Defer mounting hidden tab bodies until first opened. |
