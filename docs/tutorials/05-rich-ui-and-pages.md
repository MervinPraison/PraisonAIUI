---
title: "Step 5: Rich UI, Notifications & Custom Pages"
nav_title: "5. Rich UI & Custom Pages"
description: Expand your chat app into a multi-page workspace with metric cards, filterable tables, live bell notifications and selectable layouts.
---

# Step 5: Rich UI, Notifications & Custom Pages

So far, everything has lived inside the chat thread. In Step 5, you will turn your chat app into a complete **workspace** with a custom data page in the sidebar, live header notifications, and a side-by-side canvas layout.

**What's new in Step 5:** `await aiui.send_block()`, `@aiui.page()`, `aiui.chat_panel()`, `aiui.interface()`, `aiui.push_notification()`, `aiui.set_layout()`, and zero-code YAML pages.

## Add a live page and notifications

<Steps>
<Step title="Add a custom page with KPI cards, filters and a table">
Add `@aiui.page(...)` to `app.py`. Returning `aiui.layout([...])` renders responsive cards, forms, charts and tables inside the app shell:

```python title="app.py"
ITEMS = [
    {"name": "Onboarding Guide", "status": "Published", "views": 1420},
    {"name": "API Checklist", "status": "Draft", "views": 310},
    {"name": "Release Notes", "status": "Published", "views": 890},
]


@aiui.page("insights", title="Insights", icon="bar-chart-2", group="Workspace", badge=lambda: len(ITEMS))
async def insights_page(params):
    status = params.get("status", "All")
    rows = [i for i in ITEMS if status == "All" or i["status"] == status]

    return aiui.layout([
        aiui.columns([
            aiui.card("Total Docs", value=len(ITEMS)),
            aiui.card("Showing", value=len(rows), footer=f"Filter: {status}"),
        ]),
        aiui.form("insights", method="get", submit_label="Filter", children=[
            aiui.select_input("Status", name="status", options=["All", "Published", "Draft"], value=status),
        ]),
        aiui.table(
            headers=["Name", "Status", "Views"],
            rows=[[r["name"], r["status"], r["views"]] for r in rows],
        ),
    ])
```
</Step>
<Step title="Push live alerts to the header Notification Center">
Send a persistent alert from a chat handler (`persist=True`) or from any background job with `aiui.push_notification()` — users see the unread badge update live on the top bell icon and can click straight to your page:

```python title="app.py"
aiui.push_notification(
    "Insights updated",
    "3 workspace documents are ready to review",
    type="success",
    category="workspace",
    action={"label": "Open Insights", "page": "insights"},
)
```
</Step>
<Step title="Try selectable layouts or zero-code YAML pages">
Run your app in the **Chat + Canvas** layout (or let users pick their own frame):

```bash
AIUI_LAYOUT=chat-canvas aiui run app.py
```

Want to build pages purely in YAML without Python? Put `pages:` in `app.yaml` and run `aiui run app.yaml` — see [Declarative YAML pages](../guides/server-pages.md#6-declarative-yaml-pages).
</Step>
</Steps>

## What you learned

- `await aiui.send_block(...)` renders any of the 81 UI blocks (including DataFrames and Plotly charts) inline inside chat replies.
- `@aiui.page()` adds URL-filterable dashboards and split-pane workspaces (`aiui.chat_panel()`) beside your chat with live sidebar badges — or wrap any Python function in 5 lines with `aiui.interface()`.
- `aiui.push_notification()` streams real-time alerts into the built-in header Notification Center.

## Next step

<CardGroup cols={2}>
<Card title="Step 6: Theme, Secure & Deploy" icon="shield-check" href="06-theme-auth-deploy.md">
Apply your brand colors, save chat history, turn on sign-in and deploy to production.
</Card>
<Card title="Step 4: Steps, Tools & Prompts" icon="arrow-left" href="04-steps-and-tools.md">
Review Step 4.
</Card>
</CardGroup>
