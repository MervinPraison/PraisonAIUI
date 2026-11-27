---
title: Metric & Stat Group
nav_title: Metric & Stats
description: KPI cards with trend deltas, inline sparklines, benchmarks, and stat grids.
---

# Metric & Stat Group

Display headline KPIs with `metric()` (including optional delta indicators, sparklines, and target benchmarks) and group multiple metrics in a responsive row with `stat_group()`.

<ComponentPreview title="Stat Group with Sparklines">
{
  "type": "stat_group",
  "stats": [
    {"type": "metric", "label": "Active Users", "value": "1,420", "delta": "+12.4%", "sparkline": [980, 1060, 1180, 1290, 1340, 1420]},
    {"type": "metric", "label": "P95 Latency", "value": "118 ms", "delta": "-14 ms", "sparkline": [148, 140, 132, 126, 121, 118]},
    {"type": "metric", "label": "Token Spend", "value": "$312", "delta": "+4%", "caption": "Monthly budget $500"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.stat_group([
    aiui.metric("Active Users", value="1,420", delta="+12.4%", sparkline=[980, 1060, 1180, 1290, 1340, 1420]),
    aiui.metric("P95 Latency", value="118 ms", delta="-14 ms"),
    aiui.metric("Token Spend", value="$312", delta="+4%", caption="Monthly budget $500"),
])
```
</Tab>
<Tab title="YAML">
```yaml
- type: stat_group
  stats:
    - type: metric
      label: "Active Users"
      value: "1,420"
      delta: "+12.4%"
      sparkline: [980, 1060, 1180, 1290, 1340, 1420]
    - type: metric
      label: "P95 Latency"
      value: "118 ms"
      delta: "-14 ms"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `metric` | `label`, `value`, `delta`, `delta_color`, `sparkline`, `benchmark`, `caption`, `help` | Single KPI tile with optional trend badge, sparkline series, and helper tooltip. |
| `stat_group` | `stats` | Responsive grid wrapper accepting a list of `metric()` dicts. |
