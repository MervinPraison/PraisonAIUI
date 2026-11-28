# Chart

> Interactive Recharts visualizations across 10 chart kinds with theme colors and tooltips.

`chart()` renders responsive browser charts (lazy-loaded so pages without charts pay zero JS cost) supporting `line`, `bar`, `barh`, `area`, `pie`, `scatter`, `histogram`, `heatmap`, `sparkline`, and small-multiple `facet` grids.

[
  {
    "type": "chart",
    "title": "Weekly Agent Runs",
    "chart_type": "bar",
    "x": "day",
    "y": ["runs"],
    "height": 220,
    "data": [
      {"day": "Mon", "runs": 120},
      {"day": "Tue", "runs": 185},
      {"day": "Wed", "runs": 240},
      {"day": "Thu", "runs": 210},
      {"day": "Fri", "runs": 295}
    ]
  },
  {
    "type": "chart",
    "title": "Success Rate Trend",
    "chart_type": "area",
    "x": "day",
    "y": ["rate"],
    "height": 180,
    "data": [
      {"day": "Mon", "rate": 98.4},
      {"day": "Tue", "rate": 99.1},
      {"day": "Wed", "rate": 99.5},
      {"day": "Thu", "rate": 99.3},
      {"day": "Fri", "rate": 99.8}
    ]
  }
]

## Python

```python
import praisonaiui as aiui

aiui.chart(
    "Weekly Agent Runs",
    data=[
        {"day": "Mon", "runs": 120},
        {"day": "Tue", "runs": 185},
        {"day": "Wed", "runs": 240},
    ],
    chart_type="bar",
    x="day",
    y="runs",
    height=220,
)
```

## YAML

```yaml
- type: chart
  title: "Weekly Agent Runs"
  chart_type: "bar"
  x: "day"
  y: ["runs"]
  height: 220
  data:
    - { day: "Mon", runs: 120 }
    - { day: "Tue", runs: 185 }
    - { day: "Wed", runs: 240 }
```

## DataFrame input & Plotly compatibility

`aiui.chart(..., data=df)` accepts pandas and Polars DataFrames directly (duck-typed without importing them). If you already build Plotly figures, `aiui.plotly_chart(fig)` converts standard Plotly traces (`bar`, `barh`, `scatter`/`scattergl` line/area/scatter, `pie`/`donut`, `histogram`, `heatmap`) into native Recharts `chart` blocks without bundling `plotly.js`:

```python
aiui.chart("Weekly Runs", data=df, chart_type="bar", x="day", y="runs")
aiui.plotly_chart(fig, title="Revenue Breakdown")
```

Both work on `@aiui.page` and inline in chat via `await aiui.send_block(...)`.

## Props

| Parameter | Type | Description |
|---|---|---|
| `title`, `data` | `str`, `list[dict]` / DataFrame | Chart heading and row-oriented data records (or pandas/Polars DataFrame). |
| `chart_type` | `str` | `bar`, `barh`, `line`, `area`, `pie`, `donut`, `scatter`, `histogram`, `heatmap`, or `sparkline`. |
| `x`, `y`, `y2`, `stacked` | `str` / `list` / `bool` | Axis keys, secondary axis, and stacked bar/area mode. |
| `x_domain`, `y_domain`, `x_scale`, `y_scale`, `facet` | options | Custom domains, `log` scales, reference lines, and faceted small multiples. |

## Related pages

- [Data Display & Charts](https://ui.praison.ai/docs/components/data-display.md)
- [Data Table](https://ui.praison.ai/docs/components/table.md)
- [Interactive Response Examples](https://ui.praison.ai/docs/a2ui/response-examples.md)
