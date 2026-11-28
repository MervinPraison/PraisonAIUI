# Notification Center

> PraisonAIUI includes a modular, extendable Notification Center built into @aiui/sdk

PraisonAIUI includes a modular, extendable Notification Center built into `@aiui/sdk`
and shipped as a first-party plugin (`builtin.notifications`).

## Combined HITL Approvals + Notifications Example

See live notifications, header bell alerts, deep-link actions, and Human-in-the-Loop approvals working together on one dashboard in [34-hitl-approvals-and-notifications](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/34-hitl-approvals-and-notifications) (`aiui run app.py` or `aiui run app.yaml` — no API key required).

[
  {"type": "alert", "variant": "warning", "title": "Approval required: deploy_release", "message": "Agent paused before deploying v0.4.0 to production — click Review now in the header Notification Bell."},
  {"type": "timeline", "title": "Recent Notification Events", "items": [
    {"title": "Deployment v0.4.0 approved", "time": "just now", "status": "success", "description": "Agent resumed and completed rollout."},
    {"title": "Approval required: deploy_release", "time": "2m ago", "status": "warning", "description": "High-risk tool gate triggered from Chat."}
  ]}
]

## Zero-Code YAML Notifications

Declare startup or static notifications directly in `app.yaml`:

```yaml
style: app
notifications:
  - title: "Approval required: deploy_release"
    description: "Agent paused before rolling out v0.4.0"
    type: warning
    category: approvals
    action:
      label: "Open Approvals"
      page: "approvals"
```

## Architecture (DRY & Modular)

1. **Headless SDK store (`@aiui/sdk`: `notifications`, `useNotifications`)**
   - Holds the single client-side notification list, unread count, deduplication
     (`dedupeKey` / `id`), ring-buffer cap, and optimistic actions
     (`markRead`, `markUnread`, `markAllRead`, `remove`, `clear`, `sync`).
   - Automatically records calls to `notify(message, opts)` unless
     `opts.record === false`, so ephemeral toasts stay reviewable in the bell
     panel without duplicating code at call sites.
   - Extendable via `notifications.registerSource(id, source)` for custom
     transports (WebSockets, SSE, polling, webhooks).
2. **Header Bell plugin (`builtin.notifications`)**
   - Registers a lightweight bell trigger into the `header:actions` slot, so it
     appears in the Classic shell and selectable layout frames.
   - Lazily loads its popover panel on hover, focus, or click to keep boot
     bundles small.
   - Supports All / Unread / dynamic category filters, Mark all read, per-item
     read toggle & dismiss, safe SPA action links (`action.page` + `params`),
     keyboard `Escape`, and polite screen-reader announcements.
   - Disable it with `extensions: { disabled: ["builtin.notifications"] }` or
     replace it by registering your own `header:actions` slot component backed
     by `useNotifications()`.
3. **Python Feature & SDK (`praisonaiui.features.notifications`)**
   - Mounts authenticated REST and SSE endpoints (`/api/notifications`,
     `/api/notifications/read-all`, `/api/notifications/{id}/read`,
     `/api/notifications/{id}`, `/api/notifications/stream`).
   - Pluggable storage via `NotificationStoreProtocol` and
     `aiui.set_notification_store(store)`.

## Python Usage

```python
import praisonaiui as aiui

# Push a live notification from anywhere (background task, page handler, tool)
aiui.push_notification(
    "Deployment succeeded",
    "Production build v1.4 is live",
    type="success",
    category="deploy",
    dedupe_key="deploy-1.4",
    action={"label": "View logs", "page": "logs"},
)

# Inside a chat handler, optionally persist a toast to the Notification Center
await aiui.notify("Report ready", type="success", persist=True, category="chat")

# Inside a BlockPage handler, emit notifications alongside components
return aiui.layout(
    [aiui.card("Status", value="Synced")],
    notifications=[{"title": "Sync finished", "type": "success", "category": "sync"}],
)
```

## Browser Plugin SDK (`@aiui/sdk`)

```tsx
import { notifications, useNotifications } from '@aiui/sdk'

// Push from any browser plugin
notifications.push({
  title: 'Index rebuilt',
  description: '1,240 documents indexed',
  type: 'info',
  category: 'knowledge',
  dedupeKey: 'index-rebuild',
  action: { label: 'Open Knowledge', page: 'knowledge' },
  toast: true,
})

// Subscribe in a custom React component
export function UnreadPill() {
  const { unreadCount, markAllRead } = useNotifications()
  return <button onClick={() => markAllRead()}>Unread: {unreadCount}</button>
}

// Plug in a custom transport / source
const stop = notifications.registerSource('my-plugin', {
  connect(ctx) {
    const timer = setInterval(() => {
      ctx.push({ dedupeKey: 'heartbeat', title: 'Worker healthy', type: 'info' })
    }, 60_000)
    return () => clearInterval(timer)
  },
})
```

## Related pages

- [App & Dashboard Overview](https://ui.praison.ai/docs/app-ui/overview.md)
- [UI Components Overview](https://ui.praison.ai/docs/components/overview.md)
- [Feedback, Overlays & Notifications](https://ui.praison.ai/docs/components/feedback-and-notifications.md)
