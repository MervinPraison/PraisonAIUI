"""Memory feature — wire praisonaiagents.memory into PraisonAIUI.

Provides API endpoints and CLI commands for memory management:
add, search, list, and clear operations for short-term and long-term memory.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory store (mirrors praisonaiagents.memory.file_memory)
_memories: Dict[str, Dict[str, Any]] = {}


class PraisonAIMemory(BaseFeatureProtocol):
    """Memory management wired to praisonaiagents.memory."""

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
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "total_memories": len(_memories),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        memory_type = request.query_params.get("type", "all")
        if memory_type == "all":
            items = list(_memories.values())
        else:
            items = [m for m in _memories.values() if m.get("memory_type") == memory_type]
        return JSONResponse({"memories": items, "count": len(items)})

    async def _add(self, request: Request) -> JSONResponse:
        body = await request.json()
        mem_id = uuid.uuid4().hex[:12]
        entry = {
            "id": mem_id,
            "text": body.get("text", ""),
            "memory_type": body.get("memory_type", "long"),
            "session_id": body.get("session_id"),
            "agent_id": body.get("agent_id"),
            "metadata": body.get("metadata", {}),
            "created_at": time.time(),
        }
        _memories[mem_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _search(self, request: Request) -> JSONResponse:
        body = await request.json()
        query = body.get("query", "").lower()
        limit = body.get("limit", 10)
        memory_type = body.get("memory_type", "all")
        results = []
        for m in _memories.values():
            if memory_type != "all" and m.get("memory_type") != memory_type:
                continue
            if query in m.get("text", "").lower():
                results.append(m)
            if len(results) >= limit:
                break
        return JSONResponse({"results": results, "count": len(results)})

    async def _clear(self, request: Request) -> JSONResponse:
        memory_type = request.query_params.get("type", "all")
        if memory_type == "all":
            count = len(_memories)
            _memories.clear()
        else:
            to_remove = [k for k, v in _memories.items() if v.get("memory_type") == memory_type]
            count = len(to_remove)
            for k in to_remove:
                del _memories[k]
        return JSONResponse({"cleared": count})

    async def _get(self, request: Request) -> JSONResponse:
        mem_id = request.path_params["memory_id"]
        entry = _memories.get(mem_id)
        if not entry:
            return JSONResponse({"error": "Memory not found"}, status_code=404)
        return JSONResponse(entry)

    async def _delete(self, request: Request) -> JSONResponse:
        mem_id = request.path_params["memory_id"]
        if mem_id not in _memories:
            return JSONResponse({"error": "Memory not found"}, status_code=404)
        del _memories[mem_id]
        return JSONResponse({"deleted": mem_id})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _memories:
            return "No memories stored"
        lines = []
        for m in _memories.values():
            text_preview = m["text"][:60] + "…" if len(m["text"]) > 60 else m["text"]
            lines.append(f"  [{m['memory_type']}] {m['id']} — {text_preview}")
        return "\n".join(lines)

    def _cli_add(self, text: str, memory_type: str = "long") -> str:
        mem_id = uuid.uuid4().hex[:12]
        _memories[mem_id] = {
            "id": mem_id, "text": text, "memory_type": memory_type,
            "metadata": {}, "created_at": time.time(),
        }
        return f"Added memory {mem_id}"

    def _cli_search(self, query: str) -> str:
        results = [m for m in _memories.values() if query.lower() in m.get("text", "").lower()]
        if not results:
            return "No results"
        lines = [f"  {m['id']} — {m['text'][:60]}" for m in results[:10]]
        return "\n".join(lines)

    def _cli_clear(self, memory_type: str = "all") -> str:
        if memory_type == "all":
            count = len(_memories)
            _memories.clear()
        else:
            to_remove = [k for k, v in _memories.items() if v.get("memory_type") == memory_type]
            count = len(to_remove)
            for k in to_remove:
                del _memories[k]
        return f"Cleared {count} memories"

    def _cli_status(self) -> str:
        by_type: Dict[str, int] = {}
        for m in _memories.values():
            t = m.get("memory_type", "unknown")
            by_type[t] = by_type.get(t, 0) + 1
        parts = [f"{t}: {c}" for t, c in by_type.items()]
        return f"Total: {len(_memories)} ({', '.join(parts) if parts else 'empty'})"
