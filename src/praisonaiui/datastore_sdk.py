"""SDK-backed DataStore — wraps praisonaiagents.session.DefaultSessionStore.

Unifies AIUI's session persistence with the SDK's session store so both
``chat.py`` (main chat) and ``sessions_ext.py`` (extended APIs) read/write
from the same ``~/.praisonai/sessions/`` directory.

UI-specific data (``toolCalls``, ``title``) is stored in the SDK's
``SessionMessage.metadata`` dict — **zero SDK changes required**.

Title persistence: titles are stored as ``_aiui_title`` in the metadata of
a sentinel system message (content ``""``).  This message is filtered out
when returning messages to the frontend.

If the SDK is not installed, AIUI falls back to ``JSONFileDataStore``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

from praisonaiui.datastore import BaseDataStore

logger = logging.getLogger(__name__)

# Sentinel key used to identify the AIUI metadata message inside SDK sessions
_META_KEY = "_aiui_meta"
_TITLE_KEY = "_aiui_title"


class SDKFileDataStore(BaseDataStore):
    """Async adapter wrapping SDK's ``DefaultSessionStore``.

    Maps AIUI's ``BaseDataStore`` interface (async, dict-based messages) to
    the SDK's sync ``DefaultSessionStore`` (role/content/metadata signature).

    UI-specific fields like ``toolCalls`` are stored in the ``metadata`` dict,
    keeping the SDK core lean.  Session-level metadata (title) is persisted
    in a sentinel system message so it survives server restarts.
    """

    def __init__(self, session_dir: Optional[str] = None) -> None:
        from praisonaiagents.session.store import DefaultSessionStore

        kwargs: dict[str, Any] = {}
        if session_dir:
            kwargs["session_dir"] = session_dir
        self._store = DefaultSessionStore(**kwargs)
        self._session_dir = self._store.session_dir

    # ── BaseDataStore interface ──────────────────────────────────────

    async def list_sessions(self) -> list[dict[str, Any]]:
        """List sessions, reading title from on-disk metadata."""
        sessions = await asyncio.to_thread(self._list_sessions_from_disk)
        return sessions

    def _list_sessions_from_disk(self) -> list[dict[str, Any]]:
        """Read session files directly to extract title from metadata."""
        sessions = []
        try:
            for fn in os.listdir(self._session_dir):
                if not fn.endswith(".json"):
                    continue
                fp = os.path.join(self._session_dir, fn)
                try:
                    with open(fp, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    title = self._extract_title_from_data(data)
                    entry = {
                        "id": data.get("session_id", fn[:-5]),
                        "title": title,
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at"),
                        "message_count": self._count_real_messages(data),
                    }
                    # Include platform metadata for channel sessions
                    meta = self._extract_meta_from_data(data)
                    if meta.get("platform"):
                        entry["platform"] = meta["platform"]
                    if meta.get("icon"):
                        entry["icon"] = meta["icon"]
                    sessions.append(entry)
                except (json.JSONDecodeError, IOError):
                    continue
        except (IOError, OSError):
            pass
        # Safe sort — treat None as empty string
        sessions.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return sessions

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        exists = await asyncio.to_thread(self._store.session_exists, session_id)
        if not exists:
            return None
        session_data = await asyncio.to_thread(self._store.get_session, session_id)
        title = self._extract_title(session_data)
        messages = self._session_data_to_messages(session_data)
        result = {
            "id": session_id,
            "title": title,
            "created_at": session_data.created_at,
            "updated_at": session_data.updated_at,
            "messages": messages,
        }
        # Include platform metadata if present
        meta = self._extract_session_meta(session_data)
        if meta.get("platform"):
            result["platform"] = meta["platform"]
        if meta.get("icon"):
            result["icon"] = meta["icon"]
        return result

    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        import uuid as _uuid
        from datetime import datetime, timezone

        sid = session_id or str(_uuid.uuid4())
        # Write a sentinel meta message to create the session file on disk.
        # This stores session-level metadata (title) persistently.
        await asyncio.to_thread(
            self._store.add_message, sid, "system", "",
            {_META_KEY: True, _TITLE_KEY: "New conversation"},
        )

        now = datetime.now(timezone.utc).isoformat()
        return {
            "id": sid,
            "title": "New conversation",
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }

    async def delete_session(self, session_id: str) -> bool:
        return await asyncio.to_thread(self._store.delete_session, session_id)

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        role = message.get("role", "user")
        content = message.get("content", "")

        # UI-specific fields go into metadata
        metadata: dict[str, Any] = {}
        if "toolCalls" in message:
            metadata["toolCalls"] = message["toolCalls"]

        await asyncio.to_thread(
            self._store.add_message, session_id, role, content, metadata or None,
        )

        # Auto-generate title from first user message
        if role == "user":
            session_data = await asyncio.to_thread(self._store.get_session, session_id)
            current_title = self._extract_title(session_data)
            if current_title == "New conversation":
                title = self.generate_title(content)
                await self._persist_meta(session_id, _TITLE_KEY, title)

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        session_data = await asyncio.to_thread(self._store.get_session, session_id)
        return self._session_data_to_messages(session_data)

    async def update_session(self, session_id: str, **kwargs: Any) -> None:
        if "title" in kwargs:
            await self._persist_meta(session_id, _TITLE_KEY, kwargs["title"])
        if "platform" in kwargs:
            await self._persist_meta(session_id, "platform", kwargs["platform"])
        if "icon" in kwargs:
            await self._persist_meta(session_id, "icon", kwargs["icon"])

    async def close(self) -> None:
        pass

    # ── Internal helpers ─────────────────────────────────────────────

    async def _persist_meta(self, session_id: str, key: str, value: Any) -> None:
        """Update the sentinel meta message with a metadata key/value."""
        session_data = await asyncio.to_thread(self._store.get_session, session_id)
        if session_data is None:
            return

        # Find the sentinel meta message and update the key
        found = False
        for msg in session_data.messages:
            meta = msg.metadata or {}
            if meta.get(_META_KEY):
                msg.metadata[key] = value
                found = True
                break

        if not found:
            # No sentinel exists yet — insert one at position 0
            from praisonaiagents.session.store import SessionMessage
            sentinel = SessionMessage(
                role="system", content="",
                metadata={_META_KEY: True, key: value},
            )
            session_data.messages.insert(0, sentinel)

        # Save back to disk
        await asyncio.to_thread(self._store._save_session, session_data)

    @staticmethod
    def _extract_title(session_data: Any) -> str:
        """Extract title from the sentinel meta message in a SessionData."""
        if session_data is None:
            return "New conversation"
        for msg in session_data.messages:
            meta = msg.metadata or {}
            if meta.get(_META_KEY):
                return meta.get(_TITLE_KEY, "New conversation")
        return "New conversation"

    @staticmethod
    def _extract_session_meta(session_data: Any) -> dict:
        """Extract all sentinel meta fields from a SessionData object."""
        if session_data is None:
            return {}
        for msg in session_data.messages:
            meta = msg.metadata or {}
            if meta.get(_META_KEY):
                return meta
        return {}

    @staticmethod
    def _extract_title_from_data(data: dict) -> str:
        """Extract title from raw JSON session data dict."""
        meta = SDKFileDataStore._extract_meta_from_data(data)
        return meta.get(_TITLE_KEY, "New conversation")

    @staticmethod
    def _extract_meta_from_data(data: dict) -> dict:
        """Extract all sentinel meta fields from raw JSON session data."""
        for msg in data.get("messages", []):
            meta = msg.get("metadata") or {}
            if meta.get(_META_KEY):
                return meta
        return {}

    @staticmethod
    def _count_real_messages(data: dict) -> int:
        """Count messages excluding the sentinel meta message."""
        return sum(
            1 for m in data.get("messages", [])
            if not (m.get("metadata") or {}).get(_META_KEY)
        )

    @staticmethod
    def _session_data_to_messages(session_data: Any) -> list[dict[str, Any]]:
        """Convert SDK ``SessionData`` to AIUI-format message dicts.

        Filters out sentinel meta messages and restores UI-specific fields
        from metadata.
        """
        if session_data is None:
            return []

        messages = []
        for msg in session_data.messages:
            meta = msg.metadata or {}
            # Skip the sentinel meta message
            if meta.get(_META_KEY):
                continue
            d: dict[str, Any] = {
                "role": msg.role,
                "content": msg.content,
            }
            # Restore UI-specific fields from metadata
            if "toolCalls" in meta:
                d["toolCalls"] = meta["toolCalls"]
            messages.append(d)
        return messages
