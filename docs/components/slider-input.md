---
title: Slider Input
nav_title: Slider Input
description: Range slider for tuning temperatures, top-p thresholds, and numeric weights.
---

# Slider Input

`slider_input()` renders an accessible range slider with live numeric readout—ideal for model parameters like `temperature` or confidence thresholds.

<ComponentPreview title="Interactive Slider">
{
  "type": "slider_input",
  "label": "Temperature",
  "value": 0.7,
  "min_val": 0,
  "max_val": 1,
  "step": 0.1,
  "name": "temperature"
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.slider_input("Temperature", value=0.7, min_val=0, max_val=1, step=0.1, name="temperature")
```
</Tab>
<Tab title="YAML">
```yaml
- type: slider_input
  label: "Temperature"
  value: 0.7
  min_val: 0
  max_val: 1
  step: 0.1
  name: "temperature"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `label`, `value`, `name` | `str`, `number`, `str` | Slider label, initial numeric value, and form key. |
| `min_val`, `max_val`, `step` | `number` | Range bounds and step increment (defaults `0`, `100`, `1`). |
