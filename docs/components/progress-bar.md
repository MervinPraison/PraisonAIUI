# Progress Bar

> Determinate progress indicator for indexing jobs, batch runs, and quota meters.

`progress_bar()` visualizes determinate completion against `max_value` (default `100`) with an accessible `role="progressbar"`.

[
  {"type": "progress_bar", "label": "Knowledge base indexing", "value": 74, "max_value": 100},
  {"type": "progress_bar", "label": "Monthly API quota (312 / 500)", "value": 312, "max_value": 500}
]

## Python

```python
import praisonaiui as aiui

aiui.progress_bar("Knowledge base indexing", value=74, max_value=100)
aiui.progress_bar("Monthly API quota", value=312, max_value=500)
```

## YAML

```yaml
- type: progress_bar
  label: "Knowledge base indexing"
  value: 74
  max_value: 100
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `label` | `str` | Descriptive caption above the bar. |
| `value`, `max_value` | `number` | Current value and maximum scale (default `100`). |

## Related pages

- [Badge & Status](https://ui.praison.ai/docs/components/badge.md)
- [Data Display & Charts](https://ui.praison.ai/docs/components/data-display.md)
- [Protocol Architecture Reference](https://ui.praison.ai/docs/features/protocol-architecture.md)
