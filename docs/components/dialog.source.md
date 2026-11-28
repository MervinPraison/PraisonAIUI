---
title: Dialog
nav_title: Dialog
description: Accessible modal dialog overlay triggered by a button for confirmations and nested forms.
---

# Dialog

`dialog()` renders a trigger button that opens an accessible Radix modal dialog containing any child components—forms, alerts, or detail views. Click the button below to test it live.

<ComponentPreview title="Interactive Modal Dialog (click to open)">
{
  "type": "dialog",
  "title": "Confirm Session Reset",
  "description": "This clears the current conversation memory and starts a fresh context window.",
  "trigger_label": "Open Confirmation Dialog",
  "children": [
    {"type": "alert", "variant": "warning", "message": "Unsaved draft messages in this session will be removed."},
    {"type": "button_group", "buttons": [{"label": "Confirm Reset", "action": "reset_session", "variant": "destructive"}]}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.dialog(
    "Confirm Session Reset",
    description="This clears the current conversation memory.",
    trigger_label="Open Confirmation Dialog",
    children=[
        aiui.alert("Unsaved draft messages will be removed.", variant="warning"),
        aiui.button_group([{"label": "Confirm Reset", "action": "reset_session", "variant": "destructive"}]),
    ],
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: dialog
  title: "Confirm Session Reset"
  description: "This clears the current conversation memory."
  trigger_label: "Open Confirmation Dialog"
  children:
    - type: alert
      variant: "warning"
      message: "Unsaved draft messages will be removed."
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `title`, `description` | `str` | Modal heading and explanatory subtitle. |
| `trigger_label`, `variant` | `str` | Trigger button text and button variant. |
| `children` | `list` | Any child UI components rendered inside the modal body. |
