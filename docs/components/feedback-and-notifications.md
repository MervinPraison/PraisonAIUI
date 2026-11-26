---
title: Feedback, Overlays & Notifications
nav_title: Feedback & notifications
description: Show alerts, job progress, loading skeletons, modal dialogs, toasts and real-time header Notification Center alerts.
---

# Feedback, Overlays & Notifications

Communicate status clearly — from inline alerts and live job trackers to the built-in real-time **Notification Center** in the top header bar.

## Inline feedback & overlay components

| Python builder | YAML `type` | What it renders |
|---|---|---|
| `aiui.alert(message, *, variant="info", title)` | `alert` | Inline banner (`info`, `success`, `warning`, `error`) |
| `aiui.callout(content, *, variant="info", title)` | `callout` | Highlighted note or tip block |
| `aiui.status(label, *, state, detail, progress, log)` | `status` | Live job row (`queued`, `running`, `done`, `failed`) with progress bar & log tail |
| `aiui.toast(message, *, variant="info", duration=3000)` | `toast` | Page-rendered toast banner |
| `aiui.spinner(text="Loading...")` | `spinner` | Animated loading indicator |
| `aiui.skeleton(*, width, height, variant="text")` | `skeleton` | Placeholder shimmer (`text`, `card`, `avatar`) |
| `aiui.empty(text="No data")` | `empty` | Clean empty-state panel |
| `aiui.dialog(title, *, children, description, trigger_label, variant)` | `dialog` | Modal dialog opened by a button |
| `aiui.popover(trigger, *, children)` | `popover` | Contextual floating panel |
| `aiui.tooltip(child, *, content)` | `tooltip` | Hover hint wrapping any child block |

## Header Notification Center (Real-Time Bell)

Every app shell ships with a modular, DRY **Notification Center** (`builtin.notifications`) in the top header bar: unread badge, All / Unread / Category filters, mark read, dismiss, and safe SPA action links — streamed live over SSE (`/api/notifications/stream`).

<Tabs>
<Tab title="Push from anywhere (Python)">
```python
import praisonaiui as aiui

# Push from a background job, tool call, webhook, or page handler
aiui.push_notification(
    "Deployment succeeded",
    "Production build is live",
    type="success",            # "info" | "success" | "warning" | "error"
    category="deploy",
    dedupe_key="deploy-live",  # Updates existing item instead of duplicating
    action={"label": "View Logs", "page": "logs"},
)
```
</Tab>
<Tab title="From a chat or page handler">
```python
# Inside @aiui.reply: show a toast AND persist it in the header bell
await aiui.notify("Report ready", type="success", persist=True, category="chat")

# Inside @aiui.page or @aiui.register_page_action: emit alongside blocks
return aiui.layout(
    [aiui.status("Nightly sync", state="done", progress=100)],
    notifications=[{"title": "Sync finished", "type": "success", "category": "sync"}],
)
```
</Tab>
<Tab title="Browser Plugin (@aiui/sdk)">
```tsx
import { notifications, useNotifications } from '@aiui/sdk'

notifications.push({
  title: 'Index rebuilt',
  description: '1,240 documents ready',
  type: 'info',
  category: 'knowledge',
  action: { label: 'Open Knowledge', page: 'knowledge' },
  toast: true,
})
```
</Tab>
</Tabs>

See [Notification Center architecture & REST/SSE API](../features/notifications.md) for custom storage (`aiui.set_notification_store`) and custom transport sources (`notifications.registerSource`).
