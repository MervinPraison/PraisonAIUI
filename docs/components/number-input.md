---
title: Number Input
nav_title: Number Input
description: Numeric field with min/max bounds and step increments for budgets, tokens, and limits.
---

# Number Input

`number_input()` captures bounded numeric settings such as `max_tokens`, retry counts, or concurrency limits.

<ComponentPreview title="Number Input">
{
  "type": "number_input",
  "label": "Max Output Tokens",
  "value": 2048,
  "min_val": 256,
  "max_val": 8192,
  "step": 256,
  "name": "max_tokens"
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.number_input("Max Output Tokens", value=2048, min_val=256, max_val=8192, step=256, name="max_tokens")
```
</Tab>
<Tab title="YAML">
```yaml
- type: number_input
  label: "Max Output Tokens"
  value: 2048
  min_val: 256
  max_val: 8192
  step: 256
  name: "max_tokens"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `label`, `value`, `name` | `str`, `number`, `str` | Field label, initial numeric value, and form key. |
| `min_val`, `max_val`, `step` | `number` | Optional minimum, maximum, and increment step. |
