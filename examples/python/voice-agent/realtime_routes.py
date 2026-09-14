"""HTTP routes for OpenAI Realtime WebRTC voice."""

from __future__ import annotations

import logging

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from integrations.voice.realtime import (
    RealtimeConfigError,
    load_realtime_settings,
    mark_session_started,
    new_call_id,
    persist_transcript_line,
    realtime_enabled,
    create_webrtc_session,
)

logger = logging.getLogger(__name__)


async def api_realtime_config(_request: Request) -> JSONResponse:
    try:
        settings = load_realtime_settings()
        enabled = realtime_enabled()
        error = None
    except RealtimeConfigError as exc:
        settings = None
        enabled = False
        error = str(exc)
    return JSONResponse(
        {
            "enabled": enabled,
            "error": error,
            "model": settings.model if settings else None,
            "voice": settings.voice if settings else None,
            "reasoning_effort": settings.reasoning_effort if settings else None,
            "first_message": settings.first_message if settings else None,
        }
    )


async def api_realtime_new_call(request: Request) -> JSONResponse:
    from integrations.voice.session_memory import bind_call_user, voice_user_session_id

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    call_id = new_call_id()
    mark_session_started(call_id)
    user_id = str(payload.get("user_id") or "").strip()
    praison_session_id = None
    if user_id:
        praison_session_id = bind_call_user(call_id, user_id)
    return JSONResponse(
        {
            "call_id": call_id,
            "user_id": user_id or None,
            "praison_session_id": praison_session_id or (voice_user_session_id(user_id) if user_id else None),
        }
    )


async def api_realtime_session(request: Request) -> PlainTextResponse | JSONResponse:
    """Unified WebRTC interface — browser SDP in, OpenAI SDP answer out."""
    call_id = request.query_params.get("call_id", "").strip()
    body = await request.body()
    sdp_offer = body.decode("utf-8").strip()
    if not sdp_offer:
        return JSONResponse({"error": "Missing SDP offer body"}, status_code=400)
    try:
        sdp_answer = await create_webrtc_session(sdp_offer, call_id=call_id or None)
    except RealtimeConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Realtime WebRTC session failed")
        return JSONResponse({"error": str(exc)}, status_code=502)
    if call_id:
        mark_session_started(call_id)
    return PlainTextResponse(sdp_answer, media_type="application/sdp")


async def api_realtime_transcript(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    call_id = str(payload.get("call_id") or "").strip()
    role = str(payload.get("role") or "user").strip()
    text = str(payload.get("text") or "").strip()
    if not call_id or not text:
        return JSONResponse({"error": "call_id and text required"}, status_code=400)
    from integrations.voice.session_memory import record_voice_turn

    persist_transcript_line(call_id, role, text)
    if role == "user":
        await record_voice_turn(call_id, user_text=text)
    else:
        await record_voice_turn(call_id, agent_text=text)
    return JSONResponse({"ok": True})


async def api_realtime_end(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    call_id = str(payload.get("call_id") or "").strip()
    if call_id:
        from integrations.voice.call_finalize import finalize_call

        await finalize_call(call_id, status="ended (customer-ended-call)")
    return JSONResponse({"ok": True})
