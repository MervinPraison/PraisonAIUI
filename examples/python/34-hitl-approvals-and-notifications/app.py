"""Example 34 — Human-in-the-Loop Approvals & Live Notifications on One Dashboard.

Demonstrates on a single PraisonAIUI app shell (`style: app`):
  - Built-in **Approvals** queue (`builtin.approvals`, `/api/approvals`)
  - Built-in **Notification Center** bell (`builtin.notifications`, `/api/notifications/stream`)
  - Custom **Ops Queue** page (`@aiui.page("ops")`) with live sidebar badge, diff preview,
    interactive Approve/Deny controls, and real-time decision timeline
  - Chat handler (`@aiui.reply`) that queues a real high-risk approval and pushes a live
    Notification Center alert with a deep-link button when a user asks to deploy or delete

Run (no API key required):
    aiui run app.py
"""

from __future__ import annotations

import time
import uuid

import praisonaiui as aiui
from praisonaiui.features.approvals import get_approval_manager

aiui.configure(branding={"title": "HITL Ops Dashboard"})


def _queue_approval(
    tool_name: str,
    arguments: dict,
    *,
    risk_level: str = "high",
    agent_name: str = "release-agent",
    description: str = "",
) -> dict:
    """Create a real pending approval AND push a live Notification Center alert."""
    mgr = get_approval_manager()
    entry = mgr.request_approval(
        {
            "id": f"apr-{uuid.uuid4().hex[:8]}",
            "tool_name": tool_name,
            "arguments": arguments,
            "risk_level": risk_level,
            "agent_name": agent_name,
            "description": description or f"{agent_name} requested `{tool_name}`",
        }
    )
    aiui.push_notification(
        f"Approval required: {tool_name}",
        description or f"{agent_name} paused for human approval ({risk_level} risk)",
        type="warning",
        category="approvals",
        dedupe_key=f"approval-{entry['id']}",
        action={"label": "Review now", "page": "ops"},
    )
    return entry


def _ensure_seed_request() -> None:
    """Seed one realistic approval on first load so the dashboard is immediately interactive."""
    mgr = get_approval_manager()
    if not mgr.list_pending() and not mgr.list_history(limit=5):
        _queue_approval(
            "deploy_release",
            {"version": "v0.4.0", "environment": "production", "replicas": 4},
            risk_level="high",
            description="Roll out v0.4.0 to production cluster (4 replicas)",
        )


@aiui.welcome
async def on_welcome():
    _ensure_seed_request()
    await aiui.say(
        "Welcome to the **HITL Ops Dashboard**. Type **deploy** or **delete** in chat to "
        "trigger a live human-in-the-loop approval and watch the **Notification Bell** update "
        "in real time — or open **Ops Queue** / **Approvals** in the sidebar."
    )


@aiui.starters
def get_starters():
    return [
        {"label": "Request production deploy", "message": "Deploy v0.4.0 to production"},
        {"label": "Request destructive cleanup", "message": "Delete stale staging snapshots"},
        {"label": "Check pending queue", "message": "How many approvals are pending?"},
    ]


@aiui.reply
async def on_message(message: str):
    mgr = get_approval_manager()
    lower = message.lower()

    if "deploy" in lower:
        entry = _queue_approval(
            "deploy_release",
            {"version": "v0.4.0", "environment": "production", "requested_by": "chat"},
            risk_level="high",
            description="Triggered from chat: deploy v0.4.0 to production",
        )
        await aiui.notify(
            f"Approval {entry['id']} queued — open Ops Queue or the bell icon to review.",
            type="warning",
            persist=True,
            category="approvals",
        )
        await aiui.say(
            f"Paused before running `deploy_release` (**ID `{entry['id']}`**). "
            "A live alert was sent to the **Notification Bell** — review it on **Ops Queue** or **Approvals**."
        )
        return

    if "delete" in lower or "drop" in lower:
        entry = _queue_approval(
            "delete_snapshots",
            {"target": "staging-db", "older_than_days": 30},
            risk_level="critical",
            description="Triggered from chat: delete staging snapshots older than 30d",
        )
        await aiui.notify(
            f"Critical approval {entry['id']} requires review.",
            type="error",
            persist=True,
            category="approvals",
        )
        await aiui.say(
            f"Blocked destructive tool `delete_snapshots` (**ID `{entry['id']}`**, critical risk). "
            "Approve or deny from the **Notification Bell** or **Ops Queue**."
        )
        return

    pending = mgr.list_pending()
    await aiui.say(
        f"There are currently **{len(pending)}** pending approval(s). "
        "Say **deploy** or **delete** to simulate a new human-in-the-loop gate."
    )


@aiui.page("ops", title="Ops Queue", icon="shield-check", group="Workspace")
async def ops_page():
    """Live dashboard combining pending approvals, diff review, timeline, and sidebar badge."""
    _ensure_seed_request()
    mgr = get_approval_manager()
    pending = mgr.list_pending()
    history = mgr.list_history(limit=10)
    approved_count = sum(1 for item in history if item.get("status") == "approved")
    denied_count = sum(1 for item in history if item.get("status") == "denied")

    blocks = [
        aiui.header("Human-in-the-Loop Approvals & Live Notifications", level=2),
        aiui.stat_group(
            [
                aiui.metric("Pending Approvals", value=str(len(pending))),
                aiui.metric("Approved", value=str(approved_count)),
                aiui.metric("Denied", value=str(denied_count)),
            ]
        ),
        aiui.button_group(
            [
                {"label": "Simulate Deploy Approval", "action": "simulate_deploy", "variant": "primary"},
                {"label": "Approve Next", "action": "approve_next", "variant": "outline"},
                {"label": "Deny Next", "action": "deny_next", "variant": "destructive"},
            ]
        ),
    ]

    if pending:
        head = pending[0]
        blocks.append(
            aiui.callout(
                f"**Next pending tool:** `{head.get('tool_name')}` (`{head.get('id')}`, "
                f"risk: **{head.get('risk_level', 'high')}**) — {head.get('description', '')}",
                variant="warning",
                title="Action Required",
            )
        )
        blocks.append(
            aiui.diff_viewer(
                before="release: v0.3.183\nreplicas: 2\napproval_gate: strict",
                after="release: v0.4.0\nreplicas: 4\napproval_gate: strict",
                title=f"Proposed Change ({head.get('tool_name')})",
                before_label="Current",
                after_label="Proposed",
            )
        )
    else:
        blocks.append(aiui.alert("All pending approvals have been resolved.", variant="success", title="Queue Clear"))

    timeline_items = [
        {
            "title": f"{item.get('tool_name')} — {item.get('status', 'resolved').upper()}",
            "time": time.strftime("%H:%M:%S", time.localtime(item.get("resolved_at") or time.time())),
            "status": "success" if item.get("status") == "approved" else "error",
            "description": item.get("reason") or item.get("description") or "",
        }
        for item in history[:6]
    ]
    if timeline_items:
        blocks.append(aiui.timeline(timeline_items, title="Recent Approval Decisions"))

    return aiui.layout(blocks, badges={"ops": len(pending)}, refresh_every=5)


@aiui.register_page_action("ops")
async def on_ops_action(action: dict):
    """Handle dashboard button clicks and emit matching live notifications."""
    mgr = get_approval_manager()
    name = action.get("action")

    if name == "simulate_deploy":
        _queue_approval(
            "deploy_release",
            {"version": "v0.4.0", "environment": "production"},
            risk_level="high",
            description="Manual simulation from Ops Queue dashboard",
        )
    elif name == "approve_next":
        pending = mgr.list_pending()
        if pending:
            item = mgr.approve(pending[0]["id"], reason="Approved in Ops Queue")
            if item:
                aiui.push_notification(
                    f"Approved: {item['tool_name']}",
                    f"Request {item['id']} approved — agent resumed.",
                    type="success",
                    category="approvals",
                    action={"label": "View Ops Queue", "page": "ops"},
                )
    elif name == "deny_next":
        pending = mgr.list_pending()
        if pending:
            item = mgr.deny(pending[0]["id"], reason="Denied in Ops Queue")
            if item:
                aiui.push_notification(
                    f"Denied: {item['tool_name']}",
                    f"Request {item['id']} denied — agent halted safely.",
                    type="error",
                    category="approvals",
                    action={"label": "View Ops Queue", "page": "ops"},
                )

    return await ops_page()
