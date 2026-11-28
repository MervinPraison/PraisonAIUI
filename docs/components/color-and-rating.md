# Color Picker & Rating Input

> Theme color swatch picker and accessible interactive star rating control.

Let users pick hex colors with `color_picker_input()` and collect human feedback or display eval scores with `rating_input()`.

[
  {"type": "color_picker_input", "label": "Brand Accent", "value": "#6366f1", "name": "accent"},
  {"type": "rating_input", "label": "Rate this agent response", "value": 4, "max_stars": 5, "readonly": false, "name": "rating"}
]

## Python

```python
import praisonaiui as aiui

aiui.color_picker_input("Brand Accent", value="#6366f1", name="accent")
aiui.rating_input("Rate this agent response", value=4, max_stars=5, name="rating")
```

## YAML

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

## Props

| Component | Parameter | Description |
|---|---|---|
| `color_picker_input` | `label`, `value`, `name`, `auto_submit` | Color swatch + hex readout (`#RRGGBB`). |
| `rating_input` | `label`, `value`, `max_stars`, `name`, `readonly`, `auto_submit` | Accessible star rating (keyboard + pointer); set `readonly=True` for display-only scores. |

## Related pages

- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
- [Date, Time & Date Range](https://ui.praison.ai/docs/components/date-and-time.md)
- [Form](https://ui.praison.ai/docs/components/form.md)
