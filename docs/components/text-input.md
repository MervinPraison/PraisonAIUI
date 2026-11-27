---
title: Text & Textarea Input
nav_title: Text & Textarea
description: Single-line text fields and multi-line textareas for prompts, names, and notes.
---

# Text & Textarea Input

Capture single-line strings with `text_input()` and multi-line prompts or descriptions with `textarea_input()`.

<ComponentPreview title="Text & Textarea Inputs">
[
  {"type": "text_input", "label": "Agent Name", "value": "Docs Assistant", "placeholder": "Enter agent name...", "name": "agent_name"},
  {"type": "textarea_input", "label": "System Instructions", "value": "Answer concisely and cite the exact documentation page.", "rows": 3, "name": "instructions"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.text_input("Agent Name", value="Docs Assistant", placeholder="Enter agent name...", name="agent_name")
aiui.textarea_input("System Instructions", value="Answer concisely.", rows=3, name="instructions")
```
</Tab>
<Tab title="YAML">
```yaml
- type: text_input
  label: "Agent Name"
  value: "Docs Assistant"
  name: "agent_name"
- type: textarea_input
  label: "System Instructions"
  value: "Answer concisely."
  rows: 3
  name: "instructions"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `text_input` | `label`, `value`, `placeholder`, `name`, `auto_submit` | Single-line input field; binds to `name` inside `form()` or `filter_bar()`. |
| `textarea_input` | `label`, `value`, `placeholder`, `rows`, `name`, `auto_submit` | Multi-line input with configurable visible `rows`. |
