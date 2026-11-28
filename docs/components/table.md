# Data Table

> Sortable, searchable, paginated data table with typed columns, badges, and row details.

`table()` renders a full-featured interactive table with live search, column sorting, pagination, numeric thresholds, row links, and slide-over detail drawers.

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

## Python

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

## YAML

```yaml
- type: table
  headers: ["Agent", "Model", "Runs (24h)", "Status"]
  rows:
    - ["Researcher", "gpt-4o", 412, "Online"]
    - ["Code Reviewer", "claude-3.7-sonnet", 198, "Online"]
  searchable: true
  sortable: true
```

## DataFrame & list-of-dicts shorthand

Pass a **pandas** or **Polars** DataFrame (duck-typed with zero extra imports), or a list of dicts, straight to `aiui.table(df)` — works both on `@aiui.page` and inline in chat via `await aiui.send_block(aiui.table(df))`:

```python
aiui.table(df, searchable=True)
aiui.table([{"Region": "US", "Revenue": 42000}, {"Region": "EU", "Revenue": 31000}], searchable=True)
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `data` | DataFrame / `list[dict]` | Optional positional pandas/Polars DataFrame or list of dict rows (infers headers automatically). |
| `headers`, `rows` | `list` | Column headers and row values (arrays or dicts when `columns` is supplied). |
| `columns` | `list[dict]` | Typed column specs (`key`, `label`, `type`: `badge`, `number`, `date`, `sparkline`, `thresholds`). |
| `searchable`, `sortable`, `page_size` | `bool` / `int` | Client-side search box, header sorting, and page size. |
| `row_detail`, `actions` | `dict` / `list` | Row detail drawer template and per-row action buttons. |

## Related pages

- [List Detail](https://ui.praison.ai/docs/components/list-detail.md)
- [Data Display & Charts](https://ui.praison.ai/docs/components/data-display.md)
- [Pagination](https://ui.praison.ai/docs/components/pagination.md)
