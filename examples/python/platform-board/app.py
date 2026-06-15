"""Board from praisonai-platform issues (optional separate service)."""

import os

import httpx
import praisonaiui as aiui
from praisonaiui.server import create_app

PLATFORM = os.getenv("PRAISONAI_PLATFORM_URL", "http://127.0.0.1:8000")
WORKSPACE_ID = os.getenv("PRAISONAI_PLATFORM_WORKSPACE_ID", "default")

aiui.set_style("dashboard")
aiui.set_pages(["issues-board"])
aiui.set_dashboard(sidebar=True)


@aiui.page("issues-board", title="Issues", icon="📌", group="Work")
async def issues_board():
    issues = []
    url = f"{PLATFORM.rstrip('/')}/api/v1/workspaces/{WORKSPACE_ID}/issues"
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(url)
            if r.status_code == 200:
                d = r.json()
                issues = d if isinstance(d, list) else d.get("issues") or d.get("items") or []
    except Exception:
        pass
    by: dict[str, list] = {}
    for i in issues:
        s = (i.get("status") or "backlog").lower().replace(" ", "_")
        by.setdefault(s, []).append(i)
    columns = []
    for sid in ("backlog", "in_progress", "done"):
        cards = [aiui.card(i.get("title", "Issue"), footer=sid) for i in by.get(sid, [])]
        columns.append({"id": sid, "title": sid.replace("_", " ").title(), "cards": cards or [aiui.card("(empty)")]})
    return aiui.layout([
        aiui.text(f"Platform: {PLATFORM} · workspace: {WORKSPACE_ID}"),
        aiui.board(columns=columns),
    ])


app = create_app()
