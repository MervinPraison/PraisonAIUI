"""Recall.ai HTTP routes for the meeting-agent example."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse

from integrations.recall.calendar import forward_calendar_callback
from integrations.recall.calendar_service import (
    list_upcoming_calendar_meetings,
    process_calendar_webhook,
    sync_calendar_events,
)
from integrations.recall.config import RecallConfigError, load_recall_settings
from integrations.recall.live import snapshot_for_api, wait_for_update
from integrations.recall.processor import process_recall_webhook
from integrations.recall.service import cancel_recall_bot, schedule_recall_bot
from integrations.recall.store import RecallStore
from integrations.recall.verify import VerificationError, verify_request_from_recall

logger = logging.getLogger(__name__)

_calendar_regional_uri: str | None = None


def set_calendar_regional_callback_uri(uri: str | None) -> None:
    global _calendar_regional_uri
    _calendar_regional_uri = uri


async def api_recall_schedule_bot(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)

    meeting_url = str(body.get("meeting_url") or "").strip()
    title = str(body.get("title") or "").strip()
    join_at = body.get("join_at")
    join_at_str = str(join_at).strip() if join_at else None

    result = await asyncio.to_thread(
        schedule_recall_bot,
        meeting_url,
        title,
        join_at=join_at_str,
    )
    status = 201 if result.get("recall_bot_id") else 400 if "error" in result else 500
    return JSONResponse(result, status_code=status)


async def api_recall_cancel_bot(request: Request) -> JSONResponse:
    meeting_id = request.path_params["meeting_id"]
    result = await asyncio.to_thread(cancel_recall_bot, meeting_id)
    status = 200 if "error" not in result else 400
    return JSONResponse(result, status_code=status)


async def api_recall_bot_status(request: Request) -> JSONResponse:
    meeting_id = request.path_params["meeting_id"]
    try:
        from praisonai_tools.tools.meeting_tools import get_meeting

        record = get_meeting.__wrapped__(meeting_id)
    except ImportError:
        return JSONResponse({"error": "meeting tools unavailable"}, status_code=503)
    if "error" in record:
        return JSONResponse(record, status_code=404)
    meta = record.get("metadata") or {}
    return JSONResponse(
        {
            "meeting_id": meeting_id,
            "title": record.get("title"),
            "status": meta.get("status"),
            "live_status": meta.get("live_status"),
            "recall_bot_id": meta.get("recall_bot_id"),
            "meeting_url": meta.get("meeting_url"),
            "transcript_preview": (meta.get("transcript") or "")[:500],
        }
    )


async def webhook_recall(request: Request) -> Response:
    raw = (await request.body()).decode("utf-8")
    try:
        settings = load_recall_settings()
    except RecallConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)

    headers = {k: v for k, v in request.headers.items()}
    try:
        verify_request_from_recall(
            secret=settings.webhook_verification_secret,
            headers=headers,
            payload=raw,
        )
    except VerificationError:
        return JSONResponse({"error": "invalid signature"}, status_code=401)

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    event_type = str(payload.get("event") or payload.get("type") or "unknown")
    if event_type.startswith("calendar."):
        asyncio.create_task(
            asyncio.to_thread(
                process_calendar_webhook,
                event_type,
                payload,
                settings=settings,
            )
        )
        return PlainTextResponse("ok", status_code=200)

    asyncio.create_task(
        asyncio.to_thread(process_recall_webhook, event_type, payload, settings=settings)
    )
    return PlainTextResponse("ok", status_code=200)


async def api_recall_calendar_callback(request: Request) -> Response:
    if not _calendar_regional_uri:
        return JSONResponse(
            {
                "error": "Calendar callback not configured. Bootstrap setup via "
                "POST /api/recall/calendar/setup/bootstrap with regional_callback_uri "
                "from Recall MCP start_calendar_integration_setup."
            },
            status_code=503,
        )
    params = dict(request.query_params)
    status, body = await asyncio.to_thread(
        forward_calendar_callback,
        regional_callback_uri=_calendar_regional_uri,
        query_params=params,
    )
    return PlainTextResponse(body, status_code=status)


async def api_recall_calendar_bootstrap(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    setup_id = str(body.get("setup_id") or "").strip()
    platform = str(body.get("platform") or "google_calendar").strip()
    regional_uri = str(body.get("regional_callback_uri") or "").strip()
    state = body.get("state") if isinstance(body.get("state"), dict) else {}

    if not setup_id or not regional_uri:
        return JSONResponse(
            {"error": "setup_id and regional_callback_uri are required"},
            status_code=400,
        )

    set_calendar_regional_callback_uri(regional_uri)
    RecallStore.save_calendar_setup(
        setup_id,
        platform,
        {
            **state,
            "regional_callback_uri": regional_uri,
            "platform": platform,
        },
    )
    callback_url = "(set PUBLIC_API_BASE_URL)"
    if os.getenv("PUBLIC_API_BASE_URL", "").strip():
        try:
            callback_url = load_recall_settings().calendar_callback_url
        except RecallConfigError:
            pass
    return JSONResponse(
        {
            "setup_id": setup_id,
            "callback_url": callback_url,
            "status": "bootstrapped",
        }
    )


async def api_recall_calendar_status(_request: Request) -> JSONResponse:
    auto_record = os.getenv("CALENDAR_AUTO_RECORD", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    public_url = os.getenv("PUBLIC_API_BASE_URL", "").strip()
    calendars: list[dict[str, Any]] = []
    try:
        from integrations.recall.client import RecallClient

        settings = load_recall_settings()
        calendars = RecallClient(settings).list_calendars(status="connected")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not list calendars: %s", exc)

    return JSONResponse(
        {
            "calendar_v2": {
                "auto_record_eligible_events": auto_record,
                "connected_calendars": len(calendars),
                "calendars": [
                    {
                        "id": c.get("id"),
                        "platform": c.get("platform"),
                        "email": c.get("platform_email") or c.get("email"),
                        "status": c.get("status"),
                    }
                    for c in calendars
                    if isinstance(c, dict)
                ],
                "callback_configured": bool(_calendar_regional_uri),
                "public_api_base_url_set": bool(public_url),
                "webhook_events": ["calendar.sync_events", "calendar.update"],
                "next_step": (
                    "Register calendar webhooks on the same /webhooks/recall URL, "
                    "then complete Google Calendar V2 OAuth via Recall MCP."
                ),
            }
        }
    )


async def api_recall_calendar_upcoming(request: Request) -> JSONResponse:
    hours = int(request.query_params.get("hours", "24"))
    try:
        rows = await asyncio.to_thread(list_upcoming_calendar_meetings, hours=hours)
    except RecallConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=502)
    return JSONResponse({"events": rows, "hours": hours})


async def api_recall_calendar_sync(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        body = {}
    calendar_id = str(body.get("calendar_id") or request.query_params.get("calendar_id") or "").strip()
    if not calendar_id:
        return JSONResponse({"error": "calendar_id is required"}, status_code=400)
    try:
        settings = load_recall_settings()
        result = await asyncio.to_thread(
            sync_calendar_events,
            calendar_id,
            updated_since=body.get("updated_at__gte"),
            settings=settings,
        )
    except RecallConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=502)
    return JSONResponse(result)


async def api_meeting_live_transcript(request: Request) -> Response:
    meeting_id = request.path_params["meeting_id"]
    accept = request.headers.get("accept", "")
    try:
        from praisonai_tools.tools.meeting_tools import get_meeting

        record = get_meeting.__wrapped__(meeting_id)
    except ImportError:
        return JSONResponse({"error": "meeting tools unavailable"}, status_code=503)
    if "error" in record:
        return JSONResponse(record, status_code=404)

    if "text/event-stream" not in accept:
        return JSONResponse(snapshot_for_api(meeting_id, record))

    async def event_stream():
        last_text = ""
        while True:
            try:
                from praisonai_tools.tools.meeting_tools import get_meeting

                record = get_meeting.__wrapped__(meeting_id)
            except ImportError:
                break
            snap = snapshot_for_api(meeting_id, record)
            text = snap.get("transcript") or ""
            live = (snap.get("live_status") or "").lower()
            if text != last_text:
                yield f"data: {json.dumps(snap)}\n\n"
                last_text = text
            if live not in ("live", "joining", "waiting_room", "scheduled", ""):
                break
            await asyncio.to_thread(wait_for_update, meeting_id, 25.0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


async def api_recall_config_status(_request: Request) -> JSONResponse:
    try:
        settings = load_recall_settings()
        configured = True
    except RecallConfigError as exc:
        settings = None
        configured = False
        error = str(exc)
    else:
        error = None

    return JSONResponse(
        {
            "configured": configured,
            "error": error,
            "region": settings.region if settings else os.getenv("RECALL_REGION"),
            "workspace_id": settings.workspace_id if settings else None,
            "webhook_url": settings.webhook_url if settings and settings.public_api_base_url else None,
            "bot_name": settings.bot_name if settings else None,
        }
    )

