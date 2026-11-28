# Slider Input

> Range slider for tuning temperatures, top-p thresholds, and numeric weights.

`slider_input()` renders an accessible range slider with live numeric readout—ideal for model parameters like `temperature` or confidence thresholds.

{
  "type": "slider_input",
  "label": "Temperature",
  "value": 0.7,
  "min_val": 0,
  "max_val": 1,
  "step": 0.1,
  "name": "temperature"
}

## Python

```python
import praisonaiui as aiui

aiui.slider_input("Temperature", value=0.7, min_val=0, max_val=1, step=0.1, name="temperature")
```

## YAML

```yaml
- type: slider_input
  label: "Temperature"
  value: 0.7
  min_val: 0
  max_val: 1
  step: 0.1
  name: "temperature"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `label`, `value`, `name` | `str`, `number`, `str` | Slider label, initial numeric value, and form key. |
| `min_val`, `max_val`, `step` | `number` | Range bounds and step increment (defaults `0`, `100`, `1`). |

## Related pages

- [Number Input](https://ui.praison.ai/docs/components/number-input.md)
- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
- [Date, Time & Date Range](https://ui.praison.ai/docs/components/date-and-time.md)
