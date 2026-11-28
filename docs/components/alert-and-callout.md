# Alert & Callout

> Contextual banners and Markdown-enabled callout boxes for status, warnings, and tips.

Use `alert()` for concise system status banners and `callout()` for rich Markdown-formatted notes, tips, or warnings.

[
  {"type": "alert", "variant": "success", "title": "System Healthy", "message": "All background workers and WebSocket gateways are online."},
  {"type": "alert", "variant": "warning", "title": "Rate Limit Approaching", "message": "85% of your hourly token quota has been used."},
  {"type": "callout", "variant": "info", "title": "Pro Tip", "content": "Use `style: app` in `app.yaml` to enable the React shell and Notification Center."}
]

## Python

```python
import praisonaiui as aiui

aiui.alert("All background workers are online.", variant="success", title="System Healthy")
aiui.callout("Use `style: app` for the React shell.", variant="info", title="Pro Tip")
```

## YAML

```yaml
- type: alert
  variant: "success"
  title: "System Healthy"
  message: "All background workers are online."
- type: callout
  variant: "info"
  title: "Pro Tip"
  content: "Use `style: app` for the React shell."
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `alert` | `message`, `variant`, `title` | Plain-text alert banner (`info`, `success`, `warning`, `error`). |
| `callout` | `content`, `variant`, `title` | Highlighted box whose `content` renders sanitized Markdown. |

## Related pages

- [Feedback, Overlays & Notifications](https://ui.praison.ai/docs/components/feedback-and-notifications.md)
- [Badge & Status](https://ui.praison.ai/docs/components/badge.md)
- [Dialog](https://ui.praison.ai/docs/components/dialog.md)
