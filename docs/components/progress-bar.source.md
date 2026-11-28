---
title: Progress Bar
nav_title: Progress Bar
description: Determinate progress indicator for indexing jobs, batch runs, and quota meters.
---

# Progress Bar

`progress_bar()` visualizes determinate completion against `max_value` (default `100`) with an accessible `role="progressbar"`.

<ComponentPreview title="Progress Bars">
[
  {"type": "progress_bar", "label": "Knowledge base indexing", "value": 74, "max_value": 100},
  {"type": "progress_bar", "label": "Monthly API quota (312 / 500)", "value": 312, "max_value": 500}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.progress_bar("Knowledge base indexing", value=74, max_value=100)
aiui.progress_bar("Monthly API quota", value=312, max_value=500)
```
</Tab>
<Tab title="YAML">
```yaml
- type: progress_bar
  label: "Knowledge base indexing"
  value: 74
  max_value: 100
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `label` | `str` | Descriptive caption above the bar. |
| `value`, `max_value` | `number` | Current value and maximum scale (default `100`). |
