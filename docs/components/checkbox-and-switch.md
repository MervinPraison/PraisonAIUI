# Checkbox & Switch Input

> Boolean toggles and checkboxes for feature flags, streaming options, and preferences.

Use `checkbox_input()` for form confirmations and multi-option flags, and `switch_input()` for instant on/off feature toggles.

[
  {"type": "checkbox_input", "label": "Stream tokens in real time", "checked": true, "name": "stream"},
  {"type": "switch_input", "label": "Auto-save chat sessions", "checked": true, "name": "autosave"},
  {"type": "switch_input", "label": "Require human approval for shell tools", "checked": false, "name": "approval"}
]

## Python

```python
import praisonaiui as aiui

aiui.checkbox_input("Stream tokens in real time", checked=True, name="stream")
aiui.switch_input("Auto-save chat sessions", checked=True, name="autosave")
```

## YAML

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

## Props

| Component | Parameter | Description |
|---|---|---|
| `checkbox_input` | `label`, `checked`, `name`, `auto_submit` | Boolean checkbox control. |
| `switch_input` | `label`, `checked`, `name`, `auto_submit` | Accessible toggle switch (`role="switch"`). |

## Related pages

- [Select Input](https://ui.praison.ai/docs/components/select-input.md)
- [Form](https://ui.praison.ai/docs/components/form.md)
- [Radio & Segmented Input](https://ui.praison.ai/docs/components/radio-and-segmented.md)
