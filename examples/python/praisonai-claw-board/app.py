"""Board page from aiui jobs — status columns."""

import os

import praisonaiui as aiui
from praisonaiui.server import create_app

aiui.set_style("dashboard")
aiui.set_pages(["jobs-board"])
aiui.set_dashboard(modules=["jobs"], sidebar=True)


def _card(job: dict) -> dict:
    title = (job.get("prompt") or job.get("id") or "Job")[:80]
    return aiui.card(title, footer=job.get("status", ""))


@aiui.page("jobs-board", title="Jobs Board", icon="📋", group="Work")
async def jobs_board():
    from praisonaiui.features.jobs import get_job_store

    jobs = get_job_store().list_all()
    cols = ["queued", "running", "succeeded", "failed"]
    columns = []
    for c in cols:
        cards = [_card(j) for j in jobs if j.get("status") == c]
        columns.append({"id": c, "title": c.title(), "cards": cards or [aiui.card("(empty)")]})
    return aiui.layout([aiui.board(columns=columns)])


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8082")))
