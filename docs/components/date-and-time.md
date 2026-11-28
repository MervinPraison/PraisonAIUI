# Date, Time & Date Range

> Native date, time, and preset-powered date range pickers for schedules and analytics.

Capture single dates with `date_input()`, clock times with `time_input()`, and analytics windows with preset buttons using `date_range_input()`.

[
  {"type": "columns", "children": [
    {"type": "date_input", "label": "Start Date", "value": "2026-11-01", "name": "start"},
    {"type": "time_input", "label": "Daily Schedule", "value": "09:00", "name": "run_at"}
  ]},
  {"type": "date_range_input", "name": "period", "label": "Analytics Period", "start": "2026-11-01", "end": "2026-11-27", "presets": [7, 30, 90]}
]

## Python

```python
import praisonaiui as aiui

aiui.date_input("Start Date", value="2026-11-01", name="start")
aiui.time_input("Daily Schedule", value="09:00", name="run_at")
aiui.date_range_input("period", label="Analytics Period", start="2026-11-01", end="2026-11-27", presets=[7, 30, 90])
```

## YAML

```yaml
- type: date_input
  label: "Start Date"
  value: "2026-11-01"
  name: "start"
- type: date_range_input
  name: "period"
  label: "Analytics Period"
  presets: [7, 30, 90]
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `date_input` | `label`, `value`, `name`, `auto_submit` | ISO date picker (`YYYY-MM-DD`). |
| `time_input` | `label`, `value`, `name`, `auto_submit` | Time picker (`HH:MM`). |
| `date_range_input` | `name`, `label`, `start`, `end`, `presets`, `auto_submit` | Start/end range inputs plus quick preset buttons (e.g., `[7, 30, 90]`). |

## Related pages

- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
- [Slider Input](https://ui.praison.ai/docs/components/slider-input.md)
- [Color Picker & Rating Input](https://ui.praison.ai/docs/components/color-and-rating.md)
