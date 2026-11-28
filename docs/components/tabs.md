# Tabs

> Switch between panels of components with keyboard navigation and optional lazy loading.

Organize parallel views on one page with `tabs()`. Supports arrow-key navigation and optional `lazy=True` per-tab loading.

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

## Python

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

## YAML

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

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Each tab item has `label` and `children` (or `load` URL for lazy fetching). |
| `lazy` | `bool` | Defer mounting hidden tab bodies until first opened. |

## Related pages

- [Accordion & Expander](https://ui.praison.ai/docs/components/accordion.md)
- [Layout & Navigation Components](https://ui.praison.ai/docs/components/layout.md)
- [Select Input](https://ui.praison.ai/docs/components/select-input.md)
