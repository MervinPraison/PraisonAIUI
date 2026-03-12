"""DataStore module - Pluggable, database-agnostic storage for sessions and messages.

This module provides an abstract base class (`BaseDataStore`) that can be
implemented for any database backend.  Two built-in implementations are
shipped out of the box:

* `MemoryDataStore`   – in-memory dict (default, volatile)
* `JSONFileDataStore` – JSON files on disk (~/.praisonaiui/sessions/)

To use a custom backend (SQLite, PostgreSQL, Redis, MongoDB, …) simply
subclass `BaseDataStore` and implement the six required methods.

Example – custom SQLite store::

    from praisonaiui.datastore import BaseDataStore

    class SQLiteDataStore(BaseDataStore):
        async def list_sessions(self) -> list[dict]:
            ...  # your implementation

    # Register it before the server starts:
    from praisonaiui.server import set_datastore
    set_datastore(SQLiteDataStore("mydb.sqlite"))
"""

from __future__ import annotations

import json
import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Abstract base class – implement this for any database
# ---------------------------------------------------------------------------

class BaseDataStore(ABC):
    """Database-agnostic storage interface for sessions and messages.

    All methods are async to support both sync and async backends.
    Implementations must be thread-safe if used with concurrent requests.
    """

    @abstractmethod
    async def list_sessions(self) -> list[dict[str, Any]]:
        """Return a list of session summaries (id, created_at, updated_at, message_count)."""
        ...

    @abstractmethod
    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        """Return full session data including messages, or None if not found."""
        ...

    @abstractmethod
    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        """Create a new session. Returns the session dict with at least 'id'."""
        ...

    @abstractmethod
    async def delete_session(self, session_id: str) -> bool:
        """Delete a session. Returns True if deleted, False if not found."""
        ...

    @abstractmethod
    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        """Append a message to a session's history."""
        ...

    @abstractmethod
    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        """Return all messages for a session (ordered chronologically)."""
        ...

    async def update_session(self, session_id: str, **kwargs: Any) -> None:
        """Update session metadata (optional override). Commonly used for 'title'."""
        pass

    async def close(self) -> None:
        """Clean up resources (connections, file handles). Called on shutdown."""
        pass

    @staticmethod
    def generate_title(message: str) -> str:
        """Generate a short title from the first user message.

        Truncates at word boundary (max 50 chars), strips punctuation,
        and capitalizes the first letter.
        """
        text = message.strip()
        if not text:
            return "New conversation"
        # Remove leading/trailing quotes and common prefixes
        for prefix in ("hi ", "hello ", "hey "):
            if text.lower().startswith(prefix):
                rest = text[len(prefix):].strip()
                if rest:
                    text = rest
                break
        # Truncate at word boundary
        if len(text) > 50:
            text = text[:50].rsplit(" ", 1)[0]
            if not text:
                text = message[:50]
            text = text.rstrip(".,;:!? ") + "…"
        # Capitalize first letter
        return text[0].upper() + text[1:] if len(text) > 1 else text.upper()


# ---------------------------------------------------------------------------
# Built-in: In-memory store (default – volatile)
# ---------------------------------------------------------------------------

class MemoryDataStore(BaseDataStore):
    """In-memory session storage. Fast, but data is lost on restart."""

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}

    async def list_sessions(self) -> list[dict[str, Any]]:
        return [
            {
                "id": sid,
                "title": info.get("title", "New conversation"),
                "created_at": info.get("created_at"),
                "updated_at": info.get("updated_at"),
                "message_count": len(info.get("messages", [])),
            }
            for sid, info in self._sessions.items()
        ]

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        return self._sessions.get(session_id)

    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "id": sid,
            "title": "New conversation",
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        self._sessions[sid] = session
        return session

    async def delete_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session["messages"].append(message)
            session["updated_at"] = datetime.now(timezone.utc).isoformat()
            # Auto-generate title from first user message
            if (
                message.get("role") == "user"
                and session.get("title") == "New conversation"
            ):
                session["title"] = self.generate_title(message.get("content", ""))

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        session = self._sessions.get(session_id)
        if session:
            return session.get("messages", [])
        return []

    async def update_session(self, session_id: str, **kwargs: Any) -> None:
        if session_id in self._sessions:
            self._sessions[session_id].update(kwargs)
            self._sessions[session_id]["updated_at"] = datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Built-in: JSON file store (persists to disk)
# ---------------------------------------------------------------------------

class JSONFileDataStore(BaseDataStore):
    """JSON file-based session storage.

    Each session is stored as a separate JSON file under the data directory.
    Default location: ``~/.praisonaiui/sessions/``

    This provides simple persistence for development and single-user
    deployments.  For production, use a proper database backend.
    """

    def __init__(self, data_dir: Optional[str] = None) -> None:
        if data_dir:
            self._data_dir = Path(data_dir)
        else:
            # Respect AIUI_DATA_DIR env var (e.g. /data on Fly containers with
            # persistent volumes), falling back to ~/.praisonaiui/sessions/.
            base = Path(os.environ.get("AIUI_DATA_DIR", str(Path.home() / ".praisonaiui")))
            self._data_dir = base / "sessions"
        self._data_dir.mkdir(parents=True, exist_ok=True)

    def _session_path(self, session_id: str) -> Path:
        # Sanitize session_id to prevent path traversal
        safe_id = session_id.replace("/", "_").replace("..", "_")
        return self._data_dir / f"{safe_id}.json"

    def _read_session(self, path: Path) -> Optional[dict[str, Any]]:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def _write_session(self, path: Path, data: dict[str, Any]) -> None:
        path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")

    async def list_sessions(self) -> list[dict[str, Any]]:
        sessions = []
        for path in sorted(
            self._data_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            data = self._read_session(path)
            if data:
                sessions.append({
                    "id": data.get("id", path.stem),
                    "title": data.get("title", "New conversation"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                    "message_count": len(data.get("messages", [])),
                })
        return sessions

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        path = self._session_path(session_id)
        if path.exists():
            return self._read_session(path)
        return None

    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "id": sid,
            "title": "New conversation",
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        self._write_session(self._session_path(sid), session)
        return session

    async def delete_session(self, session_id: str) -> bool:
        path = self._session_path(session_id)
        if path.exists():
            path.unlink()
            return True
        return False

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        path = self._session_path(session_id)
        data = self._read_session(path)
        if data:
            data["messages"].append(message)
            data["updated_at"] = datetime.now(timezone.utc).isoformat()
            # Auto-generate title from first user message
            if (
                message.get("role") == "user"
                and data.get("title", "New conversation") == "New conversation"
            ):
                data["title"] = self.generate_title(message.get("content", ""))
            self._write_session(path, data)

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        path = self._session_path(session_id)
        data = self._read_session(path)
        if data:
            return data.get("messages", [])
        return []
