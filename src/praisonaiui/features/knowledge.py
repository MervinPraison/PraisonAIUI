"""Knowledge feature — protocol-driven knowledge/RAG with swappable backends.

Architecture:
    KnowledgeProtocol (ABC)          <- any backend implements this
      ├── SimpleKnowledgeManager     <- default in-memory (no deps)
      └── SDKKnowledgeManager        <- wraps praisonaiagents.knowledge.Knowledge

    get_knowledge_manager()          <- factory, SDK-first with fallback

    PraisonAIKnowledge               <- BaseFeatureProtocol, wires routes + health
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


# ── Knowledge Protocol ───────────────────────────────────────────────


class KnowledgeProtocol(ABC):
    """Protocol interface for knowledge backends.

    Any knowledge implementation (simple, SDK, custom) implements this.
    PraisonAIKnowledge delegates all operations to the active protocol.
    """

    @abstractmethod
    def store(
        self,
        text: str,
        *,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Store a knowledge entry. Returns the stored entry dict."""
        ...

    @abstractmethod
    def search(
        self,
        query: str,
        *,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search knowledge. Returns list of matching entries."""
        ...

    @abstractmethod
    def add_file(
        self,
        file_path: str,
        *,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Ingest a file into the knowledge base. Returns result dict."""
        ...

    @abstractmethod
    def list_all(self) -> List[Dict[str, Any]]:
        """List all knowledge entries."""
        ...

    def get(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """Get a single entry by ID."""
        return None

    def delete(self, entry_id: str) -> bool:
        """Delete an entry by ID. Returns True if found and deleted."""
        return False

    def clear(self) -> int:
        """Clear all entries. Returns count of cleared entries."""
        return 0

    def get_stats(self) -> Dict[str, Any]:
        """Get corpus statistics."""
        return {"total": 0}

    def health(self) -> Dict[str, Any]:
        """Health check for this backend."""
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Knowledge Manager (Default, no deps) ─────────────────────


class SimpleKnowledgeManager(KnowledgeProtocol):
    """In-memory implementation — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._entries: Dict[str, Dict[str, Any]] = {}

    def store(
        self,
        text: str,
        *,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        entry_id = uuid.uuid4().hex[:12]
        entry = {
            "id": entry_id,
            "text": text,
            "user_id": user_id,
            "agent_id": agent_id,
            "metadata": metadata or {},
            "created_at": time.time(),
        }
        self._entries[entry_id] = entry
        return entry

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        query_lower = query.lower()
        results = []
        for e in self._entries.values():
            if query_lower in e.get("text", "").lower():
                results.append(e)
            if len(results) >= limit:
                break
        return results

    def add_file(
        self,
        file_path: str,
        *,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {"error": "File ingest requires SDK (pip install 'praisonaiagents[knowledge]')"}

    def list_all(self) -> List[Dict[str, Any]]:
        return list(self._entries.values())

    def get(self, entry_id: str) -> Optional[Dict[str, Any]]:
        return self._entries.get(entry_id)

    def delete(self, entry_id: str) -> bool:
        return self._entries.pop(entry_id, None) is not None

    def clear(self) -> int:
        count = len(self._entries)
        self._entries.clear()
        return count

    def get_stats(self) -> Dict[str, Any]:
        return {"total": len(self._entries), "backend": "in-memory"}

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleKnowledgeManager",
            "total_entries": len(self._entries),
        }


# ── SDK Knowledge Manager (wraps praisonaiagents.knowledge) ──────────


class SDKKnowledgeManager(KnowledgeProtocol):
    """Wraps praisonaiagents.knowledge.Knowledge for production use.

    Features: ChromaDB vector search, mem0, file ingest (PDF/DOCX/TXT),
    corpus stats, chunking, reranking.

    Falls back to local index when SDK init fails.
    """

    def __init__(self, **config: Any) -> None:
        self._config = config
        self._sdk_knowledge = None
        self._sdk_probed = False  # True once we've verified SDK actually works
        self._local_index: Dict[str, Dict[str, Any]] = {}

    def _get_sdk_knowledge(self) -> Any:
        """Lazy-init SDK Knowledge with health probe.

        Knowledge() init always succeeds even without backend packages,
        but operations fail.  We probe once after init to detect this
        early and fall back cleanly instead of logging repeated errors.
        """
        if self._sdk_probed:
            return self._sdk_knowledge  # already verified (may be None)

        if self._sdk_knowledge is None:
            try:
                from praisonaiagents.knowledge import Knowledge
                # Use fixed collection name + persist path so data survives restarts.
                # Without this, Knowledge() generates a random collection name each time.
                knowledge_config = {
                    "vector_store": {
                        "provider": "chroma",
                        "config": {
                            "collection_name": "praisonaiui_knowledge",
                            "path": ".praisonai",
                        },
                    },
                }
                if self._config:
                    knowledge_config.update(self._config)
                self._sdk_knowledge = Knowledge(config=knowledge_config)
                logger.info("SDK Knowledge initialized: %s", type(self._sdk_knowledge).__name__)
            except ImportError:
                logger.info("praisonaiagents not installed; using local knowledge index")
                self._sdk_probed = True
                return None
            except BaseException as e:
                logger.info("SDK Knowledge init failed: %s; using local index", e)
                self._sdk_probed = True
                return None

            # Probe: verify backend packages are actually available
            try:
                self._sdk_knowledge.search("__probe__", limit=1)
            except BaseException as e:
                err_msg = str(e)
                if "not installed" in err_msg or "Required packages" in err_msg:
                    logger.info(
                        "SDK Knowledge backend packages not installed "
                        "(pip install 'praisonaiagents[knowledge]'); "
                        "using local in-memory index"
                    )
                    self._sdk_knowledge = None
                else:
                    # Other errors (e.g. empty DB) are fine — SDK works
                    pass

        self._sdk_probed = True
        return self._sdk_knowledge

    def store(
        self,
        text: str,
        *,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        entry_id = uuid.uuid4().hex[:12]
        entry = {
            "id": entry_id,
            "text": text,
            "user_id": user_id,
            "agent_id": agent_id,
            "metadata": metadata or {},
            "created_at": time.time(),
        }

        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                sdk.store(text, user_id=user_id or "praisonaiui", agent_id=agent_id, metadata=metadata or {})
                entry["sdk_synced"] = True
            except Exception as e:
                logger.warning("SDK knowledge store failed: %s", e)

        self._local_index[entry_id] = entry
        return entry

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                results = sdk.search(query, limit=limit, user_id="praisonaiui")
                if isinstance(results, list) and results:
                    return [
                        {
                            "id": str(r.get("id", i)),
                            "text": r.get("memory", r.get("text", str(r))),
                            "metadata": r.get("metadata", {}),
                            "score": r.get("score", 1.0),
                        }
                        for i, r in enumerate(results[:limit])
                    ]
            except BaseException as e:
                logger.warning("SDK knowledge search failed: %s; falling back to local", e)

        # Fallback to local text search
        query_lower = query.lower()
        results = []
        for e in self._local_index.values():
            if query_lower in e.get("text", "").lower():
                results.append(e)
            if len(results) >= limit:
                break
        return results

    def add_file(
        self,
        file_path: str,
        *,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                result = sdk.add(file_path, user_id=user_id or "praisonaiui", metadata=metadata or {})
                # Parse SDK result and store entries in local index so they appear in listings
                sdk_results = []
                if isinstance(result, dict):
                    sdk_results = result.get("results", [])
                elif isinstance(result, list):
                    sdk_results = result
                import os, time, hashlib
                for r in sdk_results:
                    if isinstance(r, dict) and r.get("event") == "ADD":
                        entry_id = r.get("id", hashlib.md5(str(r).encode()).hexdigest()[:12])
                        text = r.get("memory", r.get("text", ""))
                        file_meta = dict(metadata or {})
                        file_meta["source"] = "file_ingest"
                        file_meta["filename"] = os.path.basename(file_path)
                        self._local_index[entry_id] = {
                            "id": entry_id,
                            "text": text,
                            "metadata": file_meta,
                            "created_at": time.time(),
                            "sdk_synced": True,
                        }
                return {"status": "ok", "file": file_path, "result": str(result)}
            except Exception as e:
                return {"status": "error", "file": file_path, "error": str(e)}
        return {"status": "error", "error": "SDK not available; install praisonaiagents[knowledge]"}

    def list_all(self) -> List[Dict[str, Any]]:
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                all_items = sdk.get_all(user_id="praisonaiui")
                # Handle dict response format: {'results': [...]}
                if isinstance(all_items, dict):
                    all_items = all_items.get("results", [])
                if isinstance(all_items, list) and all_items:
                    sdk_entries = [
                        {
                            "id": str(r.get("id", i)),
                            "text": r.get("memory", r.get("text", str(r))),
                            "metadata": r.get("metadata", {}),
                        }
                        for i, r in enumerate(all_items)
                    ]
                    # Merge with local index (local entries may have more metadata)
                    seen_ids = {e["id"] for e in sdk_entries}
                    for entry in self._local_index.values():
                        if entry["id"] not in seen_ids:
                            sdk_entries.append(entry)
                    return sdk_entries
            except BaseException as e:
                logger.warning("SDK get_all failed: %s; using local index", e)
        return list(self._local_index.values())

    def get(self, entry_id: str) -> Optional[Dict[str, Any]]:
        # Try local first (fastest)
        local = self._local_index.get(entry_id)
        if local:
            return local
        # Try SDK
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                result = sdk.get(entry_id)
                if result:
                    return {"id": entry_id, "text": str(result), "metadata": {}}
            except Exception:
                pass
        return None

    def delete(self, entry_id: str) -> bool:
        deleted = self._local_index.pop(entry_id, None) is not None
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                sdk.delete(entry_id)
                deleted = True
            except Exception:
                pass
        return deleted

    def clear(self) -> int:
        count = len(self._local_index)
        self._local_index.clear()
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                sdk.reset()
            except Exception:
                pass
        return count

    def get_stats(self) -> Dict[str, Any]:
        sdk = self._get_sdk_knowledge()
        if sdk is not None:
            try:
                stats = sdk.get_corpus_stats()
                if stats and getattr(stats, "chunk_count", 0) > 0:
                    return {
                        "total": getattr(stats, "chunk_count", 0),
                        "files": getattr(stats, "file_count", 0),
                        "backend": "SDK",
                    }
            except Exception:
                pass
            # Fallback: count entries directly
            try:
                entries = self.list_all()
                file_entries = [e for e in entries if (e.get("metadata") or {}).get("filename")]
                return {
                    "total": len(entries),
                    "files": len(set(e.get("metadata", {}).get("filename", "") for e in file_entries)),
                    "backend": "SDK",
                }
            except Exception:
                pass
        return {"total": len(self._local_index), "backend": "local"}

    def health(self) -> Dict[str, Any]:
        sdk = self._get_sdk_knowledge()
        return {
            "status": "ok" if sdk is not None else "degraded",
            "provider": "SDKKnowledgeManager",
            "sdk_available": sdk is not None,
            "total_indexed": len(self._local_index),
        }


# ── Factory ──────────────────────────────────────────────────────────

_knowledge_manager: Optional[KnowledgeProtocol] = None


def get_knowledge_manager() -> KnowledgeProtocol:
    """Get the active knowledge manager (SDK-first, fallback to Simple)."""
    global _knowledge_manager
    if _knowledge_manager is None:
        try:
            _knowledge_manager = SDKKnowledgeManager()
            logger.info("Using SDKKnowledgeManager for knowledge operations")
        except Exception as e:
            logger.debug("SDKKnowledgeManager init failed (%s), using SimpleKnowledgeManager", e)
            _knowledge_manager = SimpleKnowledgeManager()
    return _knowledge_manager


# ── Feature Class (wires routes + health) ────────────────────────────


class KnowledgeFeature(BaseFeatureProtocol):
    """Knowledge management feature — store, search, and retrieve knowledge."""

    feature_name = "knowledge"
    feature_description = "Knowledge base with RAG (store, search, file ingest)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/knowledge", self._list, methods=["GET"]),
            Route("/api/knowledge", self._add, methods=["POST"]),
            Route("/api/knowledge/search", self._search, methods=["POST"]),
            Route("/api/knowledge/add-file", self._add_file, methods=["POST"]),
            Route("/api/knowledge/status", self._status, methods=["GET"]),
            Route("/api/knowledge", self._clear, methods=["DELETE"]),
            Route("/api/knowledge/{entry_id}", self._get, methods=["GET"]),
            Route("/api/knowledge/{entry_id}", self._delete, methods=["DELETE"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "knowledge",
            "help": "Manage knowledge base",
            "commands": {
                "list": {"help": "List all knowledge entries", "handler": self._cli_list},
                "add": {"help": "Add a knowledge entry", "handler": self._cli_add},
                "search": {"help": "Search knowledge base", "handler": self._cli_search},
                "remove": {"help": "Remove a knowledge entry", "handler": self._cli_remove},
                "status": {"help": "Show knowledge base status", "handler": self._cli_status},
            },
        }]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        mgr = get_knowledge_manager()
        items = mgr.list_all()
        if not items:
            return "No knowledge entries"
        lines = []
        for e in items:
            eid = e.get("id", "?")
            text = (e.get("text", "") or "")[:60]
            meta = e.get("metadata", {})
            source = meta.get("filename") or meta.get("source", "")
            source_str = f" [{source}]" if source else ""
            lines.append(f"  {eid}{source_str} — {text}")
        return f"{len(items)} entries:\n" + "\n".join(lines)

    def _cli_add(self, text: str, agent_id: str = "", user_id: str = "") -> str:
        mgr = get_knowledge_manager()
        entry = mgr.store(
            text=text,
            user_id=user_id or None,
            agent_id=agent_id or None,
        )
        return f"Stored entry {entry.get('id', '?')}: {text[:60]}"

    def _cli_search(self, query: str, limit: int = 10) -> str:
        mgr = get_knowledge_manager()
        results = mgr.search(query=query, limit=limit)
        if not results:
            return f"No results for: {query}"
        lines = []
        for r in results:
            rid = r.get("id", "?")
            text = (r.get("text", "") or "")[:60]
            score = r.get("score", "")
            score_str = f" (score={score:.2f})" if isinstance(score, float) else ""
            lines.append(f"  {rid}{score_str} — {text}")
        return f"{len(results)} results:\n" + "\n".join(lines)

    def _cli_remove(self, entry_id: str) -> str:
        mgr = get_knowledge_manager()
        deleted = mgr.delete(entry_id)
        if not deleted:
            return f"Entry {entry_id} not found"
        return f"Removed entry {entry_id}"

    def _cli_status(self) -> str:
        mgr = get_knowledge_manager()
        stats = mgr.get_stats()
        h = mgr.health()
        lines = [
            f"Status: {h.get('status', 'ok')}",
            f"Backend: {h.get('provider', stats.get('backend', 'unknown'))}",
            f"Total entries: {stats.get('total', 0)}",
            f"Files ingested: {stats.get('files', 0)}",
        ]
        return "\n".join(lines)

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        mgr = get_knowledge_manager()
        h = mgr.health()
        h["feature"] = self.name
        h.update(gateway_health())
        return h

    # ── Route handlers ───────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """GET /api/knowledge — list all knowledge entries."""
        mgr = get_knowledge_manager()
        items = mgr.list_all()
        return JSONResponse({"entries": items, "count": len(items)})

    async def _add(self, request: Request) -> JSONResponse:
        """POST /api/knowledge — store text knowledge."""
        mgr = get_knowledge_manager()
        body = await request.json()
        text = body.get("text")
        if not text:
            return JSONResponse({"error": "text required"}, status_code=400)

        entry = mgr.store(
            text=text,
            user_id=body.get("user_id"),
            agent_id=body.get("agent_id"),
            metadata=body.get("metadata"),
        )
        return JSONResponse(entry)

    async def _search(self, request: Request) -> JSONResponse:
        """POST /api/knowledge/search — search knowledge base."""
        mgr = get_knowledge_manager()
        body = await request.json()
        query = body.get("query", "")
        if not query:
            return JSONResponse({"error": "query required"}, status_code=400)
        results = mgr.search(
            query=query,
            limit=body.get("limit", 10),
        )
        return JSONResponse({"results": results, "count": len(results)})

    async def _add_file(self, request: Request) -> JSONResponse:
        """POST /api/knowledge/add-file — ingest a file."""
        mgr = get_knowledge_manager()
        body = await request.json()
        file_path = body.get("file_path")
        if not file_path:
            return JSONResponse({"error": "file_path required"}, status_code=400)
        result = mgr.add_file(
            file_path=file_path,
            user_id=body.get("user_id"),
            metadata=body.get("metadata"),
        )
        return JSONResponse(result)

    async def _get(self, request: Request) -> JSONResponse:
        """GET /api/knowledge/{entry_id} — get single entry."""
        mgr = get_knowledge_manager()
        entry_id = request.path_params["entry_id"]
        entry = mgr.get(entry_id)
        if entry is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(entry)

    async def _delete(self, request: Request) -> JSONResponse:
        """DELETE /api/knowledge/{entry_id} — delete entry."""
        mgr = get_knowledge_manager()
        entry_id = request.path_params["entry_id"]
        deleted = mgr.delete(entry_id)
        return JSONResponse({"deleted": deleted, "id": entry_id})

    async def _clear(self, request: Request) -> JSONResponse:
        """DELETE /api/knowledge — clear all entries."""
        mgr = get_knowledge_manager()
        count = mgr.clear()
        return JSONResponse({"cleared": count})

    async def _status(self, request: Request) -> JSONResponse:
        """GET /api/knowledge/status — stats and health."""
        mgr = get_knowledge_manager()
        stats = mgr.get_stats()
        h = mgr.health()
        return JSONResponse({
            "total": stats.get("total", 0),
            "files": stats.get("files", 0),
            "backend": h.get("provider", "unknown"),
            "status": h.get("status", "ok"),
        })


# Backward-compat alias
PraisonAIKnowledge = KnowledgeFeature
