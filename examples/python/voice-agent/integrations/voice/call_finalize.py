"""End-of-call summary, analytics, and chat bridge on session close."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def count_turns(transcript: str) -> int:
    """Count user/agent lines in stored transcript."""
    turns = 0
    for line in (transcript or "").splitlines():
        text = line.strip()
        if text.startswith("user:") or text.startswith("agent:") or text.startswith("assistant:"):
            turns += 1
    return turns


def duration_seconds(created_at: str | None, ended_at: str | None) -> int | None:
    if not created_at or not ended_at:
        return None
    try:
        start = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        return max(0, int((end - start).total_seconds()))
    except ValueError:
        return None


def format_duration(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    if seconds < 60:
        return f"{seconds}s"
    minutes, rem = divmod(seconds, 60)
    return f"{minutes}m {rem}s"


async def generate_call_summary(transcript: str) -> str:
    """One-sentence LLM summary for call detail + chat sidebar."""
    text = (transcript or "").strip()
    if not text:
        return "Empty call — no conversation captured."
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        preview = " · ".join(lines[:3])
        return f"Call covered: {preview[:240]}"

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=os.getenv("VOICE_AGENT_MODEL", "gpt-4o-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Summarize this voice call in one concise sentence for a dashboard. "
                            "Mention main topic and outcome only."
                        ),
                    },
                    {"role": "user", "content": text[:6000]},
                ],
                max_tokens=80,
            ),
            timeout=15.0,
        )
        summary = (response.choices[0].message.content or "").strip()
        return summary or "Call completed."
    except Exception:  # noqa: BLE001
        logger.exception("Call summary generation failed")
        return "Call completed — summary unavailable."


async def finalize_call(call_id: str, *, status: str) -> None:
    """Persist analytics, optional summary, and notify chat bridge."""
    from integrations.voice.chat_bridge import enqueue_call_summary
    from integrations.voice.store import VoiceCallStore

    record = VoiceCallStore.get_call(call_id)
    if not record:
        return

    transcript = (record.get("transcript") or "").strip()
    metadata: dict[str, Any] = dict(record.get("metadata") or {})
    ended_at = datetime.now(timezone.utc).isoformat()
    metadata["ended_at"] = ended_at
    metadata["turn_count"] = count_turns(transcript)
    metadata["duration_sec"] = duration_seconds(record.get("created_at"), ended_at)

    summary = (record.get("summary") or "").strip()
    if not summary and transcript:
        summary = await generate_call_summary(transcript)

    VoiceCallStore.upsert_call(
        call_id,
        status=status,
        summary=summary or None,
        metadata=metadata,
    )
    enqueue_call_summary(call_id, summary or "(no summary)", status)


def analytics_for_record(record: dict[str, Any]) -> dict[str, Any]:
    """Derived analytics for API + dashboard tables."""
    metadata = record.get("metadata") or {}
    transcript = record.get("transcript") or ""
    turns = metadata.get("turn_count")
    if turns is None:
        turns = count_turns(transcript)
    duration_sec = metadata.get("duration_sec")
    if duration_sec is None:
        duration_sec = duration_seconds(record.get("created_at"), metadata.get("ended_at"))
    return {
        "turn_count": turns,
        "duration_sec": duration_sec,
        "duration": format_duration(duration_sec if isinstance(duration_sec, int) else None),
    }
