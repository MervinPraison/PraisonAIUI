"""Google Calendar V2 sync and auto-schedule via Recall Calendar API."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from integrations.recall.client import RecallAPIError, RecallClient
from integrations.recall.config import RecallSettings
from integrations.recall.store import RecallStore

logger = logging.getLogger(__name__)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        if normalized.endswith("+0000"):
            normalized = normalized[:-5] + "+00:00"
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _event_title(event: dict[str, Any]) -> str:
    raw = event.get("raw") or {}
    if isinstance(raw, dict):
        summary = raw.get("summary") or raw.get("subject")
        if summary:
            return str(summary)
    return "Calendar meeting"


def _deduplication_key(event: dict[str, Any]) -> str:
    start = str(event.get("start_time") or "")
    url = str(event.get("meeting_url") or "")
    return f"{start}-{url}"


def is_eligible_for_auto_record(event: dict[str, Any]) -> bool:
    """Return True when Recall should schedule a bot for this calendar event."""
    if event.get("is_deleted"):
        return False
    if not event.get("meeting_url"):
        return False
    end = _parse_iso(str(event.get("end_time") or ""))
    if end and end < datetime.now(timezone.utc):
        return False
    raw = event.get("raw") or {}
    if isinstance(raw, dict):
        status = str(raw.get("status") or "").lower()
        if status == "cancelled":
            return False
    return True


def list_upcoming_calendar_meetings(
    *,
    hours: int = 24,
    settings: RecallSettings | None = None,
    client: RecallClient | None = None,
) -> list[dict[str, Any]]:
    """List upcoming Recall calendar events with video links (for UI + agent tool)."""
    from integrations.recall.config import load_recall_settings

    settings = settings or load_recall_settings()
    client = client or RecallClient(settings)

    try:
        events = client.list_calendar_events(is_deleted=False)
    except RecallAPIError as exc:
        logger.warning("Calendar events unavailable: %s", exc)
        return []

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=max(1, hours))

    rows: list[dict[str, Any]] = []
    for event in events:
        if not is_eligible_for_auto_record(event):
            continue
        start = _parse_iso(str(event.get("start_time") or ""))
        if start and start > horizon:
            continue
        bots = event.get("bots") or []
        rows.append(
            {
                "event_id": event.get("id"),
                "title": _event_title(event),
                "start": event.get("start_time"),
                "end": event.get("end_time"),
                "platform": (event.get("meeting_platform") or {}).get("name")
                if isinstance(event.get("meeting_platform"), dict)
                else event.get("meeting_platform"),
                "meeting_url": event.get("meeting_url"),
                "bot_scheduled": bool(bots),
                "calendar_id": event.get("calendar_id"),
            }
        )

    rows.sort(key=lambda r: str(r.get("start") or ""))
    return rows


def _ensure_local_meeting_for_event(
    event: dict[str, Any],
    *,
    settings: RecallSettings,
) -> str:
    """Create or reuse a local meeting row for a calendar event."""
    event_id = str(event.get("id") or "")
    if RecallStore.is_event_scheduled(event_id):
        row = RecallStore.get_scheduled_bot(event_id)
        if row and row.get("meeting_id"):
            return str(row["meeting_id"])

    from praisonai_tools.tools.meeting_tools import save_meeting

    title = _event_title(event)
    url = str(event.get("meeting_url") or "")
    saved = save_meeting.__wrapped__(
        title=title,
        source=url,
        metadata={
            "status": "scheduled",
            "live_status": "scheduled",
            "meeting_url": url,
            "source": "calendar",
            "recall_calendar_event_id": event_id,
        },
    )
    if "error" in saved:
        raise RecallAPIError(0, saved["error"])
    return str(saved["meeting_id"])


def sync_calendar_events(
    calendar_id: str,
    *,
    updated_since: str | None = None,
    settings: RecallSettings,
    client: RecallClient | None = None,
    auto_record: bool | None = None,
) -> dict[str, Any]:
    """Fetch changed calendar events and schedule/remove bots per policy."""
    client = client or RecallClient(settings)
    should_record = (
        settings.calendar_auto_record if auto_record is None else auto_record
    )

    events = client.list_calendar_events(
        calendar_id=calendar_id,
        updated_at_gte=updated_since,
    )

    scheduled = 0
    removed = 0
    skipped = 0
    errors: list[str] = []

    for event in events:
        event_id = str(event.get("id") or "")
        if not event_id:
            continue

        eligible = is_eligible_for_auto_record(event) and should_record
        has_bots = bool(event.get("bots"))

        if not eligible:
            if has_bots and (event.get("is_deleted") or not should_record):
                try:
                    client.remove_bot_from_calendar_event(event_id)
                    removed += 1
                except RecallAPIError as exc:
                    errors.append(f"{event_id}: remove failed: {exc.detail}")
            else:
                skipped += 1
            continue

        if RecallStore.is_event_scheduled(event_id) and has_bots:
            skipped += 1
            continue

        try:
            meeting_id = _ensure_local_meeting_for_event(event, settings=settings)
            bot_config = client.build_bot_config(
                meeting_id=meeting_id,
                title=_event_title(event),
            )
            updated = client.schedule_bot_for_calendar_event(
                event_id,
                deduplication_key=_deduplication_key(event),
                bot_config=bot_config,
            )
            bot_id = None
            bots = updated.get("bots") or []
            if bots and isinstance(bots[0], dict):
                bot_id = bots[0].get("bot_id") or bots[0].get("id")
            RecallStore.record_scheduled_bot(event_id, meeting_id, bot_id)
            from pipeline import merge_meeting_metadata

            merge_meeting_metadata(
                meeting_id,
                {
                    "recall_calendar_event_id": event_id,
                    "recall_bot_id": bot_id,
                    "status": "scheduled",
                    "live_status": "scheduled",
                },
            )
            scheduled += 1
        except RecallAPIError as exc:
            logger.warning("Calendar schedule failed for %s: %s", event_id, exc.detail)
            errors.append(f"{event_id}: {exc.detail}")

    return {
        "calendar_id": calendar_id,
        "fetched": len(events),
        "scheduled": scheduled,
        "removed": removed,
        "skipped": skipped,
        "errors": errors,
    }


def process_calendar_webhook(
    event_type: str,
    payload: dict[str, Any],
    *,
    settings: RecallSettings,
    client: RecallClient | None = None,
) -> None:
    """Handle Recall Calendar V2 webhooks (calendar.update, calendar.sync_events)."""
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return

    calendar_id = str(data.get("calendar_id") or "")
    if not calendar_id:
        logger.warning("Calendar webhook %s missing calendar_id", event_type)
        return

    if event_type == "calendar.update":
        logger.info("Calendar %s updated — refresh status in UI", calendar_id)
        return

    if event_type == "calendar.sync_events":
        updated_since = str(data.get("last_updated_ts") or "") or None
        result = sync_calendar_events(
            calendar_id,
            updated_since=updated_since,
            settings=settings,
            client=client,
        )
        logger.info("Calendar sync %s: %s", calendar_id, result)
        return

    logger.debug("Ignoring calendar webhook event %s", event_type)
