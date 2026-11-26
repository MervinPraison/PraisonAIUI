---
title: Human-in-the-Loop Approvals
nav_title: Approvals
description: Require explicit human approval before agents run sensitive tools, with inline chat cards, a dedicated Approvals queue and SSE updates.
---

# Human-in-the-Loop Approvals

When an agent is about to execute a sensitive tool (shell commands, deployments, payments, file deletions), PraisonAIUI pauses the run and asks a human to **Approve** or **Deny** — inline inside the chat thread and in the built-in **Approvals** page (`builtin.approvals`).

## How it works

1. The agent runtime or backend submits an approval request (`POST /api/approvals`).
2. Connected browsers receive it live over SSE (`GET /api/approvals/stream`) and show an inline approval card in chat plus an entry on the **Approvals** page.
3. A reviewer clicks **Approve** (`POST /api/approvals/{id}/approve`) or **Deny** (`POST /api/approvals/{id}/deny`), optionally updating reusable policy rules (`PUT /api/approvals/policies`).
4. The agent resumes or aborts cleanly, and the decision is recorded in `GET /api/approvals/history`.

## REST & SSE endpoints

All routes sit behind the server's active auth middleware (R8).

| Method & Path | Purpose |
|---|---|
| `GET /api/approvals` | List all approvals (or `GET /api/approvals/pending` for open items) |
| `POST /api/approvals` | Create a new approval request |
| `POST /api/approvals/{approval_id}/approve` | Approve a pending request |
| `POST /api/approvals/{approval_id}/deny` | Deny a pending request |
| `GET /api/approvals/history` | Audit log of past decisions |
| `GET` / `PUT /api/approvals/policies` | Inspect or update automatic approval policies |
| `GET /api/approvals/stream` | Real-time SSE stream of approval events |

## Enable or disable

Approvals are enabled by default in the app shell. To hide the built-in Approvals page and disable its routes:

```yaml
extensions:
  disabled:
    - builtin.approvals
```
