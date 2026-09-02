"""Meeting Agent — thin PraisonAIUI example (PAI-MEET-UI, issue #260).

Composes existing PraisonAIUI features via YAML/config only:

  - Upload page          → reuses the ``attachments`` feature (POST /api/chat/attachments)
  - Meetings list        → dashboard page built from ``aiui.ui`` helpers
  - Meeting detail       → tabbed dashboard page (Transcript / Summary / Action items)
  - Chat                 → system prompt enforces "search meetings first" + citation chips
  - Slack delivery       → optional, via the existing SlackChannelAdapter (lazy slack_sdk)

This example adds NO agent-runtime logic and NO agent-callable tools. Those live in
external repositories:

  - Agent core → MervinPraison/PraisonAI          (PAI-MEET-CORE)
  - Tools      → MervinPraison/PraisonAI-Tools    (PAI-MEET-TOOLS)

The dashboard runs without any Slack tokens (dashboard-only mode). Heavy deps
(openai, slack_sdk, chromadb) are never imported eagerly here.

Run:
    aiui run app.py
"""

from __future__ import annotations

import os

import praisonaiui as aiui
from praisonaiui.server import create_app

CHAT_SYSTEM_PROMPT = (
    "You are a meeting assistant. For any question about past meetings, decisions, "
    "owners, or action items you MUST call the search_meetings tool first and answer "
    "only from the retrieved transcripts and summaries. Never answer historical "
    "questions from memory. Cite every claim with a citation chip showing the meeting "
    "title linked to its detail page."
)

SAMPLE_MEETINGS: list[dict] = [
    {
        "id": "m-1001",
        "title": "Q3 Planning Kickoff",
        "date": "2026-07-01",
        "status": "Ready",
        "duration": "48m",
        "transcript": "Alice: Let's align on Q3 goals...\nBob: Priorities are onboarding and billing.",
        "summary": "Team aligned on Q3 priorities: onboarding revamp and billing reliability.",
        "actions": [
            {"task": "Draft onboarding spec", "owner": "Alice", "due": "2026-07-08"},
            {"task": "Audit billing retries", "owner": "Bob", "due": "2026-07-10"},
        ],
    },
    {
        "id": "m-1002",
        "title": "Billing Reliability Review",
        "date": "2026-07-09",
        "status": "Summarizing",
        "duration": "32m",
        "transcript": "Bob: Retry storms caused duplicate charges...\nCara: We need idempotency keys.",
        "summary": "Root-caused duplicate charges to missing idempotency keys; fix scheduled.",
        "actions": [
            {"task": "Add idempotency keys", "owner": "Cara", "due": "2026-07-16"},
        ],
    },
]


def _meeting(meeting_id: str) -> dict | None:
    return next((m for m in SAMPLE_MEETINGS if m["id"] == meeting_id), None)


def _status_variant(status: str) -> str:
    return {
        "Ready": "default",
        "Indexing": "secondary",
        "Summarizing": "secondary",
        "Transcribing": "secondary",
        "Uploading": "secondary",
        "Error": "destructive",
    }.get(status, "outline")


aiui.set_style("dashboard")
aiui.set_branding(title="Meeting Agent", logo="🗓️")
aiui.set_pages(["upload", "meetings", "meeting-detail", "chat"])
aiui.set_dashboard(sidebar=True, page_header=True)
aiui.set_chat_features(file_upload=True, feedback=True)


@aiui.page("upload", title="Upload", icon="⬆️", group="Meetings", order=1)
async def upload_page():
    steps = ["Uploading", "Transcribing", "Summarizing", "Indexing", "Ready"]
    return aiui.layout(
        [
            aiui.text("Drop an audio or transcript file to add a meeting."),
            aiui.alert(
                "Files are uploaded via the built-in attachments feature "
                "(POST /api/chat/attachments). Transcription, summarization and "
                "indexing run in the PraisonAI agent (PAI-MEET-CORE).",
                variant="info",
                title="How it works",
            ),
            aiui.card(
                "Processing pipeline",
                footer=" → ".join(steps),
            ),
            aiui.text(
                "On error the pipeline surfaces a retry action via the standard "
                "chat status events; no bespoke state machine lives in the UI."
            ),
        ]
    )


@aiui.page("meetings", title="Meetings", icon="📋", group="Meetings", order=2)
async def meetings_page():
    rows = [
        [
            m["title"],
            m["date"],
            m["status"],
            str(len(m["actions"])),
            m["duration"],
        ]
        for m in SAMPLE_MEETINGS
    ]
    return aiui.layout(
        [
            aiui.metric("Meetings", value=len(SAMPLE_MEETINGS)),
            aiui.table(
                headers=["Title", "Date", "Status", "Actions", "Duration"],
                rows=rows,
            ),
        ]
    )


@aiui.page("meeting-detail", title="Meeting detail", icon="📝", group="Meetings", order=3)
async def meeting_detail_page():
    meeting = SAMPLE_MEETINGS[0]
    action_rows = [[a["task"], a["owner"], a["due"]] for a in meeting["actions"]]
    return aiui.layout(
        [
            aiui.text(meeting["title"]),
            aiui.badge(meeting["status"], variant=_status_variant(meeting["status"])),
            aiui.tabs(
                [
                    {
                        "label": "Transcript",
                        "children": [aiui.code_block(meeting["transcript"], language="text")],
                    },
                    {
                        "label": "Summary",
                        "children": [aiui.text(meeting["summary"])],
                    },
                    {
                        "label": "Action items",
                        "children": [
                            aiui.table(
                                headers=["Task", "Owner", "Due"],
                                rows=action_rows,
                            )
                        ],
                    },
                ]
            ),
        ]
    )


@aiui.reply
async def on_message(message: str):
    await aiui.think("Searching meetings before answering...")
    hits = [
        m
        for m in SAMPLE_MEETINGS
        if message.lower() in (m["title"] + " " + m["summary"]).lower()
    ]
    if not hits:
        hits = SAMPLE_MEETINGS
    top = hits[0]
    await aiui.say(top["summary"])
    await aiui.action_buttons(
        [
            {
                "name": f"open:{m['id']}",
                "label": f"📎 {m['title']}",
            }
            for m in hits
        ]
    )


def _slack_adapter():
    """Construct a Slack adapter only when tokens are configured (lazy slack_sdk)."""
    bot = os.environ.get("SLACK_BOT_TOKEN", "")
    app_token = os.environ.get("SLACK_APP_TOKEN", "")
    if not bot or not app_token:
        return None
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    return SlackChannelAdapter({"bot_token": bot, "app_token": app_token})


def _summary_blocks(meeting: dict) -> list[dict]:
    action_lines = "\n".join(
        f"• {a['task']} — {a['owner']} (due {a['due']})" for a in meeting["actions"]
    )
    return [
        {"type": "header", "text": {"type": "plain_text", "text": meeting["title"]}},
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*Date:* {meeting['date']}"}},
        {"type": "section", "text": {"type": "mrkdwn", "text": meeting["summary"]}},
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*Action items*\n{action_lines}"}},
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"Dashboard: /meeting-detail#{meeting['id']}"}],
        },
    ]


async def post_meeting_summary(meeting_id: str, channel_id: str) -> bool:
    """Deliver a meeting summary to Slack (/meeting-summary <id>).

    Returns False when Slack is not configured — the dashboard still works.
    """
    meeting = _meeting(meeting_id)
    if meeting is None:
        return False
    adapter = _slack_adapter()
    if adapter is None:
        return False
    await adapter.start()
    try:
        await adapter.send_message(
            channel_id,
            meeting["summary"],
            blocks=_summary_blocks(meeting),
        )
    finally:
        await adapter.stop()
    return True


app = create_app()


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("MEETING_AGENT_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
