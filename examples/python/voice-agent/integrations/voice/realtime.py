"""OpenAI Realtime API — browser WebRTC voice (gpt-realtime-2.1-mini)."""

from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


class RealtimeConfigError(Exception):
    pass


@dataclass(frozen=True)
class RealtimeSettings:
    api_key: str
    model: str
    voice: str
    reasoning_effort: str
    instructions: str
    first_message: str | None


def load_realtime_settings() -> RealtimeSettings:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RealtimeConfigError("Set OPENAI_API_KEY in .env")
    first_message = os.getenv("REALTIME_FIRST_MESSAGE", "").strip() or None
    return RealtimeSettings(
        api_key=api_key,
        model=os.getenv("REALTIME_MODEL", "gpt-realtime-2.1-mini").strip(),
        voice=os.getenv("REALTIME_VOICE", "marin").strip(),
        reasoning_effort=os.getenv("REALTIME_REASONING_EFFORT", "low").strip(),
        instructions=os.getenv(
            "REALTIME_INSTRUCTIONS",
            "You are a helpful voice assistant for PraisonAI demos. "
            "Keep every reply to one or two short sentences.",
        ).strip(),
        first_message=first_message,
    )


def realtime_enabled() -> bool:
    try:
        load_realtime_settings()
    except RealtimeConfigError:
        return False
    return True


def build_session_config(
    settings: RealtimeSettings | None = None,
    *,
    praison_session_id: str | None = None,
) -> dict[str, Any]:
    from integrations.voice.session_memory import instructions_with_memory

    cfg = settings or load_realtime_settings()
    session: dict[str, Any] = {
        "type": "realtime",
        "model": cfg.model,
        "instructions": instructions_with_memory(cfg.instructions, session_id=praison_session_id),
        "audio": {"output": {"voice": cfg.voice}},
        # Required for user transcript events in the browser data channel.
        "input_audio_transcription": {
            "model": os.getenv("REALTIME_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"),
        },
    }
    if cfg.reasoning_effort:
        session["reasoning"] = {"effort": cfg.reasoning_effort}
    return session


def new_call_id() -> str:
    return f"rt-{uuid.uuid4().hex[:12]}"


async def create_webrtc_session(sdp_offer: str, *, call_id: str | None = None) -> str:
    """Relay browser SDP to OpenAI unified Realtime calls endpoint."""
    from integrations.voice.session_memory import resolve_praison_session_id

    settings = load_realtime_settings()
    praison_session_id = resolve_praison_session_id(call_id)
    session_json = json.dumps(build_session_config(settings, praison_session_id=praison_session_id))
    files = {
        "sdp": (None, sdp_offer, "application/sdp"),
        "session": (None, session_json, "application/json"),
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            OPENAI_REALTIME_CALLS_URL,
            headers={"Authorization": f"Bearer {settings.api_key}"},
            files=files,
        )
    if response.status_code >= 400:
        detail = response.text[:500]
        logger.error("OpenAI Realtime session failed (%s): %s", response.status_code, detail)
        raise RealtimeConfigError(f"OpenAI Realtime session failed: HTTP {response.status_code}")
    return response.text


async def mint_client_secret() -> str:
    """Mint ephemeral key (alternative to unified SDP relay)."""
    settings = load_realtime_settings()
    payload = {"session": build_session_config(settings)}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            OPENAI_CLIENT_SECRETS_URL,
            headers={
                "Authorization": f"Bearer {settings.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if response.status_code >= 400:
        detail = response.text[:500]
        raise RealtimeConfigError(f"OpenAI client secret failed: HTTP {response.status_code} — {detail}")
    data = response.json()
    token = data.get("value") or data.get("client_secret", {}).get("value")
    if not token:
        raise RealtimeConfigError("OpenAI client secret response missing value")
    return str(token)


def persist_transcript_line(call_id: str, role: str, text: str) -> None:
    from integrations.voice.live import transcript_hub
    from integrations.voice.store import VoiceCallStore

    text = text.strip()
    if not call_id or not text:
        return
    record = VoiceCallStore.get_call(call_id) or {}
    prefix = f"{role}: {text}"
    existing = (record.get("transcript") or "").strip()
    merged = f"{existing}\n{prefix}".strip() if existing else prefix
    VoiceCallStore.upsert_call(
        call_id,
        status=record.get("status") or "in-progress",
        customer_number="web-openai-realtime",
        transcript=merged,
    )
    transcript_hub.publish(
        call_id,
        {
            "type": "transcript",
            "role": role,
            "transcriptType": "final",
            "text": text,
        },
    )


def mark_session_started(call_id: str) -> None:
    from integrations.voice.store import VoiceCallStore

    VoiceCallStore.upsert_call(
        call_id,
        status="in-progress",
        customer_number="web-openai-realtime",
    )


def mark_session_ended(call_id: str) -> None:
    from integrations.voice.store import VoiceCallStore

    VoiceCallStore.upsert_call(
        call_id,
        status="ended (customer-ended-call)",
        customer_number="web-openai-realtime",
    )
