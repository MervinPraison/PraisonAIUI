"""Meeting Agent — PraisonAIUI example with Phase 1 upload pipeline + Recall.ai live bots.

Composes existing PraisonAIUI features plus PraisonAI-Tools meeting tools:

  - Upload API          → POST /api/meetings/upload (transcribe → summarize → index)
  - Live bot API        → POST /api/recall/bots (Recall Meeting Bot join)
  - Recall webhooks     → POST /webhooks/recall (verified, async processing)
  - Calendar callback   → GET /api/recall/calendar/callback (Calendar V2 OAuth)
  - Meetings list       → dashboard page backed by ``list_meetings``
  - Meeting detail      → latest stored meeting (transcript / summary / actions)
  - Chat                → PraisonAI Agent with ``search_meetings`` + meeting tools
  - Slack delivery      → optional via SlackChannelAdapter

Run:
    aiui run app.py
    python app.py
    python smoke_recall.py   # non-binding integration smoke
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import praisonaiui as aiui
from praisonaiui.server import create_app
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

_EXAMPLE_DIR = Path(__file__).resolve().parent
if str(_EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE_DIR))


def _load_local_env() -> None:
    """Load ``.env`` from the example dir when vars are not already set."""
    env_path = _EXAMPLE_DIR / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_local_env()

from pipeline import retry_pipeline, run_ingest_pipeline
from recall_routes import (
    api_recall_bot_status,
    api_recall_calendar_bootstrap,
    api_recall_calendar_callback,
    api_recall_calendar_status,
    api_recall_cancel_bot,
    api_recall_config_status,
    api_recall_schedule_bot,
    webhook_recall,
)

CHAT_SYSTEM_PROMPT = (
    "You are a meeting assistant. For any question about past meetings, decisions, "
    "owners, or action items you MUST call the search_meetings tool first and answer "
    "only from the retrieved transcripts and summaries. Never answer historical "
    "questions from memory. Cite every claim with a citation chip showing the meeting "
    "title linked to its detail page."
)

# Fallback demo rows for Slack block-shape tests and offline dashboard preview.
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
]

_agent: Any | None = None


def _recall_schedule_tool():
    from praisonai_tools.tools.decorator import tool

    from integrations.recall.service import schedule_recall_bot as _schedule

    @tool
    def schedule_recall_bot(meeting_url: str, title: str = "") -> dict:
        """Schedule a Recall.ai bot to join a meeting URL (Zoom, Meet, Teams)."""
        return _schedule(meeting_url, title)

    return schedule_recall_bot


def _load_meeting_tools():
    """Lazy-load meeting tools (keeps import-time deps light)."""
    from praisonai_tools.tools.meeting_tools import (
        extract_action_items,
        get_meeting,
        index_meeting,
        list_meetings,
        save_meeting,
        search_meetings,
        summarize_transcript,
        transcribe_file,
    )

    tools = [
        transcribe_file,
        save_meeting,
        get_meeting,
        list_meetings,
        summarize_transcript,
        extract_action_items,
        index_meeting,
        search_meetings,
    ]
    if os.getenv("RECALL_API_KEY"):
        tools.append(_recall_schedule_tool())
    return tools


def get_agent():
    """Return the meeting agent (created lazily on first chat)."""
    global _agent
    if _agent is not None:
        return _agent
    try:
        from praisonaiagents import Agent
    except ImportError as exc:
        raise ImportError(
            "praisonaiagents required. Install with: pip install praisonai"
        ) from exc

    _agent = Agent(
        name="Meeting Assistant",
        instructions=CHAT_SYSTEM_PROMPT,
        model="gpt-4o-mini",
        tools=_load_meeting_tools(),
    )
    # Default loop guard kills chat after 120s while search_meetings runs.
    from praisonaiagents.escalation.loop_guard import LoopGuard, LoopGuardConfig

    max_turn_sec = float(os.getenv("MEETING_AGENT_LOOP_GUARD_MAX_SEC", "600"))
    _agent._loop_guard = LoopGuard(
        LoopGuardConfig(enabled=True, max_time_per_turn=max_turn_sec)
    )
    return _agent


def _sync_stale_recall_status(record: dict[str, Any]) -> dict[str, Any]:
    """Refresh Recall bot status for meetings still marked joining/scheduled."""
    meta = record.get("metadata") or {}
    live = (meta.get("live_status") or "").lower()
    bot_id = meta.get("recall_bot_id")
    if not bot_id or live in ("ready", "failed", "cancelled", "processing"):
        return record
    if live not in ("joining", "scheduled", "waiting_room", "live", "ended", ""):
        return record
    if not os.getenv("RECALL_API_KEY"):
        return record
    try:
        from integrations.recall.client import RecallClient
        from integrations.recall.config import load_recall_settings
        from pipeline import merge_meeting_metadata

        bot = RecallClient(load_recall_settings()).get_bot(str(bot_id))
        changes = bot.get("status_changes") or []
        status = (changes[-1].get("code") if changes else bot.get("status") or "").lower()
        meeting_id = record.get("meeting_id", "")
        patch: dict[str, Any] = {}
        if status == "in_waiting_room":
            patch = {
                "live_status": "waiting_room",
                "status": "Scheduled",
                "error": (
                    "Bot is in the Google Meet waiting room — admit "
                    "'Praison Meeting Agent' to start recording."
                ),
            }
        elif status in ("done", "call_ended") and not (bot.get("recordings") or []):
            patch = {
                "live_status": "failed",
                "status": "failed",
                "error": "Meeting ended but bot never recorded (likely not admitted from waiting room).",
            }
        elif status == "done" and (bot.get("recordings") or []):
            patch = {"live_status": "processing"}
        if patch and meeting_id:
            merge_meeting_metadata(meeting_id, patch)
            meta = {**meta, **patch}
            record = {**record, "metadata": meta}
    except Exception:
        pass
    return record


def _record_to_view(record: dict[str, Any]) -> dict[str, Any]:
    """Normalise a tool meeting record for dashboard rendering."""
    meta = record.get("metadata") or {}
    actions = meta.get("action_items") or []
    return {
        "id": record.get("meeting_id", ""),
        "title": record.get("title", "Untitled"),
        "date": (record.get("created_at") or "")[:10],
        "status": meta.get("status", "Ready").replace("ready", "Ready").title(),
        "live_status": meta.get("live_status") or "",
        "recall_bot_id": meta.get("recall_bot_id") or "",
        "meeting_url": meta.get("meeting_url") or record.get("source") or "",
        "duration": _format_duration(meta.get("duration_seconds")),
        "transcript": meta.get("transcript") or "",
        "summary": meta.get("summary") or "",
        "error": meta.get("error") or "",
        "actions": [
            {
                "task": a.get("description", ""),
                "owner": a.get("owner") or "—",
                "due": a.get("due_date") or "—",
            }
            for a in actions
            if isinstance(a, dict)
        ],
    }


def _format_duration(seconds: Any) -> str:
    if not seconds:
        return "—"
    try:
        total = int(float(seconds))
    except (TypeError, ValueError):
        return "—"
    minutes, secs = divmod(total, 60)
    return f"{minutes}m {secs}s" if minutes else f"{secs}s"


def _list_meeting_views() -> list[dict[str, Any]]:
    try:
        from praisonai_tools.tools.meeting_tools import list_meetings

        rows = list_meetings.__wrapped__(limit=50, offset=0)
        if rows and isinstance(rows[0], dict) and "error" in rows[0]:
            return SAMPLE_MEETINGS
        rows = [_sync_stale_recall_status(r) for r in rows]
        views = [_record_to_view(r) for r in rows]
        return views or SAMPLE_MEETINGS
    except ImportError:
        return SAMPLE_MEETINGS


def _meeting(meeting_id: str) -> dict | None:
    try:
        from praisonai_tools.tools.meeting_tools import get_meeting

        record = get_meeting.__wrapped__(meeting_id)
        if "error" not in record:
            return _record_to_view(record)
    except ImportError:
        pass
    return next((m for m in SAMPLE_MEETINGS if m["id"] == meeting_id), None)


def _status_variant(status: str) -> str:
    return {
        "Ready": "default",
        "Indexing": "secondary",
        "Summarizing": "secondary",
        "Transcribing": "secondary",
        "Uploading": "secondary",
        "Error": "destructive",
        "Failed": "destructive",
        "Scheduled": "secondary",
        "Live": "default",
        "Processing": "secondary",
    }.get(status, "outline")


aiui.set_style("dashboard")
aiui.set_branding(title="Meeting Agent", logo="🗓️")
aiui.set_pages(
    ["upload", "live-bot", "meetings", "meeting-detail", "calendar", "chat"]
)
aiui.set_dashboard(sidebar=True, page_header=True)
aiui.set_chat_features(file_upload=True, feedback=True)


async def _emit_pipeline_chat_result(result: dict[str, Any]) -> None:
    """Surface pipeline progress/errors via standard chat status events."""
    if result.get("status") == "ready":
        await aiui.say(
            f"✅ **{result.get('title', 'Meeting')}** is ready. "
            f"Indexed {result.get('chunks_indexed', 0)} chunk(s)."
        )
        return
    if "error" in result:
        await aiui.say(f"❌ {result['error']}")
        meeting_id = result.get("meeting_id")
        if meeting_id:
            await aiui.action_buttons(
                [
                    {
                        "name": "retry-meeting",
                        "label": "Retry",
                        "payload": {"meeting_id": meeting_id},
                    }
                ]
            )
        return
    await aiui.say(str(result))


async def _chat_run_pipeline(fn, *args: Any) -> None:
    await aiui.think("Running meeting pipeline...")
    result = await asyncio.to_thread(fn, *args)
    await _emit_pipeline_chat_result(result)


@aiui.reply
async def on_message(message: str):
    """Chat: Q&A via meeting agent; retry failed uploads via chat commands."""
    text = str(message).strip()
    lower = text.lower()

    if lower.startswith("retry meeting "):
        meeting_id = text.split(maxsplit=2)[-1].strip()
        await _chat_run_pipeline(retry_pipeline, meeting_id)
        return
    if lower.startswith("/retry "):
        meeting_id = text.split(maxsplit=1)[-1].strip()
        await _chat_run_pipeline(retry_pipeline, meeting_id)
        return

    if not os.getenv("OPENAI_API_KEY"):
        await aiui.say("Set `OPENAI_API_KEY` to chat with the meeting assistant.")
        return

    await aiui.think("Searching meetings before answering...")
    agent = get_agent()
    response = await asyncio.to_thread(agent.chat, text)
    await aiui.say(str(response))


def _register_retry_action() -> None:
    from praisonaiui.actions import register_action_callback

    async def _on_retry_meeting(action) -> None:
        meeting_id = (action.payload or {}).get("meeting_id", "")
        if not meeting_id:
            await aiui.say("Missing meeting id for retry.")
            return
        await _chat_run_pipeline(retry_pipeline, meeting_id)

    register_action_callback("retry-meeting", _on_retry_meeting)


_register_retry_action()


@aiui.page("upload", title="Upload", icon="⬆️", group="Meetings", order=1)
async def upload_page():
    steps = ["Uploading", "Transcribing", "Summarizing", "Indexing", "Ready"]
    return aiui.layout(
        [
            aiui.text("Drop an audio or transcript file to add a meeting."),
            aiui.alert(
                "POST a multipart file to /api/meetings/upload with field ``file`` "
                "(optional ``title``). Supported: mp3, mp4, wav, webm, m4a, ogg.",
                variant="info",
                title="Upload API",
            ),
            aiui.code_block(
                'curl -F "file=@standup.mp3" -F "title=Weekly standup" '
                "http://127.0.0.1:8000/api/meetings/upload",
                language="bash",
            ),
            aiui.card("Processing pipeline", footer=" → ".join(steps)),
            aiui.text(
                "On error the pipeline surfaces a retry action via the standard "
                "chat status events; no bespoke state machine lives in the UI. "
                "In Chat, send ``retry meeting <id>`` or click **Retry** when offered."
            ),
        ]
    )


@aiui.page("live-bot", title="Live bot", icon="🤖", group="Meetings", order=2)
async def live_bot_page():
    port = os.environ.get("MEETING_AGENT_PORT", "8000")
    return aiui.layout(
        [
            aiui.text(
                "Send a Recall.ai Meeting Bot to a Zoom, Google Meet, or Teams URL. "
                "When the call ends, the Phase 1 summarize + index pipeline runs "
                "automatically on the Recall transcript."
            ),
            aiui.alert(
                "Requires RECALL_API_KEY, RECALL_WEBHOOK_VERIFICATION_SECRET, and "
                "PUBLIC_API_BASE_URL (HTTPS tunnel) in the server environment.",
                variant="info",
                title="Recall credentials",
            ),
            aiui.code_block(
                'curl -X POST http://127.0.0.1:'
                f"{port}/api/recall/bots "
                '-H "Content-Type: application/json" '
                '-d \'{"meeting_url":"https://zoom.us/j/123456789","title":"Standup"}\'',
                language="bash",
            ),
            aiui.text(
                "Poll status: ``GET /api/recall/bots/{meeting_id}``. "
                "Cancel: ``POST /api/recall/bots/{meeting_id}/cancel``."
            ),
        ]
    )


@aiui.page("calendar", title="Calendar", icon="📅", group="Meetings", order=5)
async def calendar_page():
    return aiui.layout(
        [
            aiui.text(
                "Google Calendar V2 auto-schedules Recall bots for eligible future "
                "events with video links (default: CALENDAR_AUTO_RECORD=true)."
            ),
            aiui.alert(
                "Complete Calendar V2 setup via Recall MCP "
                "(start_calendar_integration_setup) using "
                "``PUBLIC_API_BASE_URL/api/recall/calendar/callback`` as "
                "production_redirect_uri, then bootstrap with "
                "``POST /api/recall/calendar/setup/bootstrap``.",
                variant="info",
                title="Calendar V2 setup",
            ),
            aiui.code_block(
                "GET /api/recall/calendar/status",
                language="bash",
            ),
            aiui.text(
                "Recording opt-in: connecting a calendar syncs events; bots are "
                "sent only when CALENDAR_AUTO_RECORD is enabled (default on)."
            ),
        ]
    )


@aiui.page("meetings", title="Meetings", icon="📋", group="Meetings", order=3)
async def meetings_page():
    meetings = _list_meeting_views()
    rows = [
        [
            m["title"],
            m["date"],
            m["status"],
            str(len(m["actions"])),
            m["duration"],
        ]
        for m in meetings
    ]
    return aiui.layout(
        [
            aiui.metric("Meetings", value=len(meetings)),
            aiui.table(
                headers=["Title", "Date", "Status", "Actions", "Duration"],
                rows=rows,
            ),
        ]
    )


@aiui.page("meeting-detail", title="Meeting detail", icon="📝", group="Meetings", order=4)
async def meeting_detail_page():
    meetings = _list_meeting_views()
    meeting = meetings[0]
    action_rows = [[a["task"], a["owner"], a["due"]] for a in meeting["actions"]]
    live = meeting.get("live_status") or ""
    header: list[Any] = [
        aiui.text(meeting["title"]),
        aiui.badge(meeting["status"], variant=_status_variant(meeting["status"])),
    ]
    if live:
        header.append(aiui.badge(live.title(), variant="outline"))
    body: list[Any] = []
    if meeting.get("error"):
        body.append(aiui.alert(meeting["error"], variant="warning"))
    return aiui.layout(
        header
        + body
        + [
            aiui.tabs(
                [
                    {
                        "label": "Transcript",
                        "children": [aiui.code_block(meeting["transcript"] or "(empty)", language="text")],
                    },
                    {
                        "label": "Summary",
                        "children": [aiui.text(meeting["summary"] or "(not summarised yet)")],
                    },
                    {
                        "label": "Action items",
                        "children": [
                            aiui.table(
                                headers=["Task", "Owner", "Due"],
                                rows=action_rows or [["—", "—", "—"]],
                            )
                        ],
                    },
                ]
            ),
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
    ) or "• (none)"
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
    """Deliver a meeting summary to Slack (/meeting-summary <id>)."""
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


async def api_meetings_upload(request: Request) -> JSONResponse:
    """Accept multipart upload and run the ingest pipeline."""
    form = await request.form()
    upload = form.get("file")
    title = str(form.get("title") or "").strip() or None
    if upload is None or not getattr(upload, "filename", None):
        return JSONResponse({"error": "file field is required"}, status_code=400)

    suffix = Path(upload.filename).suffix.lower() or ".bin"
    from pipeline import AUDIO_SUFFIXES

    if suffix not in AUDIO_SUFFIXES:
        return JSONResponse(
            {"error": f"Unsupported file type: {suffix}. Allowed: {sorted(AUDIO_SUFFIXES)}"},
            status_code=400,
        )

    data = await upload.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)

    uploads_dir = Path(tempfile.gettempdir()) / "praisonai_meeting_uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest = uploads_dir / f"{os.urandom(8).hex()}{suffix}"
    dest.write_bytes(data)

    result = await asyncio.to_thread(run_ingest_pipeline, str(dest), title)
    if "error" in result and result.get("meeting_id"):
        result["retry_hint"] = f"retry meeting {result['meeting_id']}"
        result["retry_url"] = f"/api/meetings/{result['meeting_id']}/retry"
    status = 200 if result.get("status") == "ready" else 400 if "error" in result else 500
    return JSONResponse(result, status_code=status)


async def api_meeting_retry(request: Request) -> JSONResponse:
    meeting_id = request.path_params["meeting_id"]
    result = await asyncio.to_thread(retry_pipeline, meeting_id)
    if "error" in result and result.get("meeting_id"):
        result["retry_hint"] = f"retry meeting {result['meeting_id']}"
    status = 200 if result.get("status") == "ready" else 400 if "error" in result else 500
    return JSONResponse(result, status_code=status)


async def api_meetings_list(_request: Request) -> JSONResponse:
    return JSONResponse({"meetings": _list_meeting_views()})


async def api_meeting_detail(request: Request) -> JSONResponse:
    meeting_id = request.path_params["meeting_id"]
    meeting = _meeting(meeting_id)
    if meeting is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse(meeting)


app = create_app()
_meeting_routes = [
        Route("/api/meetings/upload", api_meetings_upload, methods=["POST"]),
        Route("/api/meetings/{meeting_id}/retry", api_meeting_retry, methods=["POST"]),
        Route("/api/meetings", api_meetings_list, methods=["GET"]),
        Route("/api/meetings/{meeting_id}", api_meeting_detail, methods=["GET"]),
        Route("/api/recall/bots", api_recall_schedule_bot, methods=["POST"]),
        Route("/api/recall/bots/{meeting_id}", api_recall_bot_status, methods=["GET"]),
        Route("/api/recall/bots/{meeting_id}/cancel", api_recall_cancel_bot, methods=["POST"]),
        Route("/api/recall/config", api_recall_config_status, methods=["GET"]),
        Route("/webhooks/recall", webhook_recall, methods=["POST"]),
        Route("/api/recall/calendar/callback", api_recall_calendar_callback, methods=["GET"]),
        Route(
            "/api/recall/calendar/setup/bootstrap",
            api_recall_calendar_bootstrap,
            methods=["POST"],
        ),
        Route("/api/recall/calendar/status", api_recall_calendar_status, methods=["GET"]),
    ]
# Prepend so custom /api/* routes win over the SPA catch-all from create_app().
app.routes[0:0] = _meeting_routes


if __name__ == "__main__":
    if "--smoke" in sys.argv:
        from smoke_recall import run_smoke

        run_smoke()
        raise SystemExit(0)

    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("MEETING_AGENT_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
