# Definition List

> Clean label-and-value summary list for metadata, environment specs, and inspection panels.

`definition_list()` (alias `key_value_list()`) formats structured key-value metadata cleanly across desktop and mobile widths.

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

## Python

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

## YAML

```yaml
- type: key_value_list
  title: "Runtime Environment"
  items:
    - label: "Package"
      value: "aiui (PraisonAIUI)"
    - label: "Server"
      value: "Starlette + Uvicorn"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Ordered `{label, value}` pairs. |
| `title` | `str` | Optional heading above the list. |

## Related pages

- [List Detail](https://ui.praison.ai/docs/components/list-detail.md)
- [Tabs](https://ui.praison.ai/docs/components/tabs.md)
- [Empty State](https://ui.praison.ai/docs/components/empty-state.md)
