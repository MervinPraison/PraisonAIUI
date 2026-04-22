"""Provider protocol — any AI backend implements this to plug into PraisonAIUI.

This module defines the abstract base class and event types that make
PraisonAIUI provider-agnostic.  Any backend (PraisonAI, LangChain, CrewAI,
AutoGen, Agno, or custom) can implement ``BaseProvider`` and be used as a
drop-in replacement.

Example — minimal custom provider::

    from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

    class EchoProvider(BaseProvider):
        async def run(self, message, **kw):
            yield RunEvent(type=RunEventType.RUN_STARTED)
            yield RunEvent(type=RunEventType.RUN_CONTENT, token=f"Echo: {message}")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"Echo: {message}")

    # Plug it in:
    import praisonaiui
    praisonaiui.set_provider(EchoProvider())
"""

from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional

# ---------------------------------------------------------------------------
# Event types (matches frontend RunEventType in types.ts exactly)
# ---------------------------------------------------------------------------


class RunEventType(str, Enum):
    """Structured event types emitted during an agent run.

    These values are wire-compatible with the frontend ``RunEventType``
    union in ``src/frontend/src/types.ts``.
    """

    # --- Agent lifecycle ---
    RUN_STARTED = "run_started"
    RUN_CONTENT = "run_content"
    RUN_COMPLETED = "run_completed"
    RUN_ERROR = "run_error"
    RUN_CANCELLED = "run_cancelled"

    # --- Tool calls ---
    TOOL_CALL_STARTED = "tool_call_started"
    TOOL_CALL_COMPLETED = "tool_call_completed"

    # --- LLM intermediate content (narrative between tool calls) ---
    LLM_CONTENT = "llm_content"

    # --- Reasoning / Thinking ---
    REASONING_STARTED = "reasoning_started"
    REASONING_STEP = "reasoning_step"
    REASONING_COMPLETED = "reasoning_completed"

    # --- Memory ---
    UPDATING_MEMORY = "updating_memory"
    MEMORY_UPDATE_STARTED = "memory_update_started"
    MEMORY_UPDATE_COMPLETED = "memory_update_completed"

    # --- Control ---
    RUN_PAUSED = "run_paused"
    RUN_CONTINUED = "run_continued"

    # --- RAG / Citations (Issue #49) ---
    REFERENCES = "references"

    # --- Team variants ---
    TEAM_RUN_STARTED = "team_run_started"
    TEAM_RUN_CONTENT = "team_run_content"
    TEAM_RUN_COMPLETED = "team_run_completed"
    TEAM_RUN_ERROR = "team_run_error"
    TEAM_RUN_CANCELLED = "team_run_cancelled"
    TEAM_TOOL_CALL_STARTED = "team_tool_call_started"
    TEAM_TOOL_CALL_COMPLETED = "team_tool_call_completed"
    TEAM_REASONING_STARTED = "team_reasoning_started"
    TEAM_REASONING_STEP = "team_reasoning_step"
    TEAM_REASONING_COMPLETED = "team_reasoning_completed"
    TEAM_MEMORY_UPDATE_STARTED = "team_memory_update_started"
    TEAM_MEMORY_UPDATE_COMPLETED = "team_memory_update_completed"


# ---------------------------------------------------------------------------
# Structured payload dataclasses (Issues #48, #49, #50)
# ---------------------------------------------------------------------------


@dataclass
class ModelCard:
    """Model / provider info advertised by an agent or team (Issue #48).

    PraisonAI-native, non-developer-friendly name: a "card" is the small
    info block a UI shows next to an agent.
    """

    name: str
    model: str
    provider: str

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "model": self.model, "provider": self.provider}


@dataclass
class AgentCard:
    """Agent discovery card — what a chat frontend shows in its picker (Issue #48)."""

    agent_id: str
    name: str
    description: str = ""
    model: Optional[ModelCard] = None
    storage: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "agent_id": self.agent_id,
            "name": self.name,
            "description": self.description,
            "storage": self.storage,
        }
        if self.model is not None:
            d["model"] = self.model.to_dict()
        return d


@dataclass
class TeamCard:
    """Team discovery card — what a chat frontend shows for multi-agent teams (Issue #48)."""

    team_id: str
    name: str
    description: str = ""
    model: Optional[ModelCard] = None
    storage: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "team_id": self.team_id,
            "name": self.name,
            "description": self.description,
            "storage": self.storage,
        }
        if self.model is not None:
            d["model"] = self.model.to_dict()
        return d


@dataclass
class SourceChunk:
    """A single RAG retrieval chunk cited by an answer (Issue #49).

    PraisonAI-native name — "source chunk" is the plain-English term a
    non-developer would use for "a piece of a source document that was used".
    """

    name: str
    content: str
    chunk: int = 0
    chunk_size: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "content": self.content,
            "chunk": self.chunk,
            "chunk_size": self.chunk_size,
        }


@dataclass
class SourceBundle:
    """A bundle of source chunks retrieved for one query (Issue #49).

    Wire format keeps the industry-standard ``references`` JSON key so
    third-party frontends see the expected shape; only the Python class
    name is PraisonAI-native.
    """

    query: str
    chunks: List[SourceChunk] = field(default_factory=list)
    time_ms: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "query": self.query,
            "references": [c.to_dict() for c in self.chunks],
        }
        if self.time_ms is not None:
            d["time_ms"] = self.time_ms
        return d


@dataclass
class ThoughtStep:
    """Structured reasoning-step payload (Issue #50).

    PraisonAI-native name — pairs with the existing ``ThinkingSteps`` UI
    component.  All fields beyond ``title`` are optional so providers can
    adopt the richer schema incrementally without breaking existing
    behaviour.
    """

    title: str
    result: str = ""
    reasoning: str = ""
    action: Optional[str] = None            # e.g. "search", "plan", "verify"
    confidence: Optional[float] = None      # 0.0 .. 1.0
    next_action: Optional[str] = None       # what the agent plans to do next

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "title": self.title,
            "result": self.result,
            "reasoning": self.reasoning,
        }
        for key in ("action", "confidence", "next_action"):
            val = getattr(self, key)
            if val is not None:
                d[key] = val
        return d


# ---------------------------------------------------------------------------
# RunEvent — the single data structure emitted by providers
# ---------------------------------------------------------------------------


@dataclass
class RunEvent:
    """A structured event emitted during an agent run.

    Every field beyond ``type`` is optional.  Providers yield these from
    ``BaseProvider.run()``; the server serialises them to SSE ``data:`` frames
    via ``to_dict()``.

    Attributes:
        type:          The event kind (see ``RunEventType``).
        content:       Full message content (for RUN_COMPLETED).
        token:         Streaming token chunk (for RUN_CONTENT).
        name:          Tool name (for TOOL_CALL_*).
        args:          Tool arguments dict.
        result:        Tool result payload.
        tool_call_id:  Unique tool-call identifier.
        step:          Reasoning step text.
        agent_id:      Agent identifier.
        agent_name:    Human-readable agent name.
        error:         Error description.
        event_id:      Auto-generated unique event id.
        timestamp:     Auto-generated epoch timestamp.
        extra_data:    Arbitrary provider-specific payload.
    """

    type: RunEventType

    # Content
    content: Optional[str] = None
    token: Optional[str] = None

    # Tool calls
    name: Optional[str] = None
    args: Optional[Dict[str, Any]] = None
    result: Optional[Any] = None
    tool_call_id: Optional[str] = None

    # Reasoning (Issue #50 — structured fields are optional)
    step: Optional[str] = None
    action: Optional[str] = None
    confidence: Optional[float] = None
    next_action: Optional[str] = None

    # Agent / Team
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    team_id: Optional[str] = None

    # RAG / Citations (Issue #49)
    query: Optional[str] = None
    references: Optional[List[Dict[str, Any]]] = None
    time_ms: Optional[float] = None

    # Error
    error: Optional[str] = None

    # Metadata
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: float = field(default_factory=time.time)
    extra_data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a dict matching the frontend ``SSEEvent`` interface."""
        d: Dict[str, Any] = {"type": self.type.value}
        for key in (
            "content",
            "token",
            "name",
            "args",
            "result",
            "tool_call_id",
            "step",
            "action",
            "confidence",
            "next_action",
            "agent_id",
            "agent_name",
            "team_id",
            "query",
            "references",
            "time_ms",
            "error",
            "event_id",
            "timestamp",
            "extra_data",
        ):
            val = getattr(self, key)
            if val is not None:
                d[key] = val
        return d


# ---------------------------------------------------------------------------
# BaseProvider — the protocol any AI backend implements
# ---------------------------------------------------------------------------


class BaseProvider(ABC):
    """Abstract provider interface for PraisonAIUI.

    Subclass and implement ``run()`` to integrate any AI backend.
    The server calls ``run()`` and iterates the yielded ``RunEvent`` objects,
    serialising each to an SSE frame for the frontend.

    Minimal implementation::

        class MyProvider(BaseProvider):
            async def run(self, message, **kw):
                yield RunEvent(type=RunEventType.RUN_STARTED)
                answer = await my_llm(message)
                yield RunEvent(type=RunEventType.RUN_COMPLETED, content=answer)
    """

    @abstractmethod
    async def run(
        self,
        message: str,
        *,
        session_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        **kwargs: Any,
    ) -> AsyncIterator[RunEvent]:
        """Run the AI backend and yield structured events.

        Implementations should yield at minimum:

        1. ``RunEvent(type=RUN_STARTED)``
        2. ``RunEvent(type=RUN_CONTENT, token="...")`` for each token
        3. ``RunEvent(type=RUN_COMPLETED, content="...")`` when finished

        Args:
            message:     User message text.
            session_id:  Session identifier for context.
            agent_name:  Target agent name (if multi-agent).
            **kwargs:    Provider-specific options.

        Yields:
            RunEvent objects consumed by the server.
        """
        ...  # pragma: no cover
        # (yield required to make this an async generator)
        yield  # type: ignore[misc]

    async def list_agents(self) -> List[Dict[str, Any]]:
        """List available agents.  Override if your backend has agents."""
        return []

    async def list_teams(self) -> List[Dict[str, Any]]:
        """List available multi-agent teams.  Override if your backend has teams.

        Default returns ``[]`` so providers that don't model teams keep working
        unchanged (Issue #48).
        """
        return []

    async def run_team(
        self,
        team_id: str,
        message: str,
        *,
        session_id: Optional[str] = None,
        **kwargs: Any,
    ) -> AsyncIterator[RunEvent]:
        """Run a multi-agent team.  Override if your backend has teams.

        The default implementation delegates to ``run()`` with ``agent_name``
        set to ``team_id`` so single-agent backends transparently treat a
        team_id as an agent_name (Issue #48).
        """
        async for ev in self.run(
            message, session_id=session_id, agent_name=team_id, **kwargs
        ):
            yield ev

    async def health(self) -> Dict[str, Any]:
        """Health check endpoint data.  Override for custom checks."""
        return {"status": "ok", "provider": self.__class__.__name__}

    # -----------------------------------------------------------------
    # Convenience emit helpers (Issues #49, #50) — keep provider code terse.
    # -----------------------------------------------------------------

    @staticmethod
    def source_bundle_event(bundle: "SourceBundle") -> RunEvent:
        """Build a ``REFERENCES`` event from a ``SourceBundle`` (Issue #49).

        The wire ``type`` stays ``references`` for third-party frontend
        compatibility; only the Python-side helper name is PraisonAI-native.
        """
        return RunEvent(
            type=RunEventType.REFERENCES,
            query=bundle.query,
            references=[c.to_dict() for c in bundle.chunks],
            time_ms=bundle.time_ms,
        )

    @staticmethod
    def thought_step_event(step: "ThoughtStep") -> RunEvent:
        """Build a ``REASONING_STEP`` event from a ``ThoughtStep`` (Issue #50)."""
        return RunEvent(
            type=RunEventType.REASONING_STEP,
            step=step.title,
            action=step.action,
            confidence=step.confidence,
            next_action=step.next_action,
            extra_data=step.to_dict(),
        )
