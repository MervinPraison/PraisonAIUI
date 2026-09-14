"""HTTP + WebSocket routes for ElevenLabs Speech Engine."""

from __future__ import annotations

import logging
import os

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

from integrations.voice.speech_engine import (
    SpeechEngineConfigError,
    get_engine_resource,
    get_webrtc_token,
    handle_session_close,
    handle_session_init,
    handle_user_transcript,
    load_speech_engine_settings,
    speech_engine_enabled,
)

logger = logging.getLogger(__name__)


async def api_speech_engine_config(_request: Request) -> JSONResponse:
    try:
        settings = load_speech_engine_settings()
        enabled = speech_engine_enabled()
        error = None
    except SpeechEngineConfigError as exc:
        settings = None
        enabled = False
        error = str(exc)
    tools: list[str] = []
    if enabled:
        try:
            from integrations.voice.agent_runner import list_registered_tool_names

            tools = list_registered_tool_names()
        except Exception:  # noqa: BLE001
            tools = ["get_current_time", "echo_message"]
    return JSONResponse(
        {
            "enabled": enabled,
            "error": error,
            "engine_id": settings.engine_id if settings else None,
            "ws_url": settings.public_ws_url if settings else None,
            "client_sdk_url": "https://esm.sh/@elevenlabs/client",
            "first_message": settings.first_message if settings else None,
            "model": os.getenv("VOICE_AGENT_MODEL", "gpt-4o-mini"),
            "tools": tools,
        }
    )


async def api_speech_engine_token(_request: Request) -> JSONResponse:
    try:
        token = get_webrtc_token()
    except SpeechEngineConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Speech Engine token mint failed")
        return JSONResponse({"error": str(exc)}, status_code=502)
    return JSONResponse({"token": token})


async def speech_engine_websocket(websocket: WebSocket) -> None:
    try:
        engine = await get_engine_resource()
    except SpeechEngineConfigError as exc:
        logger.warning("Speech Engine WS rejected: %s", exc)
        return

    headers = dict(websocket.headers)
    if hasattr(engine, "verify_request") and not engine.verify_request(headers):
        logger.warning(
            "Speech Engine WS unauthorized (missing or invalid ElevenLabs JWT header)"
        )
        return

    await websocket.accept()
    logger.info("Speech Engine WebSocket accepted from ElevenLabs")
    session = engine.create_session(websocket, debug=False)

    async def on_transcript(transcript, sess):  # noqa: ANN001
        await handle_user_transcript(transcript, sess)

    async def on_init(conversation_id, sess):  # noqa: ANN001
        await handle_session_init(conversation_id, sess)

    async def on_close(sess):  # noqa: ANN001
        await handle_session_close(sess)

    def on_error(err, sess=None):  # noqa: ANN001
        logger.error("Speech Engine session error: %s", err)

    session.on("user_transcript", on_transcript)
    session.on("init", on_init)
    session.on("close", on_close)
    session.on("error", on_error)

    try:
        await session.run()
    except WebSocketDisconnect:
        logger.info("Speech Engine WebSocket disconnected")
        await handle_session_close(session)
    except Exception:  # noqa: BLE001
        logger.exception("Speech Engine WebSocket session failed")
        await handle_session_close(session)
