"""Chat attachments feature — file upload for agent context (Gap 6).

Protocol-driven: attachments are sent as base64 or multipart.
Config-driven: max size, allowed types are configurable.
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
import uuid
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────

DEFAULT_MAX_SIZE_MB = 10
DEFAULT_ALLOWED_TYPES = [
    "text/plain", "text/csv", "text/markdown",
    "application/json", "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
]


# ── Protocol ─────────────────────────────────────────────────────

class AttachmentProtocol:
    """Protocol interface for attachment handling."""

    def upload(self, data: bytes, filename: str, content_type: str) -> Dict[str, Any]:
        ...

    def get(self, attachment_id: str) -> Optional[Dict[str, Any]]:
        ...

    def delete(self, attachment_id: str) -> bool:
        ...

    def list_for_session(self, session_id: str) -> List[Dict[str, Any]]:
        ...


# ── Implementation ───────────────────────────────────────────────

class AttachmentManager(AttachmentProtocol):
    """Default attachment manager — stores files in temp directory."""

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        max_size_mb: int = DEFAULT_MAX_SIZE_MB,
        allowed_types: Optional[List[str]] = None,
    ) -> None:
        self._storage_dir = storage_dir or os.path.join(tempfile.gettempdir(), "praisonai_attachments")
        os.makedirs(self._storage_dir, exist_ok=True)
        self._max_size = max_size_mb * 1024 * 1024
        self._allowed_types = allowed_types or DEFAULT_ALLOWED_TYPES
        self._registry: Dict[str, Dict[str, Any]] = {}

    def upload(
        self,
        data: bytes,
        filename: str,
        content_type: str,
        session_id: str = "",
    ) -> Dict[str, Any]:
        if len(data) > self._max_size:
            raise ValueError(f"File too large: {len(data)} > {self._max_size}")

        if content_type not in self._allowed_types:
            raise ValueError(f"Type not allowed: {content_type}")

        attachment_id = str(uuid.uuid4())
        ext = os.path.splitext(filename)[1] or ".bin"
        safe_name = attachment_id + ext
        path = os.path.join(self._storage_dir, safe_name)

        with open(path, "wb") as f:
            f.write(data)

        meta = {
            "id": attachment_id,
            "filename": filename,
            "content_type": content_type,
            "size": len(data),
            "path": path,
            "session_id": session_id,
        }
        self._registry[attachment_id] = meta
        return meta

    def get(self, attachment_id: str) -> Optional[Dict[str, Any]]:
        return self._registry.get(attachment_id)

    def delete(self, attachment_id: str) -> bool:
        meta = self._registry.pop(attachment_id, None)
        if meta:
            try:
                os.remove(meta["path"])
            except OSError:
                pass
            return True
        return False

    def list_for_session(self, session_id: str) -> List[Dict[str, Any]]:
        return [
            {k: v for k, v in m.items() if k != "path"}
            for m in self._registry.values()
            if m.get("session_id") == session_id
        ]


_attachment_manager: Optional[AttachmentManager] = None


def get_attachment_manager() -> AttachmentManager:
    global _attachment_manager
    if _attachment_manager is None:
        _attachment_manager = AttachmentManager()
    return _attachment_manager


# ── HTTP Handlers ────────────────────────────────────────────────

async def _upload_attachment(request: Request) -> JSONResponse:
    """POST /api/chat/attachments — upload a file."""
    try:
        form = await request.form()
        file = form.get("file")
        session_id = form.get("session_id", "")

        if not file:
            return JSONResponse({"error": "No file provided"}, status_code=400)

        data = await file.read()
        mgr = get_attachment_manager()
        meta = mgr.upload(
            data=data,
            filename=file.filename or "upload",
            content_type=file.content_type or "application/octet-stream",
            session_id=session_id,
        )
        return JSONResponse(meta)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def _list_attachments(request: Request) -> JSONResponse:
    """GET /api/chat/attachments/{session_id} — list attachments."""
    session_id = request.path_params["session_id"]
    mgr = get_attachment_manager()
    return JSONResponse({
        "attachments": mgr.list_for_session(session_id),
        "session_id": session_id,
    })


async def _delete_attachment(request: Request) -> JSONResponse:
    """DELETE /api/chat/attachments/{attachment_id} — delete an attachment."""
    attachment_id = request.path_params["attachment_id"]
    mgr = get_attachment_manager()
    if mgr.delete(attachment_id):
        return JSONResponse({"status": "deleted", "id": attachment_id})
    return JSONResponse({"error": "Not found"}, status_code=404)


# ── Feature ──────────────────────────────────────────────────────

class PraisonAIAttachments(BaseFeatureProtocol):
    """Chat attachments feature — file upload for agent context."""

    feature_name = "attachments"
    feature_description = "File upload and attachment management for chat"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/chat/attachments", _upload_attachment, methods=["POST"]),
            Route("/api/chat/attachments/{session_id}", _list_attachments, methods=["GET"]),
            Route("/api/chat/attachments/{attachment_id}", _delete_attachment, methods=["DELETE"]),
        ]
