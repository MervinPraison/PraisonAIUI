"""High-level Recall bot scheduling used by API routes and the agent."""

from __future__ import annotations

import logging
import re
from typing import Any

from integrations.recall.client import RecallAPIError, RecallClient
from integrations.recall.config import RecallConfigError, RecallSettings, load_recall_settings

logger = logging.getLogger(__name__)

_MEETING_URL_RE = re.compile(r"^https?://", re.I)


def schedule_recall_bot(
    meeting_url: str,
    title: str = "",
    *,
    join_at: str | None = None,
    settings: RecallSettings | None = None,
    client: RecallClient | None = None,
) -> dict[str, Any]:
    """Persist local intent, create the Recall bot, and store the returned bot id."""
    url = (meeting_url or "").strip()
    if not _MEETING_URL_RE.match(url):
        return {"error": "meeting_url must be an http(s) URL"}

    meeting_title = (title or "Live meeting").strip() or "Live meeting"

    try:
        settings = settings or load_recall_settings()
    except RecallConfigError as exc:
        return {"error": str(exc)}

    from praisonai_tools.tools.meeting_tools import save_meeting

    saved = save_meeting.__wrapped__(
        title=meeting_title,
        source=url,
        metadata={
            "status": "scheduled",
            "live_status": "scheduled",
            "meeting_url": url,
            "source": "recall",
        },
    )
    if "error" in saved:
        return saved

    meeting_id = saved["meeting_id"]
    api = client or RecallClient(settings)

    try:
        bot = api.create_bot(
            meeting_url=url,
            meeting_id=meeting_id,
            title=meeting_title,
            join_at=join_at,
        )
    except RecallAPIError as exc:
        from pipeline import merge_meeting_metadata

        merge_meeting_metadata(
            meeting_id,
            {
                "status": "failed",
                "live_status": "failed",
                "error": f"Recall create bot failed: {exc.detail}",
            },
        )
        return {
            "meeting_id": meeting_id,
            "error": f"Recall create bot failed: {exc.detail}",
        }

    bot_id = bot.get("id")
    from pipeline import merge_meeting_metadata

    merge_meeting_metadata(
        meeting_id,
        {
            "recall_bot_id": bot_id,
            "status": "scheduled",
            "live_status": "scheduled",
            "meeting_url": url,
        },
    )

    logger.info("Scheduled Recall bot %s for meeting %s", bot_id, meeting_id)
    return {
        "meeting_id": meeting_id,
        "recall_bot_id": bot_id,
        "status": "scheduled",
        "live_status": "scheduled",
        "title": meeting_title,
        "meeting_url": url,
    }


def cancel_recall_bot(
    meeting_id: str,
    *,
    settings: RecallSettings | None = None,
    client: RecallClient | None = None,
) -> dict[str, Any]:
    """Cancel a scheduled or in-call Recall bot."""
    from praisonai_tools.tools.meeting_tools import get_meeting
    from pipeline import merge_meeting_metadata

    record = get_meeting.__wrapped__(meeting_id)
    if "error" in record:
        return record

    bot_id = (record.get("metadata") or {}).get("recall_bot_id")
    if not bot_id:
        return {"error": "No Recall bot linked to this meeting", "meeting_id": meeting_id}

    try:
        settings = settings or load_recall_settings()
    except RecallConfigError as exc:
        return {"error": str(exc)}

    api = client or RecallClient(settings)
    try:
        api.cancel_bot(str(bot_id))
    except RecallAPIError as exc:
        return {"meeting_id": meeting_id, "error": str(exc)}

    merge_meeting_metadata(
        meeting_id,
        {"live_status": "cancelled", "status": "cancelled"},
    )
    return {"meeting_id": meeting_id, "recall_bot_id": bot_id, "status": "cancelled"}
