---
title: Empty State
nav_title: Empty State
description: Clean placeholder when a table, search filter, or workspace has no records yet.
---

# Empty State

`empty()` provides a centered, muted placeholder message when a list, table, or run history has no items to display.

<ComponentPreview title="Empty State">
{
  "type": "empty",
  "text": "No agent runs yet. Send a prompt in Chat or trigger a scheduled job to see activity here."
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.empty("No agent runs yet. Send a prompt in Chat to start.")
```
</Tab>
<Tab title="YAML">
```yaml
- type: empty
  text: "No agent runs yet. Send a prompt in Chat to start."
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Helpful message guiding the user on what to do next. |
