"""Async Recall webhook event processing."""

from __future__ import annotations

import logging
from typing import Any

from integrations.recall.client import RecallAPIError, RecallClient
from integrations.recall.config import RecallSettings
from integrations.recall.store import RecallStore, webhook_event_key
from integrations.recall.transcript import transcript_download_to_text

logger = logging.getLogger(__name__)


def _merge_metadata(meeting_id: str, patch: dict[str, Any]) -> None:
    from pipeline import merge_meeting_metadata

    merge_meeting_metadata(meeting_id, patch)


def _resolve_meeting_id(payload: dict[str, Any], bot_id: str | None) -> str | None:
    meeting_id = RecallClient.extract_meeting_id_from_bot_metadata(payload)
    if meeting_id:
        return meeting_id
    if not bot_id:
        return None
    try:
        from praisonai_tools.tools.meeting_tools import list_meetings

        rows = list_meetings.__wrapped__(limit=200, offset=0)
        for row in rows:
            if not isinstance(row, dict):
                continue
            meta = row.get("metadata") or {}
            if meta.get("recall_bot_id") == bot_id:
                return row.get("meeting_id")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not resolve meeting by bot_id: %s", exc)
    return None


def process_recall_webhook(
    event_type: str,
    payload: dict[str, Any],
    *,
    settings: RecallSettings,
    client: RecallClient | None = None,
) -> None:
    """Handle a verified Recall webhook (runs off the request thread)."""
    event_key = webhook_event_key(event_type, payload)
    if not RecallStore.mark_event_processed(event_key, event_type):
        logger.info("Skipping duplicate Recall event %s", event_type)
        return

    client = client or RecallClient(settings)
    bot_id = RecallClient.extract_bot_id(payload)
    meeting_id = _resolve_meeting_id(payload, bot_id)

    if event_type == "bot.joining_call" and meeting_id:
        _merge_metadata(meeting_id, {"live_status": "joining", "recall_bot_id": bot_id})
        return

    if event_type == "bot.in_waiting_room" and meeting_id:
        _merge_metadata(
            meeting_id,
            {
                "live_status": "waiting_room",
                "status": "Scheduled",
                "error": "Bot is in the meeting waiting room — admit 'Praison Meeting Agent' to record.",
            },
        )
        return

    if event_type == "bot.in_call_recording" and meeting_id:
        _merge_metadata(meeting_id, {"live_status": "live", "status": "live"})
        return

    if event_type == "bot.call_ended" and meeting_id:
        _merge_metadata(meeting_id, {"live_status": "ended"})
        return

    if event_type == "bot.fatal" and meeting_id:
        sub = ((payload.get("data") or {}).get("data") or {}).get("sub_code")
        _merge_metadata(
            meeting_id,
            {
                "live_status": "failed",
                "status": "failed",
                "error": f"Recall bot fatal: {sub or 'unknown'}",
            },
        )
        return

    if event_type == "bot.done" and meeting_id:
        _merge_metadata(meeting_id, {"live_status": "processing"})
        return

    if event_type == "recording.done":
        recording_id = RecallClient.extract_recording_id(payload)
        if not recording_id:
            logger.warning("recording.done without recording id")
            return
        if meeting_id:
            _merge_metadata(meeting_id, {"recall_recording_id": recording_id})
            started_at = ((payload.get("data") or {}).get("recording") or {}).get("started_at")
            completed_at = ((payload.get("data") or {}).get("recording") or {}).get("completed_at")
            if started_at and completed_at:
                try:
                    from datetime import datetime

                    fmt = "%Y-%m-%dT%H:%M:%S.%f%z"
                    start = datetime.strptime(started_at.replace("Z", "+0000"), fmt)
                    end = datetime.strptime(completed_at.replace("Z", "+0000"), fmt)
                    _merge_metadata(
                        meeting_id,
                        {"duration_seconds": int((end - start).total_seconds())},
                    )
                except (TypeError, ValueError):
                    pass
        try:
            client.create_async_transcript(recording_id)
            logger.info("Started async transcript for recording %s", recording_id)
        except RecallAPIError as exc:
            logger.error("create_async_transcript failed: %s", exc)
            if meeting_id:
                _merge_metadata(
                    meeting_id,
                    {"status": "failed", "error": f"Transcript start failed: {exc}"},
                )
        return

    if event_type == "transcript.failed" and meeting_id:
        _merge_metadata(
            meeting_id,
            {"status": "failed", "error": "Recall transcript generation failed"},
        )
        return

    if event_type == "transcript.done":
        transcript_id = RecallClient.extract_transcript_id(payload)
        if not transcript_id:
            logger.warning("transcript.done without transcript id")
            return
        if not meeting_id:
            logger.warning("transcript.done without meeting_id")
            return
        try:
            artifact = client.get_transcript(transcript_id)
            download_url = (artifact.get("data") or {}).get("download_url")
            if not download_url:
                raise RecallAPIError(0, "missing transcript download_url")
            raw = client.download_json(download_url)
            text = transcript_download_to_text(raw)
            if not text.strip():
                raise RecallAPIError(0, "empty transcript")
            from pipeline import run_post_transcript_pipeline

            run_post_transcript_pipeline(meeting_id, text)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Post-transcript pipeline failed")
            _merge_metadata(meeting_id, {"status": "failed", "error": str(exc)})
