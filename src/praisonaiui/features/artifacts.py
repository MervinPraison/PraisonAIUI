"""Artifacts store: the index of what chats produced, and user-edited versions.

The browser derives artifacts from the chat (fenced code, tables, file and
media elements, A2UI surfaces: ``layout-features/artifacts/derive.ts`` holds
the rules, so they are not duplicated here). This feature only stores what
the client sends: the per-session index (so the nav can count artifacts
across sessions) and the versions a user edited.

Owned by the ``builtin.artifacts`` record, which mounts only while the
chat-canvas layout is available or the record is listed in
``extensions.enabled`` (ADR 0003). Routes::

    GET    /api/artifacts?session_id=&limit=        latest version of every key (no content)
    GET    /api/artifacts/{session_id}              every version, with content
    PUT    /api/artifacts/{session_id}/{key}        upsert a derived version, or add an edit
    DELETE /api/artifacts/{session_id}/{key}[?version=N]
    DELETE /api/artifacts/{session_id}

The shape is ``Artifact`` in ``src/frontend/src/sdk/layoutTypes.ts``. A PUT
whose body has ``edited: true`` or no ``version`` adds a new version (the
next number); one with a ``version`` replaces that version, unless the user
edited it (409). Stored as JSON, one file per session, under
``<data dir>/artifacts/``; a session id never becomes a path (the file name
is its hash).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

KINDS = ("code", "table", "markdown", "file", "image", "pdf", "video", "a2ui")
#: Text content per version.
MAX_CONTENT = 512 * 1024
MAX_VERSIONS_PER_KEY = 50
MAX_KEYS_PER_SESSION = 500
MAX_KEY = 300
MAX_SESSION_ID = 200
MAX_TITLE = 300
_TEXT_LIMITS = {"messageId": 200, "language": 64, "mimeType": 128, "url": 4096}
_INDEX_FIELDS = (
    "key", "kind", "title", "version", "sessionId", "messageId", "language",
    "url", "mimeType", "updatedAt", "edited",
)  # fmt: skip


def artifacts_dir() -> Path:
    """``<data dir>/artifacts`` (resolved per call, so it follows the environment)."""
    from ._paths import aiui_default_data_dir, feature_data_path

    return feature_data_path("artifacts", aiui_default_data_dir() / "artifacts")


#: Leading and trailing characters a browser strips from a URL (C0 controls and space).
_URL_TRIM = "".join(chr(c) for c in range(0x21))
_URL_DROPPED = re.compile(r"[\t\n\r]")
_URL_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_URL_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):")
_URL_SCHEMES = ("http", "https", "blob")


def _safe_url(url: str) -> str:
    """*url* as a browser reads it, when it may go in an ``href`` or ``src``.

    The WHATWG URL parser drops every tab, CR and LF and strips leading and
    trailing C0 controls and spaces, so ``"java\\nscript:"`` and
    ``"\\x01javascript:"`` are ``javascript:`` once rendered. The URL is
    normalised the same way first, then checked against an allowlist: a
    relative or same-origin path (no scheme), ``http:``, ``https:``,
    ``blob:``, and ``data:image/`` (the policy of ``markdown/urlPolicy.ts``).
    The normalised form is what gets stored.
    """
    s = _URL_DROPPED.sub("", url).strip(_URL_TRIM)
    if _URL_CONTROL.search(s):
        raise ArtifactError("url must not contain control characters")
    m = _URL_SCHEME.match(s)
    if m is None:
        return s
    scheme = m.group(1).lower()
    if scheme in _URL_SCHEMES or s.lower().startswith("data:image/"):
        return s
    raise ArtifactError("url scheme not allowed: use a path, http(s), blob or data:image/")


def _session_file(session_id: str) -> Path:
    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:32]
    return artifacts_dir() / f"{digest}.json"


class ArtifactError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _clean(session_id: str, key: str, body: Any) -> Dict[str, Any]:
    """The stored form of a PUT body, or :class:`ArtifactError`."""
    if not isinstance(body, dict):
        raise ArtifactError("body must be a JSON object")
    kind = body.get("kind")
    if kind not in KINDS:
        raise ArtifactError(f"kind must be one of {', '.join(KINDS)}")
    out: Dict[str, Any] = {"key": key, "kind": kind, "sessionId": session_id}
    title = body.get("title")
    if title is not None and (not isinstance(title, str) or len(title) > MAX_TITLE):
        raise ArtifactError(f"title must be a string of at most {MAX_TITLE} characters")
    out["title"] = title.strip() if title and title.strip() else key
    for name, limit in _TEXT_LIMITS.items():
        value = body.get(name)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > limit:
            raise ArtifactError(f"{name} must be a string of at most {limit} characters")
        out[name] = value
    out.setdefault("messageId", "")
    if "url" in out:
        out["url"] = _safe_url(out["url"])
    content = body.get("content")
    if content is not None:
        if not isinstance(content, str):
            raise ArtifactError("content must be a string")
        if len(content.encode("utf-8")) > MAX_CONTENT:
            raise ArtifactError(f"content is larger than {MAX_CONTENT} bytes", 413)
        out["content"] = content
    version = body.get("version")
    if version is not None and (
        isinstance(version, bool) or not isinstance(version, int) or version < 1
    ):
        raise ArtifactError("version must be a positive integer")
    out["version"] = version
    out["edited"] = body.get("edited") is True
    return out


class ArtifactStore:
    """Per-session JSON files; every write is atomic (temp file + rename)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # path -> (mtime_ns, data): the cross-session index re-reads only what changed.
        self._cache: Dict[Path, Tuple[int, Dict[str, Any]]] = {}

    def _read(self, path: Path) -> Dict[str, Any]:
        try:
            mtime = path.stat().st_mtime_ns
        except FileNotFoundError:
            return {"sessionId": None, "artifacts": []}
        cached = self._cache.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("Artifacts: could not read %s: %s", path.name, exc)
            data = {}
        if not isinstance(data, dict) or not isinstance(data.get("artifacts"), list):
            data = {"sessionId": None, "artifacts": []}
        self._cache[path] = (mtime, data)
        return data

    def _write(self, path: Path, data: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        self._cache.pop(path, None)

    # ── reads ────────────────────────────────────────────────────────

    def session(self, session_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._read(_session_file(session_id))["artifacts"])

    def index(self, session_id: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
        """The latest version of every key, newest first, without content."""
        with self._lock:
            if session_id is not None:
                files = [_session_file(session_id)]
            else:
                try:
                    files = sorted(artifacts_dir().glob("*.json"))
                except OSError:
                    files = []
            latest: Dict[Tuple[str, str], Dict[str, Any]] = {}
            sessions = set()
            for path in files:
                for a in self._read(path)["artifacts"]:
                    if not isinstance(a, dict) or "key" not in a:
                        continue
                    sid = str(a.get("sessionId"))
                    sessions.add(sid)
                    k = (sid, a["key"])
                    if k not in latest or a.get("version", 0) > latest[k].get("version", 0):
                        latest[k] = a
        rows = sorted(latest.values(), key=lambda a: a.get("updatedAt") or 0, reverse=True)
        return {
            "artifacts": [{f: a[f] for f in _INDEX_FIELDS if f in a} for a in rows[:limit]],
            "count": len(rows),
            "sessions": len(sessions),
        }

    # ── writes ───────────────────────────────────────────────────────

    def put(self, session_id: str, key: str, body: Any) -> Dict[str, Any]:
        item = _clean(session_id, key, body)
        item["updatedAt"] = int(time.time() * 1000)
        with self._lock:
            path = _session_file(session_id)
            data = self._read(path)
            items = [a for a in data["artifacts"] if isinstance(a, dict)]
            mine = [a for a in items if a.get("key") == key]
            if not mine and len({a.get("key") for a in items}) >= MAX_KEYS_PER_SESSION:
                raise ArtifactError("too many artifacts in this session", 409)
            version = item["version"]
            if version is None or item["edited"]:
                item["version"] = max((a.get("version", 0) for a in mine), default=0) + 1
                if not item["edited"]:
                    item.pop("edited")
            else:
                same = next((a for a in mine if a.get("version") == version), None)
                if same is not None and same.get("edited"):
                    raise ArtifactError("that version was edited by the user", 409)
                items = [a for a in items if a is not same]
                item.pop("edited")
            items.append(item)
            items = _cap_versions(items, key)
            first: Dict[Any, int] = {}
            for i, a in enumerate(items):
                first.setdefault(a.get("key"), i)
            items.sort(key=lambda a: (first[a.get("key")], a.get("version", 0)))
            self._write(path, {"sessionId": session_id, "artifacts": items})
        return item

    def delete(self, session_id: str, key: Optional[str] = None, version: Optional[int] = None) -> int:
        with self._lock:
            path = _session_file(session_id)
            items = list(self._read(path)["artifacts"])
            if key is None:
                gone = len(items)
                keep: List[Dict[str, Any]] = []
            else:
                keep = [
                    a
                    for a in items
                    if a.get("key") != key or (version is not None and a.get("version") != version)
                ]
                gone = len(items) - len(keep)
            if not gone:
                return 0
            if keep:
                self._write(path, {"sessionId": session_id, "artifacts": keep})
            else:
                path.unlink(missing_ok=True)
                self._cache.pop(path, None)
            return gone


def _cap_versions(items: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    """Drop the oldest versions of *key* past the cap (edited ones last)."""
    mine = [a for a in items if a.get("key") == key]
    if len(mine) <= MAX_VERSIONS_PER_KEY:
        return items
    order = sorted(mine, key=lambda a: (bool(a.get("edited")), a.get("version", 0)))
    drop = {id(a) for a in order[: len(mine) - MAX_VERSIONS_PER_KEY]}
    return [a for a in items if id(a) not in drop]


_store: Optional[ArtifactStore] = None


def get_artifact_store() -> ArtifactStore:
    global _store
    if _store is None:
        _store = ArtifactStore()
    return _store


def forget_session_artifacts(session_id: str) -> int:
    """Delete a session's artifacts when the session is deleted.

    Called by ``DELETE /sessions/{id}`` (the chat, the Sessions page and
    ``aiui sessions delete``), so a deleted chat leaves no content behind.
    Returns how many artifacts went; never raises.
    """
    try:
        return get_artifact_store().delete(session_id)
    except Exception:
        logger.warning("could not delete the artifacts of session %s", session_id, exc_info=True)
        return 0


# ── feature ──────────────────────────────────────────────────────────


def _ids(request: Request) -> Tuple[str, Optional[str]]:
    sid = request.path_params["session_id"]
    key = request.path_params.get("key")
    if not sid or len(sid) > MAX_SESSION_ID:
        raise ArtifactError("bad session id")
    if key is not None and (not key or len(key) > MAX_KEY):
        raise ArtifactError("bad artifact key")
    return sid, key


def _error(exc: ArtifactError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=exc.status)


class ArtifactsFeature(BaseFeatureProtocol):
    """The artifacts index and user-edited versions (chat-canvas layout)."""

    feature_name = "artifacts"
    feature_description = "Chat artifacts index and user-edited versions"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/artifacts", self._index, methods=["GET"]),
            Route("/api/artifacts/{session_id}", self._session, methods=["GET", "DELETE"]),
            Route("/api/artifacts/{session_id}/{key:path}", self._item, methods=["PUT", "DELETE"]),
        ]

    async def _index(self, request: Request) -> JSONResponse:
        sid = request.query_params.get("session_id") or None
        try:
            limit = max(1, min(1000, int(request.query_params.get("limit", 100))))
        except ValueError:
            limit = 100
        if sid is not None and len(sid) > MAX_SESSION_ID:
            return _error(ArtifactError("bad session id"))
        return JSONResponse(await asyncio.to_thread(get_artifact_store().index, sid, limit))

    async def _session(self, request: Request) -> JSONResponse:
        try:
            sid, _ = _ids(request)
        except ArtifactError as exc:
            return _error(exc)
        store = get_artifact_store()
        if request.method == "DELETE":
            return JSONResponse({"deleted": await asyncio.to_thread(store.delete, sid)})
        return JSONResponse({"sessionId": sid, "artifacts": await asyncio.to_thread(store.session, sid)})

    async def _item(self, request: Request) -> JSONResponse:
        try:
            sid, key = _ids(request)
            store = get_artifact_store()
            if request.method == "PUT":
                try:
                    body = await request.json()
                except ValueError:
                    raise ArtifactError("body must be JSON") from None
                item = await asyncio.to_thread(store.put, sid, key, body)
                return JSONResponse({"artifact": item})
            raw = request.query_params.get("version")
            try:
                version = int(raw) if raw is not None else None
            except ValueError:
                raise ArtifactError("version must be an integer") from None
            gone = await asyncio.to_thread(store.delete, sid, key, version)
            if not gone:
                return JSONResponse({"error": "artifact not found"}, status_code=404)
            return JSONResponse({"deleted": gone})
        except ArtifactError as exc:
            return _error(exc)
