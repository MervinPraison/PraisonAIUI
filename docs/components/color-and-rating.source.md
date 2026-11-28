---
title: Color Picker & Rating Input
nav_title: Color & Rating
description: Theme color swatch picker and accessible interactive star rating control.
---

# Color Picker & Rating Input

Let users pick hex colors with `color_picker_input()` and collect human feedback or display eval scores with `rating_input()`.

<ComponentPreview title="Color Picker & Interactive Star Rating">
[
  {"type": "color_picker_input", "label": "Brand Accent", "value": "#6366f1", "name": "accent"},
  {"type": "rating_input", "label": "Rate this agent response", "value": 4, "max_stars": 5, "readonly": false, "name": "rating"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.color_picker_input("Brand Accent", value="#6366f1", name="accent")
aiui.rating_input("Rate this agent response", value=4, max_stars=5, name="rating")
```
</Tab>
<Tab title="YAML">
```yaml
- type: color_picker_input
  label: "Brand Accent"
  value: "#6366f1"
  name: "accent"
- type: rating_input
  label: "Rate this agent response"
  value: 4
  max_stars: 5
  name: "rating"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `color_picker_input` | `label`, `value`, `name`, `auto_submit` | Color swatch + hex readout (`#RRGGBB`). |
| `rating_input` | `label`, `value`, `max_stars`, `name`, `readonly`, `auto_submit` | Accessible star rating (keyboard + pointer); set `readonly=True` for display-only scores. |
