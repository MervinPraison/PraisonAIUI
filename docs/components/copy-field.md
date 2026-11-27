---
title: Copy Field
nav_title: Copy Field
description: One-click clipboard copy box for CLI commands, webhook URLs, and masked API secrets.
---

# Copy Field

`copy_field()` displays a monospace command, endpoint, or API token with a one-click copy button and optional secret masking toggle (`secret=True`).

<ComponentPreview title="Copy Field (Standard & Masked Secret)">
[
  {"type": "copy_field", "label": "Quick Install", "value": "pip install aiui && aiui run app.py", "secret": false},
  {"type": "copy_field", "label": "Gateway API Token", "value": "aiui_live_9f8a7c6b5d4e3f2a1b", "secret": true}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.copy_field("pip install aiui && aiui run app.py", label="Quick Install")
aiui.copy_field("aiui_live_9f8a7c6b5d4e3f2a1b", label="Gateway API Token", secret=True)
```
</Tab>
<Tab title="YAML">
```yaml
- type: copy_field
  label: "Quick Install"
  value: "pip install aiui && aiui run app.py"
- type: copy_field
  label: "Gateway API Token"
  value: "aiui_live_9f8a7c6b5d4e3f2a1b"
  secret: true
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `value` | `str` | Exact text copied to the clipboard on click. |
| `label` | `str` | Optional label shown above the copy field. |
| `secret` | `bool` | Mask the value by default with an accessible show/hide toggle (default `False`). |
