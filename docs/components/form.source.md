---
title: Form
nav_title: Form
description: Interactive form container that collects input values and submits to your page action handler.
---

# Form

`form()` (alias `form_action()`) wraps input components and submits their values to your `@aiui.page_action` handler—either on button submit or live with `submit_on_change=True`.

<ComponentPreview title="Interactive Form (click Save)">
{
  "type": "form_action",
  "action": "save_agent",
  "submit_label": "Save Agent",
  "children": [
    {"type": "text_input", "label": "Agent Name", "value": "Researcher", "name": "name"},
    {"type": "select_input", "label": "Model", "options": ["gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet"], "value": "gpt-4o", "name": "model"},
    {"type": "switch_input", "label": "Enable memory", "checked": true, "name": "memory"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.form(
    "save_agent",
    children=[
        aiui.text_input("Agent Name", value="Researcher", name="name"),
        aiui.select_input("Model", options=["gpt-4o", "gpt-4o-mini"], value="gpt-4o", name="model"),
        aiui.switch_input("Enable memory", checked=True, name="memory"),
    ],
    submit_label="Save Agent",
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: form_action
  action: "save_agent"
  submit_label: "Save Agent"
  children:
    - type: text_input
      label: "Agent Name"
      value: "Researcher"
      name: "name"
    - type: switch_input
      label: "Enable memory"
      checked: true
      name: "memory"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `action`, `children` | `str`, `list` | Server action name and list of input components. |
| `submit_label` | `str` | Submit button text (default `"Submit"`). |
| `method`, `update_url`, `submit_on_change` | options | Use `method="get"` to sync filters to URL query params, or `submit_on_change=True` for instant updates. |
