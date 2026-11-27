---
title: Date, Time & Date Range
nav_title: Date & Time
description: Native date, time, and preset-powered date range pickers for schedules and analytics.
---

# Date, Time & Date Range

Capture single dates with `date_input()`, clock times with `time_input()`, and analytics windows with preset buttons using `date_range_input()`.

<ComponentPreview title="Date, Time & Date Range Pickers">
[
  {"type": "columns", "children": [
    {"type": "date_input", "label": "Start Date", "value": "2026-11-01", "name": "start"},
    {"type": "time_input", "label": "Daily Schedule", "value": "09:00", "name": "run_at"}
  ]},
  {"type": "date_range_input", "name": "period", "label": "Analytics Period", "start": "2026-11-01", "end": "2026-11-27", "presets": [7, 30, 90]}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.date_input("Start Date", value="2026-11-01", name="start")
aiui.time_input("Daily Schedule", value="09:00", name="run_at")
aiui.date_range_input("period", label="Analytics Period", start="2026-11-01", end="2026-11-27", presets=[7, 30, 90])
```
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `date_input` | `label`, `value`, `name`, `auto_submit` | ISO date picker (`YYYY-MM-DD`). |
| `time_input` | `label`, `value`, `name`, `auto_submit` | Time picker (`HH:MM`). |
| `date_range_input` | `name`, `label`, `start`, `end`, `presets`, `auto_submit` | Start/end range inputs plus quick preset buttons (e.g., `[7, 30, 90]`). |
