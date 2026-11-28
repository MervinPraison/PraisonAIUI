# Metric & Stat Group

> KPI cards with trend deltas, inline sparklines, benchmarks, and stat grids.

Display headline KPIs with `metric()` (including optional delta indicators, sparklines, and target benchmarks) and group multiple metrics in a responsive row with `stat_group()`.

{
  "type": "stat_group",
  "stats": [
    {"type": "metric", "label": "Active Users", "value": "1,420", "delta": "+12.4%", "sparkline": [980, 1060, 1180, 1290, 1340, 1420]},
    {"type": "metric", "label": "P95 Latency", "value": "118 ms", "delta": "-14 ms", "sparkline": [148, 140, 132, 126, 121, 118]},
    {"type": "metric", "label": "Token Spend", "value": "$312", "delta": "+4%", "caption": "Monthly budget $500"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.stat_group([
    aiui.metric("Active Users", value="1,420", delta="+12.4%", sparkline=[980, 1060, 1180, 1290, 1340, 1420]),
    aiui.metric("P95 Latency", value="118 ms", delta="-14 ms"),
    aiui.metric("Token Spend", value="$312", delta="+4%", caption="Monthly budget $500"),
])
```

## YAML

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

## Props

| Component | Parameter | Description |
|---|---|---|
| `metric` | `label`, `value`, `delta`, `delta_color`, `sparkline`, `benchmark`, `caption`, `help` | Single KPI tile with optional trend badge, sparkline series, and helper tooltip. |
| `stat_group` | `stats` | Responsive grid wrapper accepting a list of `metric()` dicts. |

## Related pages

- [Data Display & Charts](https://ui.praison.ai/docs/components/data-display.md)
- [Card & Card Grid](https://ui.praison.ai/docs/components/card.md)
- [Button Group](https://ui.praison.ai/docs/components/button-group.md)
