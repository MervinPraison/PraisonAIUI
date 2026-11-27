---
title: Pagination
nav_title: Pagination
description: Interactive page navigation controls for server-paginated lists and tables.
---

# Pagination

`pagination()` renders previous/next controls, page numbers, and total item counts. Clicking a page dispatches an action payload (`{page, per_page}`) to your page action handler.

<ComponentPreview title="Pagination (click a page number)">
{
  "type": "pagination",
  "total": 120,
  "page": 2,
  "per_page": 20,
  "action": "paginate"
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.pagination(total=120, page=2, per_page=20, action="paginate")
```
</Tab>
<Tab title="YAML">
```yaml
- type: pagination
  total: 120
  page: 2
  per_page: 20
  action: "paginate"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `total` | `int` | Total number of records across all pages. |
| `page` | `int` | Current 1-based page number. |
| `per_page` | `int` | Number of rows per page (default `20`). |
| `action` | `str` | Optional action name sent when the user changes page. |
