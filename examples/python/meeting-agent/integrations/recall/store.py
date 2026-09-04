"""Persist Recall webhook idempotency and calendar setup state."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any


def _state_db_path() -> str:
    env = os.getenv("PRAISONAI_MEETINGS_DIR")
    base = Path(env) if env else Path.home() / ".praisonai" / "meetings"
    base.mkdir(parents=True, exist_ok=True)
    return str(base / "recall_state.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_state_db_path())
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recall_webhook_events (
            event_key TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            processed_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recall_calendar_setup (
            setup_id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recall_scheduled_bots (
            event_id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            bot_id TEXT,
            scheduled_at TEXT NOT NULL
        )
        """
    )
    return conn


def webhook_event_key(event_type: str, payload: dict[str, Any]) -> str:
    """Build a stable idempotency key from webhook metadata."""
    data = payload.get("data") or {}
    for part in (
        payload.get("id"),
        data.get("id") if isinstance(data, dict) else None,
    ):
        if part:
            return f"{event_type}:{part}"
    bot_id = RecallStore.extract_bot_id(payload)
    recording_id = RecallStore.extract_recording_id(payload)
    transcript_id = RecallStore.extract_transcript_id(payload)
    suffix = bot_id or recording_id or transcript_id or json.dumps(payload, sort_keys=True)
    return f"{event_type}:{suffix}"


class RecallStore:
    """SQLite-backed Recall integration state."""

    @staticmethod
    def extract_bot_id(payload: dict[str, Any]) -> str | None:
        from integrations.recall.client import RecallClient

        return RecallClient.extract_bot_id(payload)

    @staticmethod
    def extract_recording_id(payload: dict[str, Any]) -> str | None:
        from integrations.recall.client import RecallClient

        return RecallClient.extract_recording_id(payload)

    @staticmethod
    def extract_transcript_id(payload: dict[str, Any]) -> str | None:
        from integrations.recall.client import RecallClient

        return RecallClient.extract_transcript_id(payload)

    @staticmethod
    def mark_event_processed(event_key: str, event_type: str) -> bool:
        """Return False if this event was already processed."""
        from datetime import datetime, timezone

        with closing(_connect()) as conn, conn:
            row = conn.execute(
                "SELECT 1 FROM recall_webhook_events WHERE event_key = ?",
                (event_key,),
            ).fetchone()
            if row:
                return False
            conn.execute(
                """
                INSERT INTO recall_webhook_events (event_key, event_type, processed_at)
                VALUES (?, ?, ?)
                """,
                (event_key, event_type, datetime.now(timezone.utc).isoformat()),
            )
        return True

    @staticmethod
    def save_calendar_setup(setup_id: str, platform: str, state: dict[str, Any]) -> None:
        from datetime import datetime, timezone

        with closing(_connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO recall_calendar_setup (setup_id, platform, state_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(setup_id) DO UPDATE SET
                    platform = excluded.platform,
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                (
                    setup_id,
                    platform,
                    json.dumps(state, sort_keys=True),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )

    @staticmethod
    def get_calendar_setup(setup_id: str) -> dict[str, Any] | None:
        with closing(_connect()) as conn:
            row = conn.execute(
                "SELECT state_json FROM recall_calendar_setup WHERE setup_id = ?",
                (setup_id,),
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    @staticmethod
    def record_scheduled_bot(event_id: str, meeting_id: str, bot_id: str | None) -> None:
        from datetime import datetime, timezone

        with closing(_connect()) as conn, conn:
            conn.execute(
                """
                INSERT INTO recall_scheduled_bots (event_id, meeting_id, bot_id, scheduled_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(event_id) DO NOTHING
                """,
                (event_id, meeting_id, bot_id, datetime.now(timezone.utc).isoformat()),
            )

    @staticmethod
    def is_event_scheduled(event_id: str) -> bool:
        with closing(_connect()) as conn:
            row = conn.execute(
                "SELECT 1 FROM recall_scheduled_bots WHERE event_id = ?",
                (event_id,),
            ).fetchone()
        return row is not None
