# Spinner & Skeleton

> Indeterminate loading spinners and layout-preserving skeleton placeholders.

Use `spinner()` for active wait states with a label and `skeleton()` to reserve space cleanly while async content loads.

[
  {"type": "spinner", "text": "Waiting for agent tool execution..."},
  {"type": "skeleton", "variant": "text", "width": "75%", "height": "20px"},
  {"type": "skeleton", "variant": "rect", "width": "100%", "height": "56px"}
]

## Python

```python
import praisonaiui as aiui

aiui.spinner("Waiting for agent tool execution...")
aiui.skeleton(width="100%", height="56px", variant="rect")
```

## YAML

```yaml
- type: spinner
  text: "Waiting for agent tool execution..."
- type: skeleton
  width: "100%"
  height: "56px"
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `spinner` | `text` | Animated spinner with accessible status label. |
| `skeleton` | `width`, `height`, `variant` | Placeholder dimensions (`width`, `height`) and shape (`text`, `rect`, `circle`). |

## Related pages

- [Feedback, Overlays & Notifications](https://ui.praison.ai/docs/components/feedback-and-notifications.md)
- [Empty State](https://ui.praison.ai/docs/components/empty-state.md)
- [Tabs](https://ui.praison.ai/docs/components/tabs.md)
