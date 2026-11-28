# Pagination

> Interactive page navigation controls for server-paginated lists and tables.

`pagination()` renders previous/next controls, page numbers, and total item counts. Clicking a page dispatches an action payload (`{page, per_page}`) to your page action handler.

{
  "type": "pagination",
  "total": 120,
  "page": 2,
  "per_page": 20,
  "action": "paginate"
}

## Python

```python
import praisonaiui as aiui

aiui.pagination(total=120, page=2, per_page=20, action="paginate")
```

## YAML

```yaml
- type: pagination
  total: 120
  page: 2
  per_page: 20
  action: "paginate"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `total` | `int` | Total number of records across all pages. |
| `page` | `int` | Current 1-based page number. |
| `per_page` | `int` | Number of rows per page (default `20`). |
| `action` | `str` | Optional action name sent when the user changes page. |

## Related pages

- [Data Table](https://ui.praison.ai/docs/components/table.md)
- [Links & Page Navigation](https://ui.praison.ai/docs/components/links.md)
- [List Detail](https://ui.praison.ai/docs/components/list-detail.md)
