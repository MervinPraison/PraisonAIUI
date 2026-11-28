# Button Group

> Action button bar that dispatches named events to your Python page action handler.

`button_group()` renders a row of styled action buttons (`primary`, `secondary`, `outline`, `destructive`, `ghost`). Click any button below to see the dispatched action payload.

{
  "type": "button_group",
  "buttons": [
    {"label": "Run Agent", "action": "run_agent", "variant": "primary"},
    {"label": "Dry Run", "action": "dry_run", "variant": "outline"},
    {"label": "Clear Cache", "action": "clear_cache", "variant": "destructive"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.button_group([
    {"label": "Run Agent", "action": "run_agent", "variant": "primary"},
    {"label": "Dry Run", "action": "dry_run", "variant": "outline"},
    {"label": "Clear Cache", "action": "clear_cache", "variant": "destructive"},
])
```

## YAML

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

## Props

| Parameter | Type | Description |
|---|---|---|
| `buttons` | `list[dict]` | Button specs with `label`, `action` (or `href`), optional `variant`, and optional `payload`. |

## Related pages

- [Form](https://ui.praison.ai/docs/components/form.md)
- [Filter Bar](https://ui.praison.ai/docs/components/filter-bar.md)
- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
