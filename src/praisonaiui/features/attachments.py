"""Chat attachments feature — file upload for agent context (Gap 6).

Protocol-driven: attachments are sent as base64 or multipart.
Config-driven: max size, allowed types are configurable.
"""

from __future__ import annotations

import contextvars
import logging
import os
import tempfile
import time
import uuid
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────

DEFAULT_MAX_SIZE_MB = 10
DEFAULT_TTL_SECONDS = 3600
DEFAULT_MAX_ENTRIES = 500
DEFAULT_ALLOWED_TYPES = [
    "text/plain",
    "text/csv",
    "text/tab-separated-values",
    "text/markdown",
    "application/json",
    "application/pdf",
    "application/xml",
    "text/xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]


# ── Protocol ─────────────────────────────────────────────────────


class AttachmentProtocol:
    """Protocol interface for attachment handling."""

    def upload(self, data: bytes, filename: str, content_type: str) -> Dict[str, Any]: ...

    def get(self, attachment_id: str) -> Optional[Dict[str, Any]]: ...

    def delete(self, attachment_id: str) -> bool: ...

    def list_for_session(self, session_id: str) -> List[Dict[str, Any]]: ...


# ── Implementation ───────────────────────────────────────────────


class AttachmentManager(AttachmentProtocol):
    """Default attachment manager — stores files in temp directory."""

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        max_size_mb: int = DEFAULT_MAX_SIZE_MB,
        allowed_types: Optional[List[str]] = None,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
    ) -> None:
        self._storage_dir = storage_dir or os.path.join(
            tempfile.gettempdir(), "praisonai_attachments"
        )
        os.makedirs(self._storage_dir, exist_ok=True)
        self._max_size = max_size_mb * 1024 * 1024
        self._allowed_types = allowed_types or DEFAULT_ALLOWED_TYPES
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._registry: Dict[str, Dict[str, Any]] = {}
        self._created_at: Dict[str, float] = {}

    def _evict_expired(self, now: Optional[float] = None) -> int:
        """Remove expired or over-capacity entries and unlink their temp files."""
        t = time.monotonic() if now is None else now
        removed = 0
        if self._ttl_seconds > 0:
            expired = [
                aid for aid, ts in list(self._created_at.items()) if (t - ts) >= self._ttl_seconds
            ]
            for aid in expired:
                if self.delete(aid):
                    removed += 1
        if self._max_entries > 0 and len(self._registry) > self._max_entries:
            oldest = sorted(self._created_at.items(), key=lambda kv: kv[1])
            excess = len(self._registry) - self._max_entries
            for aid, _ in oldest[:excess]:
                if self.delete(aid):
                    removed += 1
        return removed

    def upload(
        self,
        data: bytes,
        filename: str,
        content_type: str,
        session_id: str = "",
    ) -> Dict[str, Any]:
        self._evict_expired()
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
        self._created_at[attachment_id] = time.monotonic()
        self._evict_expired()
        return meta

    def get(self, attachment_id: str) -> Optional[Dict[str, Any]]:
        self._evict_expired()
        return self._registry.get(attachment_id)

    def delete(self, attachment_id: str) -> bool:
        self._created_at.pop(attachment_id, None)
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


def get_uploaded_file(attachment_or_id: str | Mapping[str, Any] | None) -> Optional[Dict[str, Any]]:
    """Resolve an uploaded attachment ID (or handle dict from ``aiui.file_upload``) safely.

    Validates that the ID is a well-formed UUID (blocking path traversal or
    arbitrary filesystem paths) and looks it up in the server's attachment
    registry. Returns ``{id, filename, content_type, size, path, session_id}``
    or ``None`` if unknown or expired.
    """
    if attachment_or_id is None:
        return None
    raw_id = (
        attachment_or_id.get("id") if isinstance(attachment_or_id, Mapping) else attachment_or_id
    )
    if not isinstance(raw_id, str) or not raw_id:
        return None
    try:
        normalized = str(uuid.UUID(raw_id))
    except (ValueError, AttributeError):
        return None
    meta = get_attachment_manager().get(normalized)
    return dict(meta) if meta else None


#: The files of the message being answered, ``[{id, name, content_type,
#: path}]``. Set by the chat run (WebSocket and ``/run``) around the provider
#: call; ``@reply`` callbacks read it as ``message.attachments``.
current_attachments: "contextvars.ContextVar[Tuple[Dict[str, Any], ...]]" = (
    contextvars.ContextVar("aiui_current_attachments", default=())
)


def prepare_attachments(
    content: str, attachment_ids: Optional[Sequence[Any]]
) -> Tuple[str, List[str], List[Dict[str, Any]]]:
    """Load a chat message's attachments for a run.

    Returns ``(content, image_paths, files)``: text and PDF files are put
    before the message text, image paths go to the model's multimodal input,
    and *files* lists every attachment found as ``{id, name, content_type,
    path}``. Unknown ids are skipped.
    """
    image_paths: List[str] = []
    files: List[Dict[str, Any]] = []
    if not attachment_ids:
        return content, image_paths, files
    try:
        att_mgr = get_attachment_manager()
        context_parts: List[str] = []
        for att_id in attachment_ids:
            meta = att_mgr.get(att_id) if isinstance(att_id, str) else None
            if not meta:
                continue
            path = meta.get("path", "")
            ct = meta.get("content_type", "")
            fname = meta.get("filename", "file")
            files.append({"id": att_id, "name": fname, "content_type": ct, "path": path})

            if ct.startswith("image/"):
                # Images → the model's native multimodal handling
                image_paths.append(path)
            elif ct == "application/pdf":
                # PDFs → extract text and prepend to message
                try:
                    try:
                        from pypdf import PdfReader
                    except ImportError:
                        from PyPDF2 import PdfReader
                    reader = PdfReader(path)
                    text = "\n".join(page.extract_text() or "" for page in reader.pages)
                    context_parts.append(
                        f"--- Attached PDF: {fname} ---\n{text}\n--- End of {fname} ---"
                    )
                except ImportError:
                    context_parts.append(
                        f"[PDF file: {fname}, {os.path.getsize(path)} bytes "
                        f"— install pypdf for text extraction]"
                    )
                except Exception as e:
                    context_parts.append(f"[Error reading {fname}: {e}]")
            else:
                # Other text-based files → read and prepend
                try:
                    with open(path, "r", errors="replace") as f:
                        text = f.read()
                    context_parts.append(
                        f"--- Attached File: {fname} ---\n{text}\n--- End of {fname} ---"
                    )
                except Exception as e:
                    context_parts.append(f"[Error reading {fname}: {e}]")

        if context_parts:
            content = "\n\n".join(context_parts) + "\n\nUser message: " + content
    except Exception as e:
        logger.warning(f"Failed to load attachments: {e}")
    return content, image_paths, files


# ── HTTP Handlers ────────────────────────────────────────────────


async def _upload_attachment(request: Request) -> JSONResponse:
    """POST /api/chat/attachments — upload a file.

    Accepts three encodings so uploads work with or without ``python-multipart``:
      1. Raw binary body with ``X-Filename`` header and file ``Content-Type``.
      2. JSON body ``{filename, content_type, data_base64, session_id?}``.
      3. ``multipart/form-data`` with ``file`` field (requires ``python-multipart``).
    """
    try:
        mgr = get_attachment_manager()
        req_ct = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        session_id = ""
        index_to_knowledge = False

        if request.headers.get("x-filename"):
            from urllib.parse import unquote

            cl = request.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > mgr._max_size:
                return JSONResponse(
                    {"error": f"File too large: {int(cl)} > {mgr._max_size}"}, status_code=413
                )
            raw_fname = unquote(request.headers["x-filename"])
            filename = os.path.basename(raw_fname) or "upload"
            content_type = req_ct or "application/octet-stream"
            session_id = request.headers.get("x-session-id", "")
            index_to_knowledge = request.headers.get("x-index-to-knowledge", "").lower() in (
                "true",
                "1",
                "yes",
            )
            data = await request.body()
        elif req_ct == "application/json":
            import base64

            payload = await request.json()
            if not isinstance(payload, dict) or not payload.get("data_base64"):
                return JSONResponse({"error": "No file provided"}, status_code=400)
            filename = os.path.basename(str(payload.get("filename") or "upload")) or "upload"
            content_type = str(payload.get("content_type") or "application/octet-stream")
            session_id = str(payload.get("session_id") or "")
            index_to_knowledge = str(payload.get("index_to_knowledge", "")).lower() in (
                "true",
                "1",
                "yes",
            )
            try:
                data = base64.b64decode(str(payload["data_base64"]), validate=True)
            except Exception:
                return JSONResponse({"error": "Invalid base64 payload"}, status_code=400)
        else:
            form = await request.form()
            file = form.get("file")
            session_id = form.get("session_id", "")
            index_to_knowledge = str(form.get("index_to_knowledge", "")).lower() in (
                "true",
                "1",
                "yes",
            )
            if not file:
                return JSONResponse({"error": "No file provided"}, status_code=400)
            # The form parser spooled the file to disk; check its size before
            # reading it into memory.
            size = getattr(file, "size", None)
            if size is not None and size > mgr._max_size:
                return JSONResponse(
                    {"error": f"File too large: {size} > {mgr._max_size}"}, status_code=413
                )
            filename = os.path.basename(file.filename or "upload") or "upload"
            content_type = file.content_type or "application/octet-stream"
            data = await file.read()

        if len(data) > mgr._max_size:
            return JSONResponse(
                {"error": f"File too large: {len(data)} > {mgr._max_size}"}, status_code=413
            )
        meta = mgr.upload(
            data=data,
            filename=filename,
            content_type=content_type,
            session_id=session_id,
        )

        # Index into knowledge base if requested
        if index_to_knowledge:
            try:
                from .knowledge import get_knowledge_manager

                k_mgr = get_knowledge_manager()

                # Try SDK file ingest first (handles PDF/DOCX chunking)
                if hasattr(k_mgr, "add_file"):
                    result = k_mgr.add_file(
                        file_path=meta["path"],
                        user_id=None,
                        metadata={"filename": filename, "session_id": session_id},
                    )
                    if result.get("status") == "ok":
                        meta["knowledge_indexed"] = True
                        meta["knowledge_method"] = "file_ingest"
                    else:
                        # SDK file ingest failed — fall back to text storage
                        if content_type.startswith("text/") or content_type in (
                            "application/json",
                            "text/markdown",
                            "text/csv",
                        ):
                            text_content = data.decode("utf-8", errors="replace")
                            stored = k_mgr.store(
                                text=f"[File: {filename}]\n{text_content}",
                                metadata={
                                    "filename": filename,
                                    "session_id": session_id,
                                    "source": "upload",
                                },
                            )
                            meta["knowledge_indexed"] = True
                            meta["knowledge_method"] = "text_content"
                            if stored.get("warning"):
                                meta["knowledge_warning"] = stored["warning"]
                        else:
                            meta["knowledge_indexed"] = False
                            meta["knowledge_error"] = result.get(
                                "error", "SDK not available for binary files"
                            )
                else:
                    # Simple manager — store text content only
                    if content_type.startswith("text/"):
                        text_content = data.decode("utf-8", errors="replace")
                        k_mgr.store(
                            text=f"[File: {filename}]\n{text_content}",
                            metadata={
                                "filename": filename,
                                "session_id": session_id,
                                "source": "upload",
                            },
                        )
                        meta["knowledge_indexed"] = True
                    else:
                        meta["knowledge_indexed"] = False
                        meta["knowledge_error"] = (
                            "Text-only storage available; install SDK for PDF/binary support"
                        )
            except Exception as e:
                logger.warning("Knowledge indexing failed for %s: %s", filename, e)
                meta["knowledge_indexed"] = False
                meta["knowledge_error"] = str(e)

        return JSONResponse(meta)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def _list_attachments(request: Request) -> JSONResponse:
    """GET /api/chat/attachments/{session_id} — list attachments."""
    session_id = request.path_params["session_id"]
    mgr = get_attachment_manager()
    return JSONResponse(
        {
            "attachments": mgr.list_for_session(session_id),
            "session_id": session_id,
        }
    )


async def _delete_attachment(request: Request) -> JSONResponse:
    """DELETE /api/chat/attachments/{attachment_id} — delete an attachment."""
    attachment_id = request.path_params["attachment_id"]
    mgr = get_attachment_manager()
    if mgr.delete(attachment_id):
        return JSONResponse({"status": "deleted", "id": attachment_id})
    return JSONResponse({"error": "Not found"}, status_code=404)


async def _serve_media(request: Request) -> FileResponse | JSONResponse:
    """GET /api/chat/media/{attachment_id} — serve a stored generated-media file."""
    attachment_id = request.path_params["attachment_id"]
    mgr = get_attachment_manager()
    meta = mgr.get(attachment_id)
    if not meta or not meta.get("path"):
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(
        meta["path"],
        media_type=meta.get("content_type", "application/octet-stream"),
        filename=meta.get("filename"),
    )


# ── Feature ──────────────────────────────────────────────────────


class AttachmentsFeature(BaseFeatureProtocol):
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
            Route("/api/chat/media/{attachment_id}", _serve_media, methods=["GET"]),
        ]


# Backward-compat alias
PraisonAIAttachments = AttachmentsFeature
