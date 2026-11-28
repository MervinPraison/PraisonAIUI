---
title: Checkbox & Switch Input
nav_title: Checkbox & Switch
description: Boolean toggles and checkboxes for feature flags, streaming options, and preferences.
---

# Checkbox & Switch Input

Use `checkbox_input()` for form confirmations and multi-option flags, and `switch_input()` for instant on/off feature toggles.

<ComponentPreview title="Checkbox & Switch">
[
  {"type": "checkbox_input", "label": "Stream tokens in real time", "checked": true, "name": "stream"},
  {"type": "switch_input", "label": "Auto-save chat sessions", "checked": true, "name": "autosave"},
  {"type": "switch_input", "label": "Require human approval for shell tools", "checked": false, "name": "approval"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.checkbox_input("Stream tokens in real time", checked=True, name="stream")
aiui.switch_input("Auto-save chat sessions", checked=True, name="autosave")
```
</Tab>
<Tab title="YAML">
```yaml
- type: checkbox_input
  label: "Stream tokens in real time"
  checked: true
  name: "stream"
- type: switch_input
  label: "Auto-save chat sessions"
  checked: true
  name: "autosave"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `checkbox_input` | `label`, `checked`, `name`, `auto_submit` | Boolean checkbox control. |
| `switch_input` | `label`, `checked`, `name`, `auto_submit` | Accessible toggle switch (`role="switch"`). |
