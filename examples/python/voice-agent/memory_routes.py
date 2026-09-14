"""HTTP routes for stable voice user sessions."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from integrations.voice.session_memory import (
    attach_pending_user,
    bind_call_user,
    memory_enabled,
    resolve_praison_session_id,
    voice_user_session_id,
)


async def api_voice_memory_config(_request: Request) -> JSONResponse:
    return JSONResponse({"enabled": memory_enabled()})


async def api_voice_memory_bind(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    call_id = str(payload.get("call_id") or "").strip()
    user_id = str(payload.get("user_id") or "").strip()
    if not call_id or not user_id:
        return JSONResponse({"error": "call_id and user_id required"}, status_code=400)
    try:
        session_id = bind_call_user(call_id, user_id)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return JSONResponse(
        {
            "ok": True,
            "call_id": call_id,
            "user_id": user_id,
            "praison_session_id": session_id,
        }
    )


async def api_voice_memory_resolve(request: Request) -> JSONResponse:
    user_id = request.query_params.get("user_id", "").strip()
    if not user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    session_id = voice_user_session_id(user_id)
    return JSONResponse({"user_id": user_id, "praison_session_id": session_id})


async def api_voice_memory_attach_user(request: Request) -> JSONResponse:
    """ElevenLabs: browser attaches user before conversation id exists."""
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    user_id = str(payload.get("user_id") or "").strip()
    if not user_id:
        return JSONResponse({"error": "user_id required"}, status_code=400)
    attach_pending_user(user_id)
    return JSONResponse(
        {
            "ok": True,
            "user_id": user_id,
            "praison_session_id": voice_user_session_id(user_id),
        }
    )


async def api_voice_memory_for_call(request: Request) -> JSONResponse:
    call_id = request.query_params.get("call_id", "").strip()
    if not call_id:
        return JSONResponse({"error": "call_id required"}, status_code=400)
    session_id = resolve_praison_session_id(call_id)
    return JSONResponse({"call_id": call_id, "praison_session_id": session_id})
