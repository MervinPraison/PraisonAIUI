---
title: Filter Bar
nav_title: Filter Bar
description: Compact inline filter bar with instant updates, active filter chips, and one-click reset.
---

# Filter Bar

`filter_bar()` places search, select, date, and toggle filters in a compact horizontal toolbar with removable active filter chips and URL query sync.

<ComponentPreview title="Interactive Filter Bar">
{
  "type": "filter_bar",
  "action": "filter_runs",
  "chips": true,
  "reset_label": "Reset",
  "defaults": {"status": "All", "q": ""},
  "children": [
    {"type": "select_input", "label": "Status", "options": ["All", "Success", "Failed"], "value": "All", "name": "status"},
    {"type": "text_input", "label": "Search", "value": "", "placeholder": "Filter agent runs...", "name": "q"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.filter_bar(
    "filter_runs",
    inputs=[
        aiui.select_input("Status", options=["All", "Success", "Failed"], value="All", name="status"),
        aiui.text_input("Search", placeholder="Filter agent runs...", name="q"),
    ],
    defaults={"status": "All", "q": ""},
    method="get",
    update_url=True,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: filter_bar
  action: "filter_runs"
  chips: true
  reset_label: "Reset"
  defaults: { status: "All", q: "" }
  children:
    - type: select_input
      label: "Status"
      options: ["All", "Success", "Failed"]
      value: "All"
      name: "status"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `action`, `inputs` | `str`, `list` | Action name and filter input components. |
| `chips`, `defaults`, `reset_label` | options | Show removable chips for non-default values and a Reset control. |
| `method`, `update_url` | options | Set `method="get"` and `update_url=True` to keep filters bookmarkable in the URL. |
