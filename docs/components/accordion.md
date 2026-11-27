---
title: Accordion & Expander
nav_title: Accordion & Expander
description: Progressive disclosure panels for FAQs, nested settings, and optional lazy sections.
---

# Accordion & Expander

Use `accordion()` for stacked FAQ or detail items, and `expander()` for a single collapsible disclosure block containing arbitrary child components.

<ComponentPreview title="Accordion & Expander">
[
  {
    "type": "accordion",
    "items": [
      {"title": "How does token streaming work?", "content": "Handlers call aiui.stream_token() and chunks stream live over WebSocket or SSE."},
      {"title": "Can I build pages without Python?", "content": "Yes — declare pages and components directly in app.yaml."}
    ]
  },
  {
    "type": "expander",
    "title": "Advanced retry policy",
    "expanded": true,
    "children": [
      {"type": "key_value_list", "items": [{"label": "Max Retries", "value": "3"}, {"label": "Backoff", "value": "Exponential"}]}
    ]
  }
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.accordion([
    {"title": "How does token streaming work?", "content": "Tokens stream over WebSocket or SSE."},
    {"title": "Can I build pages without Python?", "content": "Declare pages directly in app.yaml."},
])

aiui.expander(
    "Advanced retry policy",
    children=[aiui.definition_list([{"label": "Max Retries", "value": "3"}])],
    expanded=True,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: accordion
  items:
    - title: "How does token streaming work?"
      content: "Tokens stream over WebSocket or SSE."
- type: expander
  title: "Advanced retry policy"
  expanded: true
  children:
    - type: text
      content: "Max retries: 3 (exponential backoff)."
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `accordion` | `items` | List of `{title, content}` or `{title, children}` sections. |
| `expander` | `title`, `children`, `expanded`, `lazy`, `load` | Single collapsible panel; set `lazy=True` or `load="/api/..."` to defer heavy content. |
