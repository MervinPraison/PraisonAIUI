---
title: Radio & Segmented Input
nav_title: Radio & Segmented
description: Mutually exclusive radio groups and compact toggle pill bars for quick mode switching.
---

# Radio & Segmented Input

Use `radio_input()` when options need full labels stacked cleanly, and `segmented_input()` for compact horizontal pill selectors (`multi=False` or `multi=True`).

<ComponentPreview title="Radio Group & Segmented Pills">
[
  {"type": "radio_input", "label": "Tool Approval Mode", "options": ["Auto-approve", "Ask before tools", "Manual only"], "value": "Ask before tools", "name": "approval"},
  {"type": "segmented_input", "name": "window", "label": "Time Window", "options": ["24h", "7d", "30d", "90d"], "value": "7d", "multi": false}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.radio_input("Tool Approval Mode", options=["Auto-approve", "Ask before tools", "Manual only"], value="Ask before tools", name="approval")
aiui.segmented_input("window", ["24h", "7d", "30d", "90d"], label="Time Window", value="7d")
```
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `radio_input` | `label`, `options`, `value`, `name`, `auto_submit` | Single-choice radio group. |
| `segmented_input` | `name`, `options`, `label`, `value`, `multi`, `auto_submit` | Pill toggle bar; set `multi=True` to allow multiple active pills. |
