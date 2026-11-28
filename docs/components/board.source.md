---
title: Board
nav_title: Board
description: Kanban-style column board for tracking agent tasks, tickets, and workflow stages.
---

# Board

`board()` renders horizontal Kanban columns of cards—ideal for task queues, multi-agent pipelines, and review workflows.

<ComponentPreview title="Kanban Board">
{
  "type": "board",
  "title": "Agent Task Board",
  "columns": [
    {
      "id": "queued",
      "title": "Queued",
      "cards": [
        {"title": "Index API docs", "description": "Embed 120 markdown pages", "footer": "RAG"},
        {"title": "Audit prompts", "description": "Run regression suite", "footer": "QA"}
      ]
    },
    {
      "id": "running",
      "title": "Running",
      "cards": [
        {"title": "Summarize PR #637", "description": "Checking bundle budgets", "footer": "Reviewer"}
      ]
    },
    {
      "id": "done",
      "title": "Completed",
      "cards": [
        {"title": "Publish v0.3", "description": "PyPI + Docs live", "footer": "Release"}
      ]
    }
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.board(
    columns=[
        {
            "id": "queued",
            "title": "Queued",
            "cards": [aiui.card("Index API docs", value="120 pages", footer="RAG")],
        },
        {
            "id": "running",
            "title": "Running",
            "cards": [aiui.card("Summarize PR #637", value="In progress", footer="Reviewer")],
        },
    ]
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: board
  columns:
    - id: "queued"
      title: "Queued"
      cards:
        - title: "Index API docs"
          description: "Embed 120 markdown pages"
          footer: "RAG"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `columns` | `list[dict]` | List of `{id, title, limit?, cards: [...]}` columns; cards accept `card()`, plain dicts, or any block node. |
