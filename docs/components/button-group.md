---
title: Button Group
nav_title: Button Group
description: Action button bar that dispatches named events to your Python page action handler.
---

# Button Group

`button_group()` renders a row of styled action buttons (`primary`, `secondary`, `outline`, `destructive`, `ghost`). Click any button below to see the dispatched action payload.

<ComponentPreview title="Interactive Button Group (click a button)">
{
  "type": "button_group",
  "buttons": [
    {"label": "Run Agent", "action": "run_agent", "variant": "primary"},
    {"label": "Dry Run", "action": "dry_run", "variant": "outline"},
    {"label": "Clear Cache", "action": "clear_cache", "variant": "destructive"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.button_group([
    {"label": "Run Agent", "action": "run_agent", "variant": "primary"},
    {"label": "Dry Run", "action": "dry_run", "variant": "outline"},
    {"label": "Clear Cache", "action": "clear_cache", "variant": "destructive"},
])
```
</Tab>
<Tab title="YAML">
```yaml
- type: button_group
  buttons:
    - label: "Run Agent"
      action: "run_agent"
      variant: "primary"
    - label: "Dry Run"
      action: "dry_run"
      variant: "outline"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `buttons` | `list[dict]` | Button specs with `label`, `action` (or `href`), optional `variant`, and optional `payload`. |
