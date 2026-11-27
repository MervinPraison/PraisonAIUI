---
title: Header, Divider & Separator
nav_title: Header & Divider
description: Section headings and horizontal rules to structure complex app pages.
---

# Header, Divider & Separator

Add semantic section headings with `header()` and visual horizontal breaks with `divider()` (with optional centered text) or `separator()`.

<ComponentPreview title="Header, Divider & Separator">
[
  {"type": "header", "text": "Workspace Configuration", "level": 2},
  {"type": "text", "content": "Manage default models, guardrails, and webhook targets."},
  {"type": "divider", "text": "Security"},
  {"type": "text", "content": "Bearer token authentication is enabled for all routes."},
  {"type": "separator"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.header("Workspace Configuration", level=2)
aiui.divider("Security")
aiui.separator()
```
</Tab>
<Tab title="YAML">
```yaml
- type: header
  text: "Workspace Configuration"
  level: 2
- type: divider
  text: "Security"
- type: separator
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `header` | `text`, `level` | Heading text and HTML level (`1`–`6`, default `2`). |
| `divider` | `text` | Horizontal rule with optional centered label. |
| `separator` | — | Clean hairline horizontal separator. |
