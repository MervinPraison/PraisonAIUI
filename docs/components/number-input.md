# Number Input

> Numeric field with min/max bounds and step increments for budgets, tokens, and limits.

`number_input()` captures bounded numeric settings such as `max_tokens`, retry counts, or concurrency limits.

{
  "type": "number_input",
  "label": "Max Output Tokens",
  "value": 2048,
  "min_val": 256,
  "max_val": 8192,
  "step": 256,
  "name": "max_tokens"
}

## Python

```python
import praisonaiui as aiui

aiui.number_input("Max Output Tokens", value=2048, min_val=256, max_val=8192, step=256, name="max_tokens")
```

## YAML

```yaml
- type: number_input
  label: "Max Output Tokens"
  value: 2048
  min_val: 256
  max_val: 8192
  step: 256
  name: "max_tokens"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `label`, `value`, `name` | `str`, `number`, `str` | Field label, initial numeric value, and form key. |
| `min_val`, `max_val`, `step` | `number` | Optional minimum, maximum, and increment step. |

## Related pages

- [Slider Input](https://ui.praison.ai/docs/components/slider-input.md)
- [Text & Textarea Input](https://ui.praison.ai/docs/components/text-input.md)
- [Component API Reference](https://ui.praison.ai/docs/api/components.md)
