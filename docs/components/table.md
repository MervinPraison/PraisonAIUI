---
title: Data Table
nav_title: Table
description: Sortable, searchable, paginated data table with typed columns, badges, and row details.
---

# Data Table

`table()` renders a full-featured interactive table with live search, column sorting, pagination, numeric thresholds, row links, and slide-over detail drawers.

<ComponentPreview title="Searchable & Sortable Table">
{
  "type": "table",
  "headers": ["Agent", "Model", "Runs (24h)", "Status"],
  "rows": [
    ["Researcher", "gpt-4o", 412, "Online"],
    ["Code Reviewer", "claude-3.7-sonnet", 198, "Online"],
    ["Docs Assistant", "gpt-4o-mini", 845, "Online"],
    ["Triage Bot", "gemini-2.5-flash", 63, "Idle"]
  ],
  "searchable": true,
  "sortable": true,
  "page_size": 10
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.table(
    headers=["Agent", "Model", "Runs (24h)", "Status"],
    rows=[
        ["Researcher", "gpt-4o", 412, "Online"],
        ["Code Reviewer", "claude-3.7-sonnet", 198, "Online"],
    ],
    searchable=True,
    sortable=True,
    page_size=10,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: table
  headers: ["Agent", "Model", "Runs (24h)", "Status"]
  rows:
    - ["Researcher", "gpt-4o", 412, "Online"]
    - ["Code Reviewer", "claude-3.7-sonnet", 198, "Online"]
  searchable: true
  sortable: true
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `headers`, `rows` | `list` | Column headers and row values (arrays or dicts when `columns` is supplied). |
| `columns` | `list[dict]` | Typed column specs (`key`, `label`, `type`: `badge`, `number`, `date`, `sparkline`, `thresholds`). |
| `searchable`, `sortable`, `page_size` | `bool` / `int` | Client-side search box, header sorting, and page size. |
| `row_detail`, `actions` | `dict` / `list` | Row detail drawer template and per-row action buttons. |
