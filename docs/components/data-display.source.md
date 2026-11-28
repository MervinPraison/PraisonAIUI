---
title: Data Display & Charts
nav_title: Data display & charts
description: Display KPIs, sparklines, sortable searchable tables, 10 interactive chart types, badges, progress bars, code and JSON.
---

# Data Display & Charts

Turn Python or YAML data into sortable tables, interactive theme-aware charts, KPI metrics, progress bars, and structured key-value views.

## Quick catalog

| Python builder | YAML `type` | What it renders |
|---|---|---|
| `aiui.metric(label, *, value, delta, delta_color, caption, sparkline, benchmark, benchmark_label)` | `metric` | KPI tile with colored delta, inline trend sparkline, and benchmark comparison |
| `aiui.stat_group(stats)` | `stat_group` | Compact multi-metric strip |
| `aiui.table(data=None, *, headers, rows, columns, searchable, sortable, page_size, row_detail, ...)` | `table` | Full data table (accepts pandas/Polars DataFrames, dict lists, or `headers`+`rows`): typed columns (`number`, `badge`, `tag`, `link`, `date`, `progress`, `image`, `sparkline`), search, sort, paging, and row detail drawer |
| `aiui.sheet(title, *, headers, rows, tabs, id, action, save_label)` | `sheet` | Interactive multi-tab spreadsheet with live cell editing, zero-eval formulas (`=SUM`, `=AVERAGE`, `=IF`), row filter, CSV/JSON export, and optional `action=` Save callback to Python |
| `aiui.whiteboard(items, *, title, id)` | `whiteboard` | Interactive whiteboard canvas with draggable stickies/shapes, live arrow tracking, `+ Sticky`, zoom, fullscreen, and SVG/JSON export |
| `aiui.chart(title, *, data, chart_type, x, y, y2, stacked, reference, facet, ...)` | `chart` | Lazy-loaded Recharts chart (accepts dict lists or pandas/Polars DataFrames): `bar`, `barh`, `line`, `area`, `scatter`, `pie`, `donut`, `histogram`, `heatmap`, `sparkline`, plus `facet` small multiples |
| `aiui.plotly_chart(fig, title="", *, height, caption)` | `chart` | Converts standard Plotly figures (bar, line, area, scatter, pie/donut, histogram, heatmap) into native Recharts `chart` blocks without bundling `plotly.js` |
| `aiui.badge(text, *, variant)` | `badge` | Status pill (`default`, `secondary`, `destructive`, `outline`) |
| `aiui.caption(text)` | `caption` | Muted helper or footnote line |
| `aiui.progress_bar(label, *, value, max_value=100)` | `progress_bar` | Labeled progress indicator |
| `aiui.key_value_list(items, *, title)` | `key_value_list` | Clean two-column key/value table |
| `aiui.definition_list(items, *, title)` | `definition_list` | Structured label/value definition list |
| `aiui.code_block(code, *, language)` | `code_block` | Syntax-highlighted code with copy button |
| `aiui.diff_viewer(before, after, *, title, before_label, after_label)` | `diff_viewer` | Line-by-line unified diff viewer for prompts, configs and generated code |
| `aiui.copy_field(value, *, label, secret=False)` | `copy_field` | Copyable command, URL or API key box with optional secret reveal toggle |
| `aiui.json_view(data, *, title, collapsed)` | `json_view` | Collapsible JSON inspector |
| `aiui.avatar(*, src, name, fallback, size)` | `avatar` | User or agent avatar image/initials |

## Examples

<Tabs>
<Tab title="Python">
```python
return aiui.layout([
    aiui.columns([
        aiui.metric("Weekly Active", value="12.4k", delta="+14%", sparkline=[9100, 10200, 11500, 12400]),
        aiui.metric("Error Rate", value="0.12%", delta="-0.08%", delta_color="inverse"),
        aiui.metric("Latency", value=42, benchmark=100, benchmark_label="SLA ms", delta_color="inverse"),
    ]),
    aiui.chart(
        "Requests by Day",
        chart_type="line",
        data=[{"day": "Mon", "reqs": 4200}, {"day": "Tue", "reqs": 5100}, {"day": "Wed", "reqs": 4890}],
        x="day",
        y="reqs",
        y_format="compact",
    ),
    aiui.table(
        columns=[
            {"key": "service", "label": "Service", "type": "text"},
            {"key": "latency", "label": "p95 (ms)", "type": "number", "tone_below": 50},
            {"key": "status", "label": "Status", "type": "badge", "tones": {"ok": "success", "degraded": "warning"}},
        ],
        rows=[
            {"service": "Chat Gateway", "latency": 18, "status": "ok"},
            {"service": "Vector Search", "latency": 44, "status": "ok"},
        ],
        searchable=True,
        row_detail=True,
    ),
])
```
</Tab>
<Tab title="YAML">
```yaml
components:
  - type: table
    searchable: true
    columns:
      - { key: "name", label: "Model", type: "text" }
      - { key: "tokens", label: "Tokens", type: "number", format: "compact" }
      - { key: "status", label: "State", type: "badge", tones: { active: "success" } }
    rows:
      - { name: "gpt-4o-mini", tokens: 1250000, status: "active" }
```
</Tab>
</Tabs>

See the full [Component API Reference](../api/components.md#aiuitable-headers-rows-columnsnone) for all column formatters and chart parameters.
