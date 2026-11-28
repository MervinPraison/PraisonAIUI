# Human-in-the-Loop Approvals

> Require explicit human approval before agents run sensitive tools, with inline chat cards, a dedicated Approvals queue and SSE updates.

When an agent is about to execute a sensitive tool (shell commands, deployments, payments, file deletions), PraisonAIUI pauses the run and asks a human to **Approve** or **Deny** — inline inside the chat thread and in the built-in **Approvals** page (`builtin.approvals`).

## How it works

1. The agent runtime or backend submits an approval request (`POST /api/approvals`).
2. Connected browsers receive it live over SSE (`GET /api/approvals/stream`) and show an inline approval card in chat plus an entry on the **Approvals** page.
3. Pair with `aiui.push_notification(..., action={"label": "Review now", "page": "approvals"})` so operators also get an immediate toast + unread badge in the header **Notification Bell** on the same dashboard.
4. A reviewer clicks **Approve** (`POST /api/approvals/{id}/approve`) or **Deny** (`POST /api/approvals/{id}/deny`), optionally updating reusable policy rules (`PUT /api/approvals/policies`).
5. The agent resumes or aborts cleanly, and the decision is recorded in `GET /api/approvals/history`.

## Live simulation: HITL approval + notification dashboard

[
  {
    "type": "stat_group",
    "stats": [
      {"type": "metric", "label": "Pending Approvals", "value": "1"},
      {"type": "metric", "label": "Approved Today", "value": "14", "delta": "+3"},
      {"type": "metric", "label": "Denied", "value": "2"}
    ]
  },
  {
    "type": "callout",
    "variant": "warning",
    "title": "Action Required — deploy_release (High Risk)",
    "content": "`release-agent` paused before deploying **v0.4.0** to production. A matching alert was pushed to the header Notification Bell."
  },
  {
    "type": "diff_viewer",
    "title": "Proposed Production Change",
    "before_label": "Current",
    "after_label": "Proposed",
    "before": "release: v0.3.183\nreplicas: 2\napproval_gate: strict",
    "after": "release: v0.4.0\nreplicas: 4\napproval_gate: strict"
  },
  {
    "type": "button_group",
    "buttons": [
      {"label": "Approve & Resume Agent", "action": "approve_release", "variant": "primary"},
      {"label": "Deny & Halt", "action": "deny_release", "variant": "destructive"}
    ]
  }
]

Run the complete combined Python + YAML example locally (no API key needed):

```bash
cd examples/python/34-hitl-approvals-and-notifications
aiui run app.py
```

See [34-hitl-approvals-and-notifications](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/python/34-hitl-approvals-and-notifications) and [Notification Center](https://ui.praison.ai/docs/features/notifications.md).

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

## Related pages

- [Interactive Response Examples](https://ui.praison.ai/docs/a2ui/response-examples.md)
- [Notification Center](https://ui.praison.ai/docs/features/notifications.md)
- [Code Execution](https://ui.praison.ai/docs/features/code-execution.md)
