---
title: Schedules, Background Jobs & Kanban Boards
nav_title: Schedules, jobs & boards
description: Run recurring agent schedules (cron), monitor async background jobs and track tasks on built-in Kanban boards.
---

# Schedules, Background Jobs & Kanban Boards

PraisonAIUI ships three built-in operational plugins for long-running and recurring agent work:

- **Schedules (`builtin.cron`)**: Recurring agent tasks with natural-language or cron schedules (`hourly`, `daily`, `*/30m`, `cron:0 9 * * 1-5`, `at:ISO`), backed by `config.yaml` and wired into agent schedule tools.
- **Jobs (`builtin.jobs`)**: Async job submission, progress tracking, live stats and cancellation.
- **Work / Kanban (`builtin.work`)**: Built-in task board (`work`, `jobs-board`, `kanban`) plus the composable `aiui.board(columns=[...])` component for custom pages.

## API overview

| Feature | Key endpoints |
|---|---|
| **Schedules** | `GET /api/schedules`, `POST /api/schedules`, `POST /api/schedules/{id}/run`, `POST /api/schedules/{id}/stop`, `GET /api/schedules/{id}/stats` |
| **Jobs** | `GET /api/jobs`, `POST /api/jobs`, `GET /api/jobs/stats`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel` |
| **Kanban** | `GET /api/kanban`, `POST /api/kanban/cards`, `PUT /api/kanban/cards/{id}`, `DELETE /api/kanban/cards/{id}` |

## Build a custom status or board page

Combine `aiui.status()` (with `refresh_every`) and `aiui.board()` in any `@aiui.page` handler:

```python
import praisonaiui as aiui


@aiui.page("workboard", title="Workboard", icon="kanban", group="Work", refresh_every=5)
async def workboard():
    return aiui.layout([
        aiui.status("Nightly report", state="running", detail="Summarizing 12 channels", progress=65),
        aiui.board(columns=[
            {"title": "Queued", "cards": [aiui.card("Audit docs", footer="scheduled")]},
            {"title": "Running", "cards": [aiui.card("Nightly report", footer="65%")]},
            {"title": "Done", "cards": [aiui.card("Sync index", footer="ok")]},
        ]),
    ])
```

Show the built-in pages in your sidebar with `aiui.set_pages(["chat", "cron", "jobs", "work"])` or `aiui.set_pages("all")`.
