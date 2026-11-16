"""The canvas from Python: put artifacts beside the chat, by name.

App code, callbacks, providers and agent tools write the canvas explicitly
instead of hoping the model repeats a file name or a table header::

    import praisonaiui as aiui

    aiui.canvas.write("sorting", table_md, kind="table", title="Sorting algorithms")
    aiui.canvas.update("sorting", new_table_md)   # a new version, same kind and title
    aiui.canvas.open("sorting")                   # show it in the canvas
    aiui.canvas.read("sorting")                   # the latest version, user edits included
    aiui.canvas.artifacts()                       # every artifact of the chat (no content)

    Agent(..., tools=aiui.canvas.tools())         # canvas_write/update/read/list for an LLM

The functions are plain (not ``async``) and safe from any thread, so a tool
running in an agent's worker thread calls them as they are. They act on the
chat run in progress: the WS chat binds a :class:`Channel` around every
provider run (``features/chat.py``), and a provider's tasks, the reply
callback and the agent's tool threads inherit it (contextvars). Outside a
run, pass ``session_id=`` to read, or to store without showing.

Protocol. A write is one ``message_element`` frame whose element is::

    {"type": "artifact", "key": "sorting", "kind": "table", "title": "…",
     "content": "| … |", "language"?: "python", "url"?: "…", "mimeType"?: "…",
     "action": "upsert"}

and an open is ``{"type": "artifact", "key": "sorting", "action": "open"}``.
The browser's artifact rules (``layout-features/artifacts/derive.ts``) take
``key`` as the artifact's identity: the same key again with other content is
the next version, authored by the agent of that reply, and the canvas shows
it. The element is saved with the reply (history reloads give the same
versions). While the artifacts feature (``builtin.artifacts``) is on, a write
is also stored server-side right away, so :func:`read` sees it before the
reply ends and sees the user's own edits.

Limits are the artifacts feature's: a key of at most 300 characters, text
content of at most 512 KB. Content is never rendered as HTML: markdown goes
through the chat's sanitised renderer, code and tables are shown as text.
"""

from __future__ import annotations

import collections
import contextvars
import re
from typing import Any, Callable, Dict, List, Optional

__all__ = [
    "CanvasError",
    "Channel",
    "KINDS",
    "artifact_element",
    "artifacts",
    "attach_tools",
    "available",
    "canvas_list",
    "canvas_read",
    "canvas_update",
    "canvas_write",
    "open",
    "read",
    "tools",
    "update",
    "write",
]

#: What :func:`write` can put in the canvas (the artifacts feature's kinds, without ``a2ui``).
KINDS = ("code", "table", "markdown", "file", "image", "pdf", "video")
TEXT_KINDS = ("code", "table", "markdown")
#: The artifacts feature's limits (``features/artifacts.py``; a test keeps them equal).
MAX_CONTENT = 512 * 1024
MAX_KEY = 300
MAX_TITLE = 300
MAX_LANGUAGE = 64

_TABLE_DELIM = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")
_EXTENSION = re.compile(r"\.([A-Za-z0-9]{1,10})$")
_PROSE_EXTENSIONS = {"md", "markdown", "txt", "text", "rst"}


class CanvasError(ValueError):
    """A write the canvas refuses (bad key, kind, content or URL)."""


class Channel:
    """Where one chat run's canvas elements go.

    The run loop binds one per provider run (:func:`bind`) and sends what
    :meth:`drain` returns as ``message_element`` frames, in order, before
    the provider's next event. :meth:`push` is safe from any thread.
    """

    def __init__(self, session_id: Optional[str]) -> None:
        self.session_id = session_id
        self._pending: "collections.deque[Dict[str, Any]]" = collections.deque()

    def push(self, element: Dict[str, Any]) -> None:
        self._pending.append(element)

    def drain(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        while self._pending:
            out.append(self._pending.popleft())
        return out


_channel: "contextvars.ContextVar[Optional[Channel]]" = contextvars.ContextVar(
    "aiui_canvas_channel", default=None
)


def bind(session_id: Optional[str]) -> "tuple[Channel, contextvars.Token]":
    """Bind a new :class:`Channel` for the current context (the run loop does this)."""
    ch = Channel(session_id)
    return ch, _channel.set(ch)


def unbind(token: "contextvars.Token") -> None:
    _channel.reset(token)


# ── helpers ──────────────────────────────────────────────────────────


def _store() -> Any:
    """The artifacts store, or None while ``builtin.artifacts`` is off.

    Its feature module is imported only when the record mounted it (R4).
    """
    from praisonaiui.features import get_feature

    if get_feature("artifacts") is None:
        return None
    from praisonaiui.features.artifacts import get_artifact_store

    return get_artifact_store()


def available() -> bool:
    """True while this server has a canvas (``builtin.artifacts`` is mounted)."""
    try:
        return _store() is not None
    except Exception:  # noqa: BLE001 - asked by hosts deciding on tools: never raises
        return False


def _session(session_id: Optional[str]) -> Optional[str]:
    if session_id:
        return session_id
    ch = _channel.get()
    if ch is not None and ch.session_id:
        return ch.session_id
    try:
        from praisonaiui.callbacks import _get_context

        ctx = _get_context()
    except ImportError:
        return None
    return getattr(ctx, "session_id", None) or None


def _is_table(content: str) -> bool:
    lines = content.strip().splitlines()
    return len(lines) >= 2 and "|" in lines[0] and "-" in lines[1] and bool(_TABLE_DELIM.match(lines[1]))


def _has_table(content: str) -> bool:
    lines = content.splitlines()
    return any(
        "|" in lines[i] and "-" in lines[i + 1] and _TABLE_DELIM.match(lines[i + 1])
        for i in range(len(lines) - 1)
    )


def _infer_kind(key: str, content: Optional[str], language: Optional[str], url: Optional[str], mime: Optional[str]) -> str:
    if url and content is None:
        m = (mime or "").lower()
        if m.startswith("image/"):
            return "image"
        if m.startswith("video/"):
            return "video"
        if m == "application/pdf" or url.lower().split("?")[0].endswith(".pdf"):
            return "pdf"
        return "file"
    text = content or ""
    if _is_table(text):
        return "table"
    ext = _EXTENSION.search(key)
    if language or (ext and ext.group(1).lower() not in _PROSE_EXTENSIONS):
        return "code"
    return "markdown"


def _text(name: str, value: Any, limit: int) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise CanvasError(f"{name} must be a string of at most {limit} characters")
    return value.strip() or None


def artifact_element(
    key: str,
    content: Optional[str] = None,
    *,
    kind: Optional[str] = None,
    title: Optional[str] = None,
    language: Optional[str] = None,
    url: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    """The ``artifact`` element a write sends (validated; :class:`CanvasError` otherwise).

    Pure: a provider can ``yield BaseProvider.message_element_event(artifact_element(...))``.
    """
    if not isinstance(key, str) or not key.strip():
        raise CanvasError("key must be a non-empty string")
    key = key.strip()
    if len(key) > MAX_KEY or any(ord(c) < 0x20 for c in key):
        raise CanvasError(f"key must be at most {MAX_KEY} characters, without control characters")
    if content is not None and not isinstance(content, str):
        raise CanvasError("content must be a string")
    if content is not None and len(content.encode("utf-8")) > MAX_CONTENT:
        raise CanvasError(f"content is larger than {MAX_CONTENT} bytes")
    language = _text("language", language, MAX_LANGUAGE)
    mime_type = _text("mime_type", mime_type, 128)
    url = _text("url", url, 4096)
    kind = (kind or "").strip().lower() or _infer_kind(key, content, language, url, mime_type)
    if kind not in KINDS:
        raise CanvasError(f"kind must be one of {', '.join(KINDS)}")
    if kind in TEXT_KINDS:
        if content is None or not content.strip():
            raise CanvasError(f"a {kind} artifact needs content")
        if kind == "table" and not _has_table(content):
            raise CanvasError("table content must be a markdown table (a header row, then a |---| row)")
        url = None
    elif not url:
        raise CanvasError(f"a {kind} artifact needs a url")
    el: Dict[str, Any] = {
        "type": "artifact",
        "key": key,
        "kind": kind,
        "title": _text("title", title, MAX_TITLE) or key,
        "action": "upsert",
    }
    if kind in TEXT_KINDS:
        el["content"] = content
    if language and kind == "code":
        el["language"] = language
    if url:
        el["url"] = url
    if mime_type:
        el["mimeType"] = mime_type
    return el


def _latest(versions: List[Dict[str, Any]], key: str, *, derived_only: bool = False) -> Optional[Dict[str, Any]]:
    mine = [a for a in versions if a.get("key") == key and not (derived_only and a.get("edited"))]
    return max(mine, key=lambda a: a.get("version", 0), default=None)


def _store_version(store: Any, session_id: str, el: Dict[str, Any]) -> Dict[str, Any]:
    """Store *el* as the key's next version, unless it equals the latest agent version.

    That is the browser's rule too (the same content again adds no version),
    so the numbers here and in the canvas agree.
    """
    prev = _latest(store.session(session_id), el["key"], derived_only=True)
    if prev is not None and all(prev.get(f) == el.get(f) for f in ("kind", "content", "url")):
        return prev
    body = {f: el[f] for f in ("kind", "title", "content", "language", "url", "mimeType") if f in el}
    try:
        return store.put(session_id, el["key"], body)
    except ValueError as exc:  # ArtifactError: the URL policy, the per-session cap
        raise CanvasError(str(exc)) from None


# ── the API ──────────────────────────────────────────────────────────


def write(
    key: str,
    content: Optional[str] = None,
    *,
    kind: Optional[str] = None,
    title: Optional[str] = None,
    language: Optional[str] = None,
    url: Optional[str] = None,
    mime_type: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Put an artifact in the canvas under *key*; the same key again is a new version.

    *kind* is one of :data:`KINDS`; left out, it is ``table`` for content that
    starts with a markdown table, ``code`` with a *language* or a code file
    name (``app.py``), ``markdown`` otherwise, and from *mime_type* for a
    *url*. Shows it in the chat run in progress and stores it while the
    artifacts feature is on. Returns the stored version (with ``version``),
    or the element when nothing stores it (``version`` is then None).
    Raises :class:`CanvasError` for a bad key, kind, content or URL.
    """
    el = artifact_element(key, content, kind=kind, title=title, language=language, url=url, mime_type=mime_type)
    if el["kind"] not in TEXT_KINDS and _store() is None:
        raise CanvasError("url artifacts need the canvas (builtin.artifacts)")
    sid = _session(session_id)
    store = _store() if sid else None
    saved = _store_version(store, sid, el) if store is not None else None
    if saved is not None and saved.get("url"):
        el["url"] = saved["url"]  # as the store normalised it
    ch = _channel.get()
    if ch is not None and (ch.session_id is None or ch.session_id == sid or sid is None):
        ch.push(el)
    if saved is None:
        return {**el, "version": None, "sessionId": sid}
    return dict(saved)


def update(key: str, content: str, *, session_id: Optional[str] = None, **fields: Any) -> Dict[str, Any]:
    """:func:`write` that keeps the kind, title and language of the key's latest version."""
    latest = read(key, session_id=session_id)
    if latest is not None:
        for f, name in (("kind", "kind"), ("title", "title"), ("language", "language"), ("mimeType", "mime_type")):
            if latest.get(f) and fields.get(name) is None:
                fields[name] = latest[f]
    return write(key, content, session_id=session_id, **fields)


def open(key: str, *, session_id: Optional[str] = None) -> bool:  # noqa: A001 - aiui.canvas.open
    """Show the artifact *key* in the canvas of the run in progress. False outside a run."""
    if not isinstance(key, str) or not key.strip() or len(key.strip()) > MAX_KEY:
        raise CanvasError(f"key must be a non-empty string of at most {MAX_KEY} characters")
    ch = _channel.get()
    if ch is None or (session_id and ch.session_id and ch.session_id != session_id):
        return False
    ch.push({"type": "artifact", "key": key.strip(), "action": "open"})
    return True


def read(key: str, *, version: Optional[int] = None, session_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The latest version of *key* (or *version*), with content; None when there is none.

    The latest version may be the user's own edit (``edited: True``). Needs
    the artifacts feature (None without it).
    """
    sid = _session(session_id)
    store = _store() if sid else None
    if store is None:
        return None
    versions = store.session(sid)
    if version is not None:
        return next((dict(a) for a in versions if a.get("key") == key and a.get("version") == version), None)
    found = _latest(versions, key)
    return dict(found) if found else None


def artifacts(*, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """The chat's artifacts, latest version of each, newest first, without content."""
    sid = _session(session_id)
    store = _store() if sid else None
    if store is None:
        return []
    return list(store.index(sid, limit=500)["artifacts"])


# ── agent tools ──────────────────────────────────────────────────────
#
# Plain functions with type hints and Google-style docstrings: praisonaiagents
# (and most agent SDKs) turn them into tool schemas without this module
# importing them. They return short strings for the model and never raise.


def _done(saved: Dict[str, Any]) -> str:
    v = saved.get("version")
    where = f"version {v}" if v else "shown in the chat"
    return f"Saved '{saved['key']}' to the canvas ({saved['kind']}, {where}). Do not repeat it in your reply."


def canvas_write(name: str, content: str, kind: str = "", language: str = "", title: str = "") -> str:
    """Put a table, document or code file in the canvas beside the chat, instead of writing it in your reply; the same name again saves a new version.

    Use it for anything the user will look at or iterate on.

    Args:
        name: Stable name of the artifact, e.g. "sorting-comparison" or "app.py". Reuse it to change the artifact.
        content: The full content: a markdown table (header row, then |---|) for a table, markdown for a document, source code for code.
        kind: "table", "markdown" or "code"; inferred from the content when empty.
        language: The programming language of code, e.g. "python".
        title: A short title for the canvas tab; defaults to the name.

    Returns:
        A confirmation with the version number, or an error.
    """
    try:
        return _done(write(name, content, kind=kind or None, language=language or None, title=title or None))
    except CanvasError as exc:
        return f"Error: {exc}"


def canvas_update(name: str, content: str) -> str:
    """Save a new full version of an artifact already in the canvas, keeping its kind and title; call canvas_read first (the user may have edited it).

    Args:
        name: The artifact's name, as given to canvas_write.
        content: The full new content (not a diff).

    Returns:
        A confirmation with the version number, or an error.
    """
    try:
        return _done(update(name, content))
    except CanvasError as exc:
        return f"Error: {exc}"


def canvas_read(name: str) -> str:
    """Get the latest version of a canvas artifact (it may be the user's own edit), to change it or answer about it, e.g. when the user mentions @name.

    Args:
        name: The artifact's name (see canvas_list).

    Returns:
        A header (name, kind, version) and the content, or an error.
    """
    a = read(name)
    if a is None:
        names = ", ".join(x["key"] for x in artifacts()[:20]) or "none"
        return f"Error: no artifact named '{name}' in this chat's canvas. Artifacts: {names}."
    by = " (edited by the user)" if a.get("edited") else ""
    head = f"name: {a['key']}\nkind: {a.get('kind')}\ntitle: {a.get('title')}\nversion: {a.get('version')}{by}"
    if a.get("language"):
        head += f"\nlanguage: {a['language']}"
    body = a.get("content") if a.get("content") is not None else f"url: {a.get('url', '')}"
    return f"{head}\n---\n{body}"


def canvas_list() -> str:
    """List the artifacts in this chat's canvas: name, kind, title and latest version.

    Returns:
        One artifact per line, newest first, or "The canvas is empty."
    """
    rows = artifacts()
    if not rows:
        return "The canvas is empty."
    return "\n".join(
        f"- {a['key']} ({a.get('kind')}, v{a.get('version')}{', edited by the user' if a.get('edited') else ''}): {a.get('title')}"
        for a in rows
    )


def tools() -> List[Callable[..., str]]:
    """The canvas tools for an agent: canvas_write, canvas_update, canvas_read, canvas_list."""
    return [canvas_write, canvas_update, canvas_read, canvas_list]


def attach_tools(agent: Any) -> bool:
    """Add the canvas tools to *agent* (``agent.tools``) when this server has a canvas.

    Tools of the same name already there are kept. Returns True when the
    agent has them afterwards.
    """
    if agent is None or not available() or not hasattr(agent, "tools"):
        return False
    current = list(getattr(agent, "tools", None) or [])
    names = {getattr(t, "__name__", None) for t in current}
    missing = [t for t in tools() if t.__name__ not in names]
    if missing:
        agent.tools = current + missing
    return True
