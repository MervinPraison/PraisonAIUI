"""Voice agent HTTP routes."""

from __future__ import annotations

import asyncio
import json
import logging

from integrations.voice.client import VoiceClient
from integrations.voice.config import VoiceConfigError, get_web_sdk_settings, load_voice_settings
from integrations.voice.live import transcript_hub
from integrations.voice.processor import process_voice_webhook
from integrations.voice.store import VoiceCallStore
from integrations.voice.verify import VerificationError, verify_webhook_request
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse

logger = logging.getLogger(__name__)

# Hold strong references to background tasks so the event loop (which only keeps
# weak references) cannot garbage-collect them mid-flight and drop a webhook event.
_background_tasks: set[asyncio.Task] = set()


def _schedule_webhook_processing(event_type: str, payload: dict, *, settings) -> None:
    task = asyncio.create_task(
        asyncio.to_thread(process_voice_webhook, event_type, payload, settings=settings)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def api_voice_config_status(_request: Request) -> JSONResponse:
    try:
        settings = load_voice_settings()
        configured = True
        error = None
    except VoiceConfigError as exc:
        settings = None
        configured = False
        error = str(exc)
    return JSONResponse(
        {
            "configured": configured,
            "error": error,
            "webhook_url": settings.webhook_url if settings else None,
            "default_assistant_id": settings.default_assistant_id if settings else None,
            "web_talk_enabled": bool(settings.public_api_key and settings.default_assistant_id),
        }
    )


async def api_voice_web_config(_request: Request) -> JSONResponse:
    try:
        settings = load_voice_settings(require_key=False)
    except VoiceConfigError as exc:
        return JSONResponse({"enabled": False, "error": str(exc)})
    sdk_url, sdk_global = get_web_sdk_settings()
    return JSONResponse(
        {
            "enabled": bool(settings.public_api_key and settings.default_assistant_id and sdk_url),
            "public_key": settings.public_api_key,
            "assistant_id": settings.default_assistant_id,
            "sdk_url": sdk_url or None,
            "sdk_global": sdk_global or "Vapi",
        }
    )


async def api_voice_create_call(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)
    number = str(body.get("customer_number") or body.get("phone_number") or "").strip()
    if not number:
        return JSONResponse({"error": "customer_number is required"}, status_code=400)
    try:
        settings = load_voice_settings()
        client = VoiceClient(settings)
        result = await asyncio.to_thread(
            client.create_call,
            customer_number=number,
            assistant_id=body.get("assistant_id"),
            phone_number_id=body.get("phone_number_id"),
            metadata=body.get("metadata") if isinstance(body.get("metadata"), dict) else None,
        )
    except VoiceConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=502)
    call_id = result.get("id")
    if call_id:
        VoiceCallStore.upsert_call(str(call_id), status="scheduled", customer_number=number)
    return JSONResponse(result, status_code=201)


async def api_voice_list_calls(_request: Request) -> JSONResponse:
    from integrations.voice.call_finalize import analytics_for_record

    calls = []
    for record in VoiceCallStore.list_calls():
        row = dict(record)
        row["analytics"] = analytics_for_record(record)
        calls.append(row)
    return JSONResponse({"calls": calls})


async def api_voice_doctor(_request: Request) -> JSONResponse:
    import os

    from integrations.voice.doctor import run_voice_doctor

    app_port = int(os.getenv("VOICE_AGENT_PORT", "8001"))
    sidecar_port = int(os.getenv("SPEECH_ENGINE_SIDECAR_PORT", "8002"))
    return JSONResponse(run_voice_doctor(app_port=app_port, sidecar_port=sidecar_port))


async def api_voice_call_detail(request: Request) -> JSONResponse:
    from integrations.voice.call_finalize import analytics_for_record

    call_id = request.path_params["call_id"]
    record = VoiceCallStore.get_call(call_id)
    if not record:
        return JSONResponse({"error": "not found"}, status_code=404)
    out = dict(record)
    out["analytics"] = analytics_for_record(record)
    return JSONResponse(out)


async def api_voice_call_detail_ui(request: Request) -> JSONResponse:
    from integrations.voice.call_detail_ui import build_call_detail_layout

    call_id = request.path_params["call_id"]
    record = VoiceCallStore.get_call(call_id)
    if not record:
        return JSONResponse({"error": "not found"}, status_code=404)
    layout = build_call_detail_layout(record)
    return JSONResponse({"call_id": call_id, "layout": layout})


async def api_voice_live_transcript(request: Request) -> StreamingResponse:
    call_id = request.path_params["call_id"]

    async def event_stream():
        record = VoiceCallStore.get_call(call_id)
        if record and record.get("transcript"):
            yield transcript_hub.snapshot_sse(
                {"type": "snapshot", "transcript": record["transcript"]}
            )
        async for event in transcript_hub.subscribe(call_id):
            yield transcript_hub.snapshot_sse(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


async def webhook_voice(request: Request) -> Response:
    raw = (await request.body()).decode("utf-8")
    try:
        settings = load_voice_settings(require_key=False)
    except VoiceConfigError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)

    headers = {k: v for k, v in request.headers.items()}
    try:
        verify_webhook_request(secret=settings.server_url_secret, headers=headers)
    except VerificationError:
        return JSONResponse({"error": "invalid secret"}, status_code=401)

    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    msg = payload.get("message") if isinstance(payload.get("message"), dict) else payload
    event_type = str((msg or {}).get("type") or payload.get("type") or "unknown")

    if event_type in ("tool-calls", "assistant-request", "transfer-destination-request", "knowledge-base-request"):
        result = await asyncio.to_thread(process_voice_webhook, event_type, payload, settings=settings)
        return JSONResponse(result or {})

    _schedule_webhook_processing(event_type, payload, settings=settings)
    return PlainTextResponse("ok", status_code=200)
