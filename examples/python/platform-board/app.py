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


async def _fetch_issues() -> tuple[list, str | None]:
    """Return (issues, error_message). error_message is None on success."""
    url = f"{PLATFORM.rstrip('/')}/api/v1/workspaces/{WORKSPACE_ID}/issues"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
    except httpx.ConnectError:
        return [], f"Cannot reach platform at {PLATFORM}"
    except httpx.TimeoutException:
        return [], f"Platform request timed out ({PLATFORM})"
    except Exception as exc:
        return [], f"Platform request failed: {exc}"

    if response.status_code in (401, 403):
        return [], f"Platform auth failed (HTTP {response.status_code})"
    if response.status_code != 200:
        return [], f"Platform error (HTTP {response.status_code})"

    try:
        data = response.json()
    except ValueError:
        return [], "Platform returned invalid JSON"

    if isinstance(data, list):
        issues = data
    elif isinstance(data, dict):
        issues = data.get("issues") or data.get("items") or []
    else:
        issues = []
    return issues, None


@aiui.page("issues-board", title="Issues", icon="📌", group="Work")
async def issues_board():
    issues, error = await _fetch_issues()

    if error:
        return aiui.layout([
            aiui.text(f"Platform: {PLATFORM} · workspace: {WORKSPACE_ID}"),
            aiui.card("Platform unavailable", footer=error),
        ])

    by: dict[str, list] = {}
    for issue in issues:
        status = (issue.get("status") or "backlog").lower().replace(" ", "_")
        by.setdefault(status, []).append(issue)

    columns = []
    for status_id in ("backlog", "in_progress", "done"):
        cards = [aiui.card(i.get("title", "Issue"), footer=status_id) for i in by.get(status_id, [])]
        if not cards:
            cards = [aiui.card("(no issues)")]
        columns.append({
            "id": status_id,
            "title": status_id.replace("_", " ").title(),
            "cards": cards,
        })

    summary = f"{len(issues)} issue(s)" if issues else "No issues in workspace"
    return aiui.layout([
        aiui.text(f"Platform: {PLATFORM} · workspace: {WORKSPACE_ID} · {summary}"),
        aiui.board(columns=columns),
    ])


app = create_app()

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8082"))
    uvicorn.run(app, host=host, port=port)
