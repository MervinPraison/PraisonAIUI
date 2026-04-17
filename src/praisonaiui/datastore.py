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

import asyncio
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

    async def record_feedback(
        self,
        session_id: str,
        message_id: str,
        value: int,
        comment: Optional[str] = None,
    ) -> None:
        """Record user feedback for a message.
        
        Args:
            session_id: Session identifier
            message_id: Message identifier
            value: Feedback value (-1, 0, or 1 for down, neutral, up)
            comment: Optional feedback comment
        """
        pass

    async def list_feedback(
        self,
        session_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List feedback records, optionally filtered by session.
        
        Args:
            session_id: Optional session filter
            
        Returns:
            List of feedback records with metadata
        """
        return []

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
        self._feedback: list[dict[str, Any]] = []

    async def list_sessions(self) -> list[dict[str, Any]]:
        result = []
        for sid, info in self._sessions.items():
            entry = {
                "id": sid,
                "title": info.get("title", "New conversation"),
                "created_at": info.get("created_at"),
                "updated_at": info.get("updated_at"),
                "message_count": len(info.get("messages", [])),
            }
            # Include platform metadata for channel sessions
            if info.get("platform"):
                entry["platform"] = info["platform"]
            if info.get("icon"):
                entry["icon"] = info["icon"]
            result.append(entry)
        return result

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

    async def record_feedback(
        self,
        session_id: str,
        message_id: str,
        value: int,
        comment: Optional[str] = None,
    ) -> None:
        """Record user feedback for a message."""
        feedback = {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "message_id": message_id,
            "value": value,
            "comment": comment,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._feedback.append(feedback)

    async def list_feedback(
        self,
        session_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List feedback records, optionally filtered by session."""
        if session_id is None:
            return self._feedback.copy()
        return [f for f in self._feedback if f["session_id"] == session_id]


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
        # Store feedback in a separate subdirectory to avoid conflicts with session files
        self._feedback_dir = self._data_dir / "feedback"
        self._feedback_dir.mkdir(parents=True, exist_ok=True)
        self._feedback_file = self._feedback_dir / "feedback.json"

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

    def _list_sessions_sync(self) -> list[dict[str, Any]]:
        """Sync helper — reads all session files from disk."""
        sessions = []
        for path in sorted(
            self._data_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            # Skip feedback directory
            if path.parent != self._data_dir:
                continue
            data = self._read_session(path)
            if data and isinstance(data, dict) and "id" in data:
                entry = {
                    "id": data.get("id", path.stem),
                    "title": data.get("title", "New conversation"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                    "message_count": len(data.get("messages", [])),
                }
                # Include platform metadata for channel sessions
                if data.get("platform"):
                    entry["platform"] = data["platform"]
                if data.get("icon"):
                    entry["icon"] = data["icon"]
                sessions.append(entry)
        return sessions

    async def list_sessions(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_sessions_sync)

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        path = self._session_path(session_id)
        return await asyncio.to_thread(self._read_session, path)

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
        await asyncio.to_thread(self._write_session, self._session_path(sid), session)
        return session

    async def delete_session(self, session_id: str) -> bool:
        def _delete() -> bool:
            path = self._session_path(session_id)
            if path.exists():
                path.unlink()
                return True
            return False
        return await asyncio.to_thread(_delete)

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        def _add() -> None:
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
        await asyncio.to_thread(_add)

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        def _get() -> list[dict[str, Any]]:
            path = self._session_path(session_id)
            data = self._read_session(path)
            if data:
                return data.get("messages", [])
            return []
        return await asyncio.to_thread(_get)

    def _read_feedback(self) -> list[dict[str, Any]]:
        """Read feedback from JSON file."""
        try:
            return json.loads(self._feedback_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

    def _write_feedback(self, feedback_list: list[dict[str, Any]]) -> None:
        """Write feedback to JSON file atomically."""
        # Use atomic write to prevent race conditions
        temp_file = self._feedback_file.with_suffix(".tmp")
        try:
            temp_file.write_text(
                json.dumps(feedback_list, indent=2, default=str), encoding="utf-8"
            )
            temp_file.replace(self._feedback_file)
        except Exception:
            if temp_file.exists():
                temp_file.unlink()
            raise

    async def record_feedback(
        self,
        session_id: str,
        message_id: str,
        value: int,
        comment: Optional[str] = None,
    ) -> None:
        """Record user feedback for a message with thread safety."""
        def _record() -> None:
            # Read, modify, write in single thread to ensure atomicity
            feedback_list = self._read_feedback()
            feedback = {
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "message_id": message_id,
                "value": value,
                "comment": comment,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            feedback_list.append(feedback)
            # Atomic write prevents race conditions
            self._write_feedback(feedback_list)
        await asyncio.to_thread(_record)

    async def list_feedback(
        self,
        session_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List feedback records, optionally filtered by session."""
        def _list() -> list[dict[str, Any]]:
            feedback_list = self._read_feedback()
            if session_id is None:
                return feedback_list
            return [f for f in feedback_list if f["session_id"] == session_id]
        return await asyncio.to_thread(_list)
