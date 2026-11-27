---
title: List Detail
nav_title: List Detail
description: Searchable master-detail table with an interactive side inspector panel.
---

# List Detail

`list_detail()` pairs a searchable list with a side detail inspector. Click any row below to inspect its structured facts.

<ComponentPreview title="List Detail (click a row)">
{
  "type": "list_detail",
  "title": "Registered Agents",
  "search": true,
  "columns": [
    {"key": "name", "label": "Agent"},
    {"key": "status", "label": "Status"}
  ],
  "rows": [
    {"id": "1", "name": "Support Bot", "status": "Active", "detail": {"Model": "gpt-4o-mini", "Latency": "94 ms", "Tools": "docs_search, create_ticket"}},
    {"id": "2", "name": "Code Reviewer", "status": "Active", "detail": {"Model": "claude-3.7-sonnet", "Latency": "210 ms", "Tools": "git_diff, run_tests"}},
    {"id": "3", "name": "Release Manager", "status": "Idle", "detail": {"Model": "gpt-4o", "Latency": "140 ms", "Tools": "check_ci, trigger_release"}}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.list_detail(
    [
        {"id": "1", "name": "Support Bot", "status": "Active", "detail": {"Model": "gpt-4o-mini", "Latency": "94 ms"}},
        {"id": "2", "name": "Code Reviewer", "status": "Active", "detail": {"Model": "claude-3.7-sonnet", "Latency": "210 ms"}},
    ],
    columns=["name", "status"],
    title="Registered Agents",
    search=True,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: list_detail
  title: "Registered Agents"
  search: true
  columns: ["name", "status"]
  rows:
    - id: "1"
      name: "Support Bot"
      status: "Active"
      detail:
        Model: "gpt-4o-mini"
        Latency: "94 ms"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `rows` | `list[dict]` | Row objects with `id`, column values, and optional `detail` key-value dict. |
| `columns` | `list` | Column names or `{key, label, align}` definitions. |
| `title`, `search`, `page_size`, `empty` | options | Panel label, search box toggle, page size (default `25`), and empty state message. |
