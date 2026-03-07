"""Memory feature — protocol-driven memory with swappable backends.

Architecture:
    MemoryProtocol (ABC)          <- any backend implements this
      ├── SimpleMemoryManager     <- default in-memory (no deps)
      └── SDKMemoryManager        <- wraps praisonaiagents.memory.Memory

    PraisonAIMemory (BaseFeatureProtocol)
      └── delegates to active MemoryProtocol implementation

Config-driven:
    memory:
      provider: "simple" | "sdk"
      config: { ... }  # passed to provider
"""

from __future__ import annotations

import logging
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Memory Protocol ──────────────────────────────────────────────────


class MemoryProtocol(ABC):
    """Protocol interface for memory backends.

    Any memory implementation (simple, SDK, custom) implements this.
    PraisonAIMemory delegates all operations to the active protocol.
    """

    @abstractmethod
    def store(
        self,
        text: str,
        *,
        memory_type: str = "long",
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Store a memory entry. Returns the stored entry dict."""
        ...

    @abstractmethod
    def search(
        self,
        query: str,
        *,
        memory_type: str = "all",
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search memories. Returns list of matching entries."""
        ...

    @abstractmethod
    def list_all(self, *, memory_type: str = "all") -> List[Dict[str, Any]]:
        """List all memories, optionally filtered by type."""
        ...

    @abstractmethod
    def get(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """Get a single memory by ID."""
        ...

    @abstractmethod
    def delete(self, memory_id: str) -> bool:
        """Delete a memory by ID. Returns True if found and deleted."""
        ...

    @abstractmethod
    def clear(self, memory_type: str = "all") -> int:
        """Clear memories. Returns count of cleared entries."""
        ...

    def get_context(self, query: str, *, limit: int = 5) -> str:
        """Get memory context string for injection into prompts.

        Default: search and format results as text.
        SDK backend overrides this with Agent.get_memory_context().
        """
        results = self.search(query, limit=limit)
        if not results:
            return ""
        lines = [f"- {r.get('text', '')}" for r in results]
        return "Relevant memories:\n" + "\n".join(lines)

    def health(self) -> Dict[str, Any]:
        """Health check for this backend."""
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Memory Manager (Default, no deps) ────────────────────────


class SimpleMemoryManager(MemoryProtocol):
    """In-memory implementation — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._memories: Dict[str, Dict[str, Any]] = {}

    def store(
        self,
        text: str,
        *,
        memory_type: str = "long",
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        mem_id = uuid.uuid4().hex[:12]
        entry = {
            "id": mem_id,
            "text": text,
            "memory_type": memory_type,
            "session_id": session_id,
            "agent_id": agent_id,
            "metadata": metadata or {},
            "created_at": time.time(),
        }
        self._memories[mem_id] = entry
        return entry

    def search(
        self,
        query: str,
        *,
        memory_type: str = "all",
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        query_lower = query.lower()
        results = []
        for m in self._memories.values():
            if memory_type != "all" and m.get("memory_type") != memory_type:
                continue
            if query_lower in m.get("text", "").lower():
                results.append(m)
            if len(results) >= limit:
                break
        return results

    def list_all(self, *, memory_type: str = "all") -> List[Dict[str, Any]]:
        if memory_type == "all":
            return list(self._memories.values())
        return [m for m in self._memories.values() if m.get("memory_type") == memory_type]

    def get(self, memory_id: str) -> Optional[Dict[str, Any]]:
        return self._memories.get(memory_id)

    def delete(self, memory_id: str) -> bool:
        if memory_id in self._memories:
            del self._memories[memory_id]
            return True
        return False

    def clear(self, memory_type: str = "all") -> int:
        if memory_type == "all":
            count = len(self._memories)
            self._memories.clear()
            return count
        to_remove = [k for k, v in self._memories.items() if v.get("memory_type") == memory_type]
        for k in to_remove:
            del self._memories[k]
        return len(to_remove)

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleMemoryManager",
            "total_memories": len(self._memories),
        }


# ── SDK Memory Manager (wraps praisonaiagents.memory) ────────────────


class SDKMemoryManager(MemoryProtocol):
    """Wraps praisonaiagents.memory.Memory for production use.

    Features: ChromaDB vector search, MongoDB, Mem0, FileMemory,
    quality scoring, auto-promote, entity memory.

    Lazy-imports praisonaiagents to avoid hard dependency.
    """

    def __init__(self, **config: Any) -> None:
        self._config = config
        self._sdk_memory = None
        self._local_index: Dict[str, Dict[str, Any]] = {}

    def _get_sdk_memory(self) -> Any:
        """Lazy-init SDK Memory."""
        if self._sdk_memory is None:
            try:
                from praisonaiagents.memory import Memory
                self._sdk_memory = Memory(config=self._config) if self._config else Memory()
                logger.info("SDK Memory initialized: %s", type(self._sdk_memory).__name__)
            except ImportError:
                logger.warning("praisonaiagents not installed; falling back to local index")
                return None
            except Exception as e:
                logger.warning("SDK Memory init failed: %s; using local index", e)
                return None
        return self._sdk_memory

    def store(
        self,
        text: str,
        *,
        memory_type: str = "long",
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        mem_id = uuid.uuid4().hex[:12]
        entry = {
            "id": mem_id,
            "text": text,
            "memory_type": memory_type,
            "session_id": session_id,
            "agent_id": agent_id,
            "metadata": metadata or {},
            "created_at": time.time(),
        }

        # Bridge to gateway agent's memory if agent_id provided
        if agent_id:
            try:
                from ._gateway_ref import get_gateway
                gw = get_gateway()
                if gw is not None:
                    gw_agent = gw.get_agent(agent_id)
                    if gw_agent and hasattr(gw_agent, "store_memory"):
                        gw_agent.store_memory(text)
                        entry["gateway_synced"] = True
            except (ImportError, Exception) as e:
                logger.debug("Gateway memory bridge skipped: %s", e)

        sdk = self._get_sdk_memory()
        if sdk is not None:
            try:
                method = {
                    "short": "store_short_term",
                    "long": "store_long_term",
                    "entity": "store_entity",
                }.get(memory_type, "store_long_term")
                if hasattr(sdk, method):
                    getattr(sdk, method)(text, metadata=metadata or {})
            except Exception as e:
                logger.warning("SDK store failed: %s", e)

        self._local_index[mem_id] = entry
        return entry

    def search(
        self,
        query: str,
        *,
        memory_type: str = "all",
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        sdk = self._get_sdk_memory()
        if sdk is not None:
            try:
                method = {
                    "short": "search_short_term",
                    "long": "search_long_term",
                }.get(memory_type, "search_long_term")
                if hasattr(sdk, method):
                    results = getattr(sdk, method)(query, limit=limit)
                    if isinstance(results, list):
                        return [
                            {"id": str(i), "text": str(r), "memory_type": memory_type, "score": 1.0}
                            for i, r in enumerate(results[:limit])
                        ]
            except Exception as e:
                logger.warning("SDK search failed: %s; falling back to local", e)

        # Fallback to local text search
        query_lower = query.lower()
        results = []
        for m in self._local_index.values():
            if memory_type != "all" and m.get("memory_type") != memory_type:
                continue
            if query_lower in m.get("text", "").lower():
                results.append(m)
            if len(results) >= limit:
                break
        return results

    def list_all(self, *, memory_type: str = "all") -> List[Dict[str, Any]]:
        if memory_type == "all":
            return list(self._local_index.values())
        return [m for m in self._local_index.values() if m.get("memory_type") == memory_type]

    def get(self, memory_id: str) -> Optional[Dict[str, Any]]:
        return self._local_index.get(memory_id)

    def delete(self, memory_id: str) -> bool:
        if memory_id in self._local_index:
            del self._local_index[memory_id]
            return True
        return False

    def clear(self, memory_type: str = "all") -> int:
        if memory_type == "all":
            count = len(self._local_index)
            self._local_index.clear()
            return count
        to_remove = [k for k, v in self._local_index.items() if v.get("memory_type") == memory_type]
        for k in to_remove:
            del self._local_index[k]
        return len(to_remove)

    def get_context(self, query: str, *, limit: int = 5) -> str:
        """Use SDK's get_memory_context if available."""
        sdk = self._get_sdk_memory()
        if sdk is not None and hasattr(sdk, "get_memory_context"):
            try:
                return sdk.get_memory_context(query)
            except Exception:
                pass
        return super().get_context(query, limit=limit)

    def health(self) -> Dict[str, Any]:
        sdk = self._get_sdk_memory()
        return {
            "status": "ok" if sdk is not None else "degraded",
            "provider": "SDKMemoryManager",
            "sdk_available": sdk is not None,
            "total_indexed": len(self._local_index),
        }


# ── Manager singleton ────────────────────────────────────────────────

_memory_manager: Optional[MemoryProtocol] = None


def get_memory_manager() -> MemoryProtocol:
    """Get the active memory manager (lazy init SimpleMemoryManager)."""
    global _memory_manager
    if _memory_manager is None:
        _memory_manager = SimpleMemoryManager()
    return _memory_manager


def set_memory_manager(manager: MemoryProtocol) -> None:
    """Swap the memory backend at runtime."""
    global _memory_manager
    _memory_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class PraisonAIMemory(BaseFeatureProtocol):
    """Memory management — delegates to MemoryProtocol backend."""

    feature_name = "memory"
    feature_description = "Agent memory management (short-term, long-term, entity)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/memory", self._list, methods=["GET"]),
            Route("/api/memory", self._add, methods=["POST"]),
            Route("/api/memory/search", self._search, methods=["POST"]),
            Route("/api/memory/context", self._get_context, methods=["POST"]),
            Route("/api/memory/session/{session_id}", self._list_by_session, methods=["GET"]),
            Route("/api/memory/status", self._status, methods=["GET"]),
            Route("/api/memory", self._clear, methods=["DELETE"]),
            Route("/api/memory/{memory_id}", self._get, methods=["GET"]),
            Route("/api/memory/{memory_id}", self._delete, methods=["DELETE"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "memory",
            "help": "Manage agent memory",
            "commands": {
                "list": {"help": "List all memories", "handler": self._cli_list},
                "add": {"help": "Add a memory entry", "handler": self._cli_add},
                "search": {"help": "Search memories", "handler": self._cli_search},
                "clear": {"help": "Clear all memories", "handler": self._cli_clear},
                "status": {"help": "Memory status", "handler": self._cli_status},
                "context": {"help": "Get memory context for a query", "handler": self._cli_context},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        mgr = get_memory_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        memory_type = request.query_params.get("type", "all")
        items = mgr.list_all(memory_type=memory_type)
        return JSONResponse({"memories": items, "count": len(items)})

    async def _add(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        body = await request.json()
        entry = mgr.store(
            text=body.get("text", ""),
            memory_type=body.get("memory_type", "long"),
            session_id=body.get("session_id"),
            agent_id=body.get("agent_id"),
            metadata=body.get("metadata", {}),
        )
        return JSONResponse(entry, status_code=201)

    async def _search(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        body = await request.json()
        results = mgr.search(
            query=body.get("query", ""),
            memory_type=body.get("memory_type", "all"),
            limit=body.get("limit", 10),
        )
        return JSONResponse({"results": results, "count": len(results)})

    async def _get_context(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        body = await request.json()
        context = mgr.get_context(
            query=body.get("query", ""),
            limit=body.get("limit", 5),
        )
        return JSONResponse({"context": context})

    async def _clear(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        memory_type = request.query_params.get("type", "all")
        count = mgr.clear(memory_type=memory_type)
        return JSONResponse({"cleared": count})

    async def _get(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        mem_id = request.path_params["memory_id"]
        entry = mgr.get(mem_id)
        if not entry:
            return JSONResponse({"error": "Memory not found"}, status_code=404)
        return JSONResponse(entry)

    async def _delete(self, request: Request) -> JSONResponse:
        mgr = get_memory_manager()
        mem_id = request.path_params["memory_id"]
        if not mgr.delete(mem_id):
            return JSONResponse({"error": "Memory not found"}, status_code=404)
        return JSONResponse({"deleted": mem_id})

    async def _list_by_session(self, request: Request) -> JSONResponse:
        """GET /api/memory/session/{session_id} — list memories for a session."""
        mgr = get_memory_manager()
        session_id = request.path_params["session_id"]
        all_items = mgr.list_all()
        # Filter by session_id
        items = [m for m in all_items if m.get("session_id") == session_id]
        return JSONResponse({"memories": items, "count": len(items), "session_id": session_id})

    async def _status(self, request: Request) -> JSONResponse:
        """GET /api/memory/status — memory stats and health."""
        mgr = get_memory_manager()
        items = mgr.list_all()
        by_type: Dict[str, int] = {}
        for m in items:
            t = m.get("memory_type", "unknown")
            by_type[t] = by_type.get(t, 0) + 1
        h = mgr.health()
        return JSONResponse({
            "total": len(items),
            "by_type": by_type,
            "backend": h.get("backend", "unknown"),
            "status": h.get("status", "ok"),
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        mgr = get_memory_manager()
        items = mgr.list_all()
        if not items:
            return "No memories stored"
        lines = []
        for m in items:
            text_preview = m["text"][:60] + "…" if len(m["text"]) > 60 else m["text"]
            lines.append(f"  [{m['memory_type']}] {m['id']} — {text_preview}")
        return "\n".join(lines)

    def _cli_add(self, text: str, memory_type: str = "long") -> str:
        mgr = get_memory_manager()
        entry = mgr.store(text=text, memory_type=memory_type)
        return f"Added memory {entry['id']}"

    def _cli_search(self, query: str) -> str:
        mgr = get_memory_manager()
        results = mgr.search(query, limit=10)
        if not results:
            return "No results"
        lines = [f"  {m['id']} — {m.get('text', '')[:60]}" for m in results]
        return "\n".join(lines)

    def _cli_clear(self, memory_type: str = "all") -> str:
        mgr = get_memory_manager()
        count = mgr.clear(memory_type=memory_type)
        return f"Cleared {count} memories"

    def _cli_status(self) -> str:
        mgr = get_memory_manager()
        items = mgr.list_all()
        by_type: Dict[str, int] = {}
        for m in items:
            t = m.get("memory_type", "unknown")
            by_type[t] = by_type.get(t, 0) + 1
        parts = [f"{t}: {c}" for t, c in by_type.items()]
        return f"Total: {len(items)} ({', '.join(parts) if parts else 'empty'})"

    def _cli_context(self, query: str) -> str:
        mgr = get_memory_manager()
        return mgr.get_context(query) or "No relevant memories found"
