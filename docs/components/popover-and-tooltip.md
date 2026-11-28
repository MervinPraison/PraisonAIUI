# Popover, Tooltip & Toast

> Anchored click popovers, hover tooltips, and transient toast notifications.

Layer lightweight contextual overlays with `popover()` (click to open), `tooltip()` (hover/focus hint), and `toast()` (transient notification). For persistent real-time notifications, see the [Notification Center](https://ui.praison.ai/docs/features/notifications.md).

{
  "type": "columns",
  "children": [
    {
      "type": "popover",
      "trigger": {"type": "badge", "text": "Click for latency breakdown", "variant": "info"},
      "children": [
        {"type": "key_value_list", "items": [{"label": "p50", "value": "82 ms"}, {"label": "p99", "value": "210 ms"}]}
      ]
    },
    {
      "type": "tooltip_wrap",
      "child": {"type": "badge", "text": "Hover for model info", "variant": "default"},
      "content": "Served via OpenAI Responses API with automatic fallback."
    }
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.popover(
    aiui.badge("Click for latency breakdown", variant="info"),
    children=[aiui.definition_list([{"label": "p50", "value": "82 ms"}])],
)
aiui.tooltip(aiui.badge("Hover for model info"), content="Served with automatic fallback.")
aiui.toast("Agent configuration saved.", variant="success", duration=3000)
```

## YAML

```yaml
- type: popover
  trigger: { type: badge, text: "Click for details", variant: "info" }
  children:
    - type: text
      content: "p50: 82 ms · p99: 210 ms"
- type: tooltip_wrap
  child: { type: badge, text: "Hover me" }
  content: "Helpful context shown on hover."
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `popover` | `trigger`, `children` | Click-activated anchored overlay panel. |
| `tooltip` | `child`, `content` | Hover/focus hint wrapping any component (`tooltip_wrap` alias). |
| `toast` | `message`, `variant`, `duration` | Transient toast banner (`info`, `success`, `warning`, `error`). |

## Related pages

- [Feedback, Overlays & Notifications](https://ui.praison.ai/docs/components/feedback-and-notifications.md)
- [Chart](https://ui.praison.ai/docs/components/chart.md)
- [Component API Reference](https://ui.praison.ai/docs/api/components.md)
