---
title: Alert & Callout
nav_title: Alert & Callout
description: Contextual banners and Markdown-enabled callout boxes for status, warnings, and tips.
---

# Alert & Callout

Use `alert()` for concise system status banners and `callout()` for rich Markdown-formatted notes, tips, or warnings.

<ComponentPreview title="Alert & Callout Variants">
[
  {"type": "alert", "variant": "success", "title": "System Healthy", "message": "All background workers and WebSocket gateways are online."},
  {"type": "alert", "variant": "warning", "title": "Rate Limit Approaching", "message": "85% of your hourly token quota has been used."},
  {"type": "callout", "variant": "info", "title": "Pro Tip", "content": "Use `style: app` in `app.yaml` to enable the React shell and Notification Center."}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.alert("All background workers are online.", variant="success", title="System Healthy")
aiui.callout("Use `style: app` for the React shell.", variant="info", title="Pro Tip")
```
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `alert` | `message`, `variant`, `title` | Plain-text alert banner (`info`, `success`, `warning`, `error`). |
| `callout` | `content`, `variant`, `title` | Highlighted box whose `content` renders sanitized Markdown. |
