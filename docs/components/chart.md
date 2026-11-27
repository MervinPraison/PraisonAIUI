---
title: Chart
nav_title: Chart
description: Interactive Recharts visualizations across 10 chart kinds with theme colors and tooltips.
---

# Chart

`chart()` renders responsive browser charts (lazy-loaded so pages without charts pay zero JS cost) supporting `line`, `bar`, `barh`, `area`, `pie`, `scatter`, `histogram`, `heatmap`, `sparkline`, and small-multiple `facet` grids.

<ComponentPreview title="Interactive Bar & Line Charts">
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
</ComponentPreview>

<Tabs>
<Tab title="Python">
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
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `title`, `data` | `str`, `list[dict]` | Chart heading and row-oriented data records. |
| `chart_type` | `str` | `bar`, `barh`, `line`, `area`, `pie`, `scatter`, `histogram`, `heatmap`, or `sparkline`. |
| `x`, `y`, `y2`, `stacked` | `str` / `list` / `bool` | Axis keys, secondary axis, and stacked bar/area mode. |
| `x_domain`, `y_domain`, `x_scale`, `y_scale`, `facet` | options | Custom domains, `log` scales, reference lines, and faceted small multiples. |
