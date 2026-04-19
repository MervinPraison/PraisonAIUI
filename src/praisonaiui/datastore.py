"""DataStore module - Pluggable, database-agnostic storage for sessions and messages.

This module provides an abstract base class (`BaseDataStore`) that can be
implemented for any database backend. Three built-in implementations are
shipped out of the box:

* `MemoryDataStore`      – in-memory dict (default, volatile)
* `JSONFileDataStore`    – JSON files on disk (~/.praisonaiui/sessions/)
* `SQLAlchemyDataStore`  – SQLite/PostgreSQL via SQLAlchemy (production-ready)

The SQLAlchemy store provides:
- Schema auto-creation on first run
- Async support via sqlalchemy.ext.asyncio
- Atomic writes (single transaction per message append)
- SQLite default (~/.praisonaiui/aiui.db) with PostgreSQL opt-in
- Lazy import of dependencies

Example – built-in SQL stores::

    from praisonaiui import set_datastore, SQLAlchemyDataStore

    # SQLite (default) - creates ~/.praisonaiui/aiui.db
    set_datastore(SQLAlchemyDataStore())

    # PostgreSQL
    set_datastore(SQLAlchemyDataStore(
        "postgresql+asyncpg://user:pass@host/db"
    ))

    # Custom SQLite path
    set_datastore(SQLAlchemyDataStore(
        "sqlite+aiosqlite:///path/to/custom.db"
    ))

To use SQLAlchemy store, install the optional dependencies::

    pip install 'aiui[sql]'        # SQLite support
    pip install 'aiui[postgres]'   # PostgreSQL support

For custom backends (Redis, MongoDB, …) subclass `BaseDataStore`::

    from praisonaiui.datastore import BaseDataStore

    class CustomDataStore(BaseDataStore):
        async def list_sessions(self) -> list[dict]:
            ...  # your implementation

    set_datastore(CustomDataStore())
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
# SQLAlchemy ORM models (lazy creation to avoid import issues)
# ---------------------------------------------------------------------------

# Import SQLAlchemy types at module level to fix annotation resolution
try:
    from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
    from sqlalchemy.sql import func

    _SQLALCHEMY_AVAILABLE = True
except ImportError:
    # Create placeholder types to prevent import errors
    _SQLALCHEMY_AVAILABLE = False
    Mapped = Any  # type: ignore
    String = Text = DateTime = Integer = ForeignKey = object  # type: ignore
    DeclarativeBase = object  # type: ignore
    func = object  # type: ignore
    mapped_column = lambda *args, **kwargs: None  # type: ignore

_ORM_MODELS: Optional[tuple[type, type, type, type]] = (
    None  # (Base, SessionModel, MessageModel, FeedbackModel)
)


def _get_orm_models():
    """Lazy factory for SQLAlchemy ORM models.

    This prevents PEP-563 annotation resolution issues that occur when
    DeclarativeBase models are defined inside function scope.
    """
    global _ORM_MODELS
    if _ORM_MODELS is not None:
        return _ORM_MODELS

    if not _SQLALCHEMY_AVAILABLE:
        raise ImportError(
            "SQLAlchemy dependencies not found. Install with: "
            "pip install 'aiui[sql]' or pip install sqlalchemy aiosqlite"
        )

    class Base(DeclarativeBase):
        pass

    class SessionModel(Base):
        __tablename__ = "sessions"
        id: Mapped[str] = mapped_column(String(255), primary_key=True)
        title: Mapped[str] = mapped_column(String(255), default="New conversation")
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True), default=func.now(), onupdate=func.now()
        )
        platform: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
        icon: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    class MessageModel(Base):
        __tablename__ = "messages"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        session_id: Mapped[str] = mapped_column(
            String(255), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
        )
        role: Mapped[str] = mapped_column(String(50), nullable=False)
        content: Mapped[str] = mapped_column(Text, nullable=False)
        meta: Mapped[Optional[str]] = mapped_column("metadata", Text, nullable=True)  # JSON-encoded
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    class FeedbackModel(Base):
        __tablename__ = "feedback"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        session_id: Mapped[str] = mapped_column(
            String(255), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
        )
        message_id: Mapped[str] = mapped_column(String(255), nullable=False)
        value: Mapped[int] = mapped_column(Integer, nullable=False)  # -1, 0, 1
        comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    _ORM_MODELS = (Base, SessionModel, MessageModel, FeedbackModel)
    return _ORM_MODELS


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
                rest = text[len(prefix) :].strip()
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
            if message.get("role") == "user" and session.get("title") == "New conversation":
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
            temp_file.write_text(json.dumps(feedback_list, indent=2, default=str), encoding="utf-8")
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


# ---------------------------------------------------------------------------
# Built-in: SQLAlchemy store (SQLite + Postgres support)
# ---------------------------------------------------------------------------


class SQLAlchemyDataStore(BaseDataStore):
    """SQLAlchemy-based session storage with SQLite default and Postgres support.

    Features:
    - Schema auto-creation on first run
    - Async via sqlalchemy.ext.asyncio + aiosqlite/asyncpg
    - Atomic writes (single transaction per message append)
    - Lazy import of SQLAlchemy dependencies

    Examples:
        # SQLite (default) - creates ~/.praisonaiui/aiui.db
        datastore = SQLAlchemyDataStore()

        # PostgreSQL
        datastore = SQLAlchemyDataStore("postgresql+asyncpg://user:pass@host/db")

        # Custom SQLite path
        datastore = SQLAlchemyDataStore("sqlite+aiosqlite:///path/to/custom.db")
    """

    def __init__(self, database_url: Optional[str] = None) -> None:
        """Initialize SQLAlchemy datastore.

        Args:
            database_url: SQLAlchemy database URL. If None, defaults to SQLite
                         at ~/.praisonaiui/aiui.db
        """
        self._database_url = database_url or self._get_default_sqlite_url()
        self._engine = None
        self._session_maker = None
        self._initialized = False

    def _get_default_sqlite_url(self) -> str:
        """Get default SQLite database URL."""
        # Respect AIUI_DATA_DIR env var (e.g. /data on containers)
        base = Path(os.environ.get("AIUI_DATA_DIR", str(Path.home() / ".praisonaiui")))
        base.mkdir(parents=True, exist_ok=True)
        db_path = base / "aiui.db"
        return f"sqlite+aiosqlite:///{db_path}"

    async def _ensure_initialized(self) -> None:
        """Lazy initialization of SQLAlchemy engine and tables."""
        if self._initialized:
            return

        try:
            # Lazy imports - only load when SQLAlchemyDataStore is actually used
            from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        except ImportError as e:
            raise ImportError(
                "SQLAlchemy dependencies not found. Install with: "
                "pip install 'aiui[sql]' or pip install sqlalchemy aiosqlite"
            ) from e

        # Get ORM models from factory
        Base, SessionModel, MessageModel, FeedbackModel = _get_orm_models()
        self._SessionModel = SessionModel
        self._MessageModel = MessageModel
        self._FeedbackModel = FeedbackModel

        # Create engine
        self._engine = create_async_engine(
            self._database_url,
            echo=False,  # Set to True for SQL debugging
            future=True,
        )

        # Create all tables
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # Create session maker
        self._session_maker = async_sessionmaker(self._engine, expire_on_commit=False)

        self._initialized = True

    async def list_sessions(self) -> list[dict[str, Any]]:
        """Return a list of session summaries."""
        await self._ensure_initialized()

        from sqlalchemy import func, select

        async with self._session_maker() as session:
            # Get sessions with message counts
            stmt = (
                select(
                    self._SessionModel.id,
                    self._SessionModel.title,
                    self._SessionModel.created_at,
                    self._SessionModel.updated_at,
                    self._SessionModel.platform,
                    self._SessionModel.icon,
                    func.count(self._MessageModel.id).label("message_count"),
                )
                .outerjoin(
                    self._MessageModel, self._SessionModel.id == self._MessageModel.session_id
                )
                .group_by(
                    self._SessionModel.id,
                    self._SessionModel.title,
                    self._SessionModel.created_at,
                    self._SessionModel.updated_at,
                    self._SessionModel.platform,
                    self._SessionModel.icon,
                )
                .order_by(self._SessionModel.updated_at.desc())
            )

            result = await session.execute(stmt)
            sessions = []

            for row in result:
                entry = {
                    "id": row.id,
                    "title": row.title,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    "message_count": row.message_count or 0,
                }
                # Include platform metadata for channel sessions
                if row.platform:
                    entry["platform"] = row.platform
                if row.icon:
                    entry["icon"] = row.icon
                sessions.append(entry)

            return sessions

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        """Return full session data including messages."""
        await self._ensure_initialized()

        from sqlalchemy import select

        async with self._session_maker() as session:
            # Get session
            stmt = select(self._SessionModel).where(self._SessionModel.id == session_id)
            result = await session.execute(stmt)
            session_row = result.scalar_one_or_none()

            if not session_row:
                return None

            # Get messages
            msg_stmt = (
                select(self._MessageModel)
                .where(self._MessageModel.session_id == session_id)
                .order_by(self._MessageModel.created_at, self._MessageModel.id)
            )
            msg_result = await session.execute(msg_stmt)

            messages = []
            for msg_row in msg_result.scalars():
                message_data = {
                    "role": msg_row.role,
                    "content": msg_row.content,
                }
                # Deserialize metadata (toolCalls, etc.)
                if msg_row.meta:
                    try:
                        metadata = json.loads(msg_row.meta)
                        message_data.update(metadata)
                    except json.JSONDecodeError:
                        pass
                messages.append(message_data)

            # Build session dict
            session_data = {
                "id": session_row.id,
                "title": session_row.title,
                "created_at": session_row.created_at.isoformat()
                if session_row.created_at
                else None,
                "updated_at": session_row.updated_at.isoformat()
                if session_row.updated_at
                else None,
                "messages": messages,
            }
            if session_row.platform:
                session_data["platform"] = session_row.platform
            if session_row.icon:
                session_data["icon"] = session_row.icon

            return session_data

    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        """Create a new session."""
        await self._ensure_initialized()

        sid = session_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        async with self._session_maker() as session:
            new_session = self._SessionModel(
                id=sid, title="New conversation", created_at=now, updated_at=now
            )
            session.add(new_session)
            await session.commit()

            return {
                "id": sid,
                "title": "New conversation",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "messages": [],
            }

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its messages."""
        await self._ensure_initialized()

        from sqlalchemy import delete

        async with self._session_maker() as session:
            # Foreign key cascade will handle message/feedback deletion
            result = await session.execute(
                delete(self._SessionModel).where(self._SessionModel.id == session_id)
            )

            await session.commit()
            return result.rowcount > 0

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        """Append a message to a session's history."""
        await self._ensure_initialized()

        from sqlalchemy import select, update

        # Extract core fields
        role = message.get("role", "user")
        content = message.get("content", "")

        # Everything else goes in metadata (toolCalls, etc.)
        metadata = {}
        for key, value in message.items():
            if key not in ("role", "content"):
                metadata[key] = value

        metadata_json = json.dumps(metadata) if metadata else None
        now = datetime.now(timezone.utc)

        async with self._session_maker() as session:
            # Add message
            new_message = self._MessageModel(
                session_id=session_id,
                role=role,
                content=content,
                meta=metadata_json,
                created_at=now,
            )
            session.add(new_message)

            # Update session timestamp
            await session.execute(
                update(self._SessionModel)
                .where(self._SessionModel.id == session_id)
                .values(updated_at=now)
            )

            # Auto-generate title from first user message
            if role == "user":
                # Check if session still has default title
                stmt = select(self._SessionModel).where(self._SessionModel.id == session_id)
                result = await session.execute(stmt)
                session_row = result.scalar_one_or_none()

                if session_row and session_row.title == "New conversation":
                    new_title = self.generate_title(content)
                    await session.execute(
                        update(self._SessionModel)
                        .where(self._SessionModel.id == session_id)
                        .values(title=new_title)
                    )

            await session.commit()

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        """Return all messages for a session."""
        await self._ensure_initialized()

        from sqlalchemy import select

        async with self._session_maker() as session:
            stmt = (
                select(self._MessageModel)
                .where(self._MessageModel.session_id == session_id)
                .order_by(self._MessageModel.created_at, self._MessageModel.id)
            )
            result = await session.execute(stmt)

            messages = []
            for row in result.scalars():
                message_data = {
                    "role": row.role,
                    "content": row.content,
                }
                # Deserialize metadata
                if row.meta:
                    try:
                        metadata = json.loads(row.meta)
                        message_data.update(metadata)
                    except json.JSONDecodeError:
                        pass
                messages.append(message_data)

            return messages

    async def update_session(self, session_id: str, **kwargs: Any) -> None:
        """Update session metadata."""
        await self._ensure_initialized()

        from sqlalchemy import update

        # Filter to allowed columns to prevent crashes on invalid keys
        allowed_keys = {"title", "platform", "icon"}
        update_data = {k: v for k, v in kwargs.items() if k in allowed_keys}

        if not update_data:
            return

        # Add updated timestamp
        update_data["updated_at"] = datetime.now(timezone.utc)

        async with self._session_maker() as session:
            await session.execute(
                update(self._SessionModel)
                .where(self._SessionModel.id == session_id)
                .values(**update_data)
            )
            await session.commit()

    async def record_feedback(
        self,
        session_id: str,
        message_id: str,
        value: int,
        comment: Optional[str] = None,
    ) -> None:
        """Record user feedback for a message."""
        await self._ensure_initialized()

        async with self._session_maker() as session:
            feedback = self._FeedbackModel(
                session_id=session_id,
                message_id=message_id,
                value=value,
                comment=comment,
                created_at=datetime.now(timezone.utc),
            )
            session.add(feedback)
            await session.commit()

    async def list_feedback(
        self,
        session_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """List feedback records, optionally filtered by session."""
        await self._ensure_initialized()

        from sqlalchemy import select

        async with self._session_maker() as session:
            stmt = select(self._FeedbackModel)
            if session_id is not None:
                stmt = stmt.where(self._FeedbackModel.session_id == session_id)

            result = await session.execute(stmt)
            feedback_list = []

            for row in result.scalars():
                feedback_list.append(
                    {
                        "id": str(row.id),
                        "session_id": row.session_id,
                        "message_id": row.message_id,
                        "value": row.value,
                        "comment": row.comment,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                )

            return feedback_list

    async def close(self) -> None:
        """Clean up database connections."""
        if self._engine:
            await self._engine.dispose()
