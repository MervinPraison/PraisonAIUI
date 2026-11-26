---
title: App & Dashboard Overview
nav_title: Overview
description: Combine chat with selectable layouts, Python or zero-code YAML data pages, a notification center, custom themes and plugins.
---

# App & Dashboard Overview

PraisonAIUI is more than a single chat window. In the default **React app shell** (`style: app`), you can pair conversational AI with live data pages, selectable layouts, a header Notification Center, custom themes and installable plugins — all from one server.

## Build custom pages in Python or YAML

Add KPI cards, filterable tables, charts, forms and Markdown runbooks next to your chat.

<Tabs>
<Tab title="Python (@aiui.page)">
```python title="app.py"
import praisonaiui as aiui


@aiui.page("overview", title="Overview", icon="bar-chart-2", group="Workspace", badge="Live")
async def overview():
    return aiui.layout([
        aiui.columns([
            aiui.card("Active Users", value="1,420", footer="+12% this week"),
            aiui.card("Uptime", value="99.98%", footer="Last 30 days"),
        ]),
        aiui.table(
            headers=["Service", "Status"],
            rows=[["Chat Gateway", "Healthy"], ["Search Index", "Healthy"]],
        ),
    ])
```
</Tab>
<Tab title="Zero-code YAML">
Declare full pages in `app.yaml` — and split big apps across files with `$ref:`. Edits reload dynamically without restarting the server.

```yaml title="app.yaml"
style: app
branding:
  title: "Operations"
pages:
  - chat
  - id: overview
    title: "Overview"
    icon: "bar-chart-2"
    group: "Workspace"
    badge: "Live"
    components:
      - type: columns
        children:
          - type: metric
            label: "Active Users"
            value: "1,420"
            delta: "+12%"
          - type: card
            title: "Status"
            value: "Healthy"
```

Run it with `aiui run app.yaml`.
</Tab>
</Tabs>

## Key building blocks

<CardGroup cols={2}>
<Card title="Selectable layouts" icon="panels-top-left" href="../features/layouts.md">
Switch one app between Chat + Canvas, Workbench, Command, Guided and Mission Control.
</Card>
<Card title="Server & YAML pages" icon="layout-dashboard" href="../guides/server-pages.md">
URL query filters, POST forms, lazy tabs, auto-refresh, live sidebar badges and YAML `$ref` pages.
</Card>
<Card title="Notification Center" icon="bell" href="../features/notifications.md">
Push real-time alerts over SSE to the header bell with read/unread state and deep links.
</Card>
<Card title="Theming & Plugins" icon="palette" href="../features/theming.md">
Pick from 20+ color presets, light/dark modes, or ship full React pages as Python plugins.
</Card>
</CardGroup>

## Built-in dashboard pages

When you want an out-of-the-box operations console for your agents, enable built-in pages with `aiui.set_pages("all")` (or pick specific IDs with `aiui.set_pages(["chat", "sessions", "agents", "logs"])`). Every page shares the same theme, navigation and authentication. See [Dashboard](../features/dashboard.md) and [Focused app](../guides/focused-app.md).
