---
title: Spinner & Skeleton
nav_title: Spinner & Skeleton
description: Indeterminate loading spinners and layout-preserving skeleton placeholders.
---

# Spinner & Skeleton

Use `spinner()` for active wait states with a label and `skeleton()` to reserve space cleanly while async content loads.

<ComponentPreview title="Spinner & Skeleton Placeholders">
[
  {"type": "spinner", "text": "Waiting for agent tool execution..."},
  {"type": "skeleton", "variant": "text", "width": "75%", "height": "20px"},
  {"type": "skeleton", "variant": "rect", "width": "100%", "height": "56px"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.spinner("Waiting for agent tool execution...")
aiui.skeleton(width="100%", height="56px", variant="rect")
```
</Tab>
<Tab title="YAML">
```yaml
- type: spinner
  text: "Waiting for agent tool execution..."
- type: skeleton
  width: "100%"
  height: "56px"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `spinner` | `text` | Animated spinner with accessible status label. |
| `skeleton` | `width`, `height`, `variant` | Placeholder dimensions (`width`, `height`) and shape (`text`, `rect`, `circle`). |
