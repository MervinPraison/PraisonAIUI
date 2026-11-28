---
nav_title: Work Hub & Kanban
---

# Work Hub, Kanban & Jobs Board

PraisonAIUI ships a multi-agent task tracking workspace under the **Work** sidebar group with three built-in views:

| Page ID | Title | Description |
|---|---|---|
| `work` | **Work Hub** | Full-bleed workspace combining the kanban board, card details, chat, and job log |
| `kanban` | **Kanban** | Multi-agent task board with drag-and-drop columns and live SSE sync |
| `jobs-board` | **Jobs Board** | Async jobs (`GET /api/jobs/board`) grouped by execution status |

All three pages belong to the built-in plugin `builtin.work`, backed by `KanbanFeature` (`/api/kanban/*`).

## Board Columns

Every board organizes cards across seven workflow columns (plus `archived`, hidden unless `?archived=true`):

`triage` → `todo` → `ready` → `running` → `blocked` → `review` → `done`

Each task card tracks `title`, `status`, `assignee`, `priority`, `tenant`, `board`, `body`, `comments`, `meta`, and optional child subtask progress (`children` or `meta.progress`).

## REST & Live SSE API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/kanban/board` | Get columns and cards (`?board=default&tenant=...&archived=false`) |
| `GET` | `/api/kanban/boards` | List available board names |
| `POST` | `/api/kanban/tasks` | Create a task (`201`) |
| `POST` | `/api/kanban/tasks/bulk` | Move multiple `task_ids` to a target `status` |
| `GET` | `/api/kanban/tasks/{task_id}` | Fetch full task details |
| `PATCH` | `/api/kanban/tasks/{task_id}` | Update task fields |
| `DELETE` | `/api/kanban/tasks/{task_id}` | Delete a task |
| `POST` | `/api/kanban/tasks/{task_id}/move` | Move a task to a new column (`{"status": "review"}`) |
| `POST` | `/api/kanban/tasks/{task_id}/comments` | Append a comment (`{"text": "...", "author": "..."}`) |
| `GET` | `/api/kanban/events` | SSE stream (`text/event-stream`) of task changes (`?board=default&since=0`) |
| `GET` | `/api/kanban/health` | Store health, task count, and board list |

### Quick Example

```bash
# Create a task
curl -X POST http://127.0.0.1:8000/api/kanban/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Audit Q4 metrics", "status": "todo", "assignee": "analyst", "priority": "high"}'

# Move it to running
curl -X POST http://127.0.0.1:8000/api/kanban/tasks/<task_id>/move \
  -H "Content-Type: application/json" \
  -d '{"status": "running"}'
```

## Custom Storage Backends

By default `KanbanFeature` uses `SimpleKanbanStore` (in-memory, zero dependencies). To persist boards in SQL, Redis, or an external issue tracker, implement the `KanbanStoreProtocol` methods (from `praisonaiui.features.kanban`) and register a zero-argument factory before the first request:

```python
from praisonaiui.backends import set_backend

set_backend("kanban_store", lambda: MyKanbanStore())
```

## Disabling

```yaml
extensions:
  disabled:
    - builtin.work
```

## See Also

- [Board Component](../components/board.md)
- [Schedules & Jobs](schedules-and-jobs.md)
- [Features REST API](../api/features-api.md#kanban)
