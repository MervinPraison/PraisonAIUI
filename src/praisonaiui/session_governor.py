"""Session Governor — Bounded session memory management for chat examples.

Prevents unbounded memory growth by implementing:
- Context window limits (max_turns)
- Token estimation bounds
- LRU eviction policy for multiple sessions
- Automatic cleanup of old conversations

This module provides a drop-in replacement for the unbounded _contexts dict
pattern used in chat examples, ensuring production-ready memory management.

Example usage in chat handlers::

    from praisonaiui.session_governor import SessionGovernor

    # Replace: _contexts: dict[str, list[dict]] = {}
    governor = SessionGovernor(max_turns=20, max_sessions=100)

    @aiui.reply
    async def on_message(message: str):
        session_id = getattr(message, "session_id", "default")

        # Replace: _contexts[session_id].append(...)
        governor.add_message(session_id, {"role": "user", "content": str(message)})

        # Get bounded context for LLM
        context = governor.get_context(session_id)

        # Stream from LLM...
        governor.add_message(session_id, {"role": "assistant", "content": response})
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional


class SessionGovernor:
    """Bounded session memory manager with automatic eviction policies.

    Replaces unbounded dict patterns in chat examples with production-ready
    session management that prevents OOM conditions.
    """

    def __init__(
        self,
        max_turns: int = 20,
        max_sessions: int = 100,
        max_tokens_estimate: int = 8000,
        system_message: Optional[str] = None,
    ):
        """Initialize session governor with memory bounds.

        Args:
            max_turns: Maximum conversation turns per session (default: 20)
            max_sessions: Maximum concurrent sessions in memory (default: 100)
            max_tokens_estimate: Rough token limit per session (default: 8000)
            system_message: Default system message for new sessions
        """
        self.max_turns = max_turns
        self.max_sessions = max_sessions
        self.max_tokens_estimate = max_tokens_estimate
        self.system_message = system_message or "You are a helpful, concise assistant."

        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._access_times: Dict[str, float] = {}

    def add_message(self, session_id: str, message: Dict[str, Any]) -> None:
        """Add a message to the session with automatic bounds enforcement.

        Args:
            session_id: Session identifier
            message: Message dict with 'role' and 'content' keys
        """
        self._ensure_session_exists(session_id)
        self._evict_oldest_sessions()

        session = self._sessions[session_id]
        session["messages"].append(message)
        session["updated_at"] = time.time()
        self._access_times[session_id] = time.time()

        # Enforce turn limit with rolling window
        messages = session["messages"]
        if len(messages) > self.max_turns * 2:  # 2 messages per turn (user + assistant)
            # Keep system message + recent turns
            system_msgs = [m for m in messages if m.get("role") == "system"]
            keep_count = self.max_turns * 2 - len(system_msgs)
            recent_msgs = messages[-keep_count:] if keep_count > 0 else []
            session["messages"] = system_msgs + recent_msgs

    def get_context(self, session_id: str) -> List[Dict[str, Any]]:
        """Get the full conversation context for a session.

        Returns a list suitable for passing directly to LLM APIs.

        Args:
            session_id: Session identifier

        Returns:
            List of message dicts with 'role' and 'content' keys
        """
        self._ensure_session_exists(session_id)
        self._access_times[session_id] = time.time()
        return self._sessions[session_id]["messages"].copy()

    def clear_session(self, session_id: str) -> None:
        """Clear all messages from a session while preserving system message.

        Args:
            session_id: Session identifier
        """
        if session_id in self._sessions:
            session = self._sessions[session_id]
            system_msgs = [m for m in session["messages"] if m.get("role") == "system"]
            session["messages"] = system_msgs
            session["updated_at"] = time.time()
            self._access_times[session_id] = time.time()

    def delete_session(self, session_id: str) -> None:
        """Completely remove a session from memory.

        Args:
            session_id: Session identifier
        """
        self._sessions.pop(session_id, None)
        self._access_times.pop(session_id, None)

    def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        """Get statistics for a session.

        Args:
            session_id: Session identifier

        Returns:
            Dict with turn count, estimated tokens, and timestamps
        """
        if session_id not in self._sessions:
            return {"exists": False}

        session = self._sessions[session_id]
        messages = session["messages"]
        estimated_tokens = self._estimate_tokens(messages)

        return {
            "exists": True,
            "turns": len([m for m in messages if m.get("role") in ("user", "assistant")]) // 2,
            "total_messages": len(messages),
            "estimated_tokens": estimated_tokens,
            "created_at": session["created_at"],
            "updated_at": session["updated_at"],
            "within_bounds": estimated_tokens <= self.max_tokens_estimate,
        }

    def list_sessions(self) -> List[str]:
        """List all active session IDs, sorted by recent access.

        Returns:
            List of session IDs, most recently accessed first
        """
        return sorted(
            self._sessions.keys(),
            key=lambda sid: self._access_times.get(sid, 0),
            reverse=True,
        )

    def get_memory_stats(self) -> Dict[str, Any]:
        """Get overall memory usage statistics.

        Returns:
            Dict with session counts, memory usage estimates
        """
        total_messages = sum(len(s["messages"]) for s in self._sessions.values())
        total_tokens = sum(self._estimate_tokens(s["messages"]) for s in self._sessions.values())

        return {
            "active_sessions": len(self._sessions),
            "max_sessions": self.max_sessions,
            "total_messages": total_messages,
            "estimated_total_tokens": total_tokens,
            "memory_pressure": len(self._sessions) / self.max_sessions,
        }

    def _ensure_session_exists(self, session_id: str) -> None:
        """Create session if it doesn't exist."""
        if session_id not in self._sessions:
            now = time.time()
            self._sessions[session_id] = {
                "messages": [{"role": "system", "content": self.system_message}],
                "created_at": now,
                "updated_at": now,
            }
            self._access_times[session_id] = now

    def _evict_oldest_sessions(self) -> None:
        """Remove oldest sessions if we exceed max_sessions limit."""
        while len(self._sessions) > self.max_sessions:
            # Find least recently accessed session
            oldest_session = min(
                self._access_times.keys(),
                key=lambda sid: self._access_times[sid],
            )
            self.delete_session(oldest_session)

    def _estimate_tokens(self, messages: List[Dict[str, Any]]) -> int:
        """Rough token estimation for session bounds checking.

        Uses simple heuristic: ~1.3 tokens per word for English text.
        """
        total_chars = sum(len(str(m.get("content", ""))) for m in messages)
        # Rough approximation: 4 chars per token on average
        return int(total_chars / 4 * 1.3)
