# Radio & Segmented Input

> Mutually exclusive radio groups and compact toggle pill bars for quick mode switching.

Use `radio_input()` when options need full labels stacked cleanly, and `segmented_input()` for compact horizontal pill selectors (`multi=False` or `multi=True`).

[
  {"type": "radio_input", "label": "Tool Approval Mode", "options": ["Auto-approve", "Ask before tools", "Manual only"], "value": "Ask before tools", "name": "approval"},
  {"type": "segmented_input", "name": "window", "label": "Time Window", "options": ["24h", "7d", "30d", "90d"], "value": "7d", "multi": false}
]

## Python

```python
import praisonaiui as aiui

aiui.radio_input("Tool Approval Mode", options=["Auto-approve", "Ask before tools", "Manual only"], value="Ask before tools", name="approval")
aiui.segmented_input("window", ["24h", "7d", "30d", "90d"], label="Time Window", value="7d")
```

## YAML

```yaml
- type: radio_input
  label: "Tool Approval Mode"
  options: ["Auto-approve", "Ask before tools", "Manual only"]
  value: "Ask before tools"
  name: "approval"
- type: segmented_input
  name: "window"
  label: "Time Window"
  options: ["24h", "7d", "30d", "90d"]
  value: "7d"
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `radio_input` | `label`, `options`, `value`, `name`, `auto_submit` | Single-choice radio group. |
| `segmented_input` | `name`, `options`, `label`, `value`, `multi`, `auto_submit` | Pill toggle bar; set `multi=True` to allow multiple active pills. |

## Related pages

- [Filter Bar](https://ui.praison.ai/docs/components/filter-bar.md)
- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
- [Checkbox & Switch Input](https://ui.praison.ai/docs/components/checkbox-and-switch.md)
