---
title: Columns, Container & Layout
nav_title: Columns & Layout
description: Compose responsive multi-column grids, titled sections, and auto-refreshing page layouts.
---

# Columns, Container & Layout

Arrange components side-by-side with `columns()`, group related blocks under a heading with `container()`, and wrap an entire page with `layout()`.

<ComponentPreview title="Container + Columns">
{
  "type": "container",
  "title": "System Overview",
  "children": [
    {
      "type": "columns",
      "children": [
        {"type": "card", "title": "P95 Latency", "value": "142 ms", "footer": "Last 15 min"},
        {"type": "card", "title": "Success Rate", "value": "99.94%", "footer": "84,210 requests"},
        {"type": "card", "title": "Active Workers", "value": "12", "footer": "3 regions"}
      ]
    }
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

@aiui.page("overview", title="Overview")
async def overview():
    return aiui.layout(
        [
            aiui.container(
                [
                    aiui.columns([
                        aiui.card("P95 Latency", value="142 ms"),
                        aiui.card("Success Rate", value="99.94%"),
                    ])
                ],
                title="System Overview",
            )
        ],
        refresh_every=30,
    )
```
</Tab>
<Tab title="YAML">
```yaml
- type: container
  title: "System Overview"
  children:
    - type: columns
      children:
        - type: card
          title: "P95 Latency"
          value: "142 ms"
        - type: card
          title: "Success Rate"
          value: "99.94%"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `layout` | `children`, `refresh_every`, `params`, `badges`, `notifications` | Top-level page wrapper with optional polling interval (seconds) and sidebar badges. |
| `columns` | `children` | Evenly spaced responsive grid; collapses cleanly on narrow viewports. |
| `container` | `children`, `title` | Bordered/grouped section with an optional section heading. |
