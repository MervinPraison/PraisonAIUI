"""Docs page feedback (docs/features/writing-docs.md#page-feedback).

``aiui serve`` / ``aiui dev`` answer ``/api/docs/feedback`` on a docs build: ``GET`` says votes
are kept, and the ``ui-config.json`` they serve names the endpoint (``docsFeedback.url``), so the
page posts here only when such a server sent it; a static host has neither and gets no request.
``POST`` appends one (page or code block, 1 or -1, optional comment) to
``<data dir>/docs-feedback/feedback.jsonl``; a comment repeats its vote's ``id``. Public by
design, so guarded: Host and Origin checks, JSON or text/plain, 4 KiB, a per-client rate limit
and a size cap. Nothing is readable over HTTP: ``aiui docs feedback`` lists and exports.
Agents report through the docs MCP server's ``submit_feedback`` tool (docs_mcp.py), which calls
``DocsFeedback.submit`` and so shares the store, rate limit and caps (``source: agent``).
"""

from __future__ import annotations

import csv
import io
import json
import re
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

ENDPOINT = "/api/docs/feedback"
MAX_BODY_BYTES = 4 * 1024
MAX_COMMENT = 1000
MAX_STORE_BYTES = 20 * 1024 * 1024
RATE_LIMIT, RATE_WINDOW_S = 20, 60.0  # posts per client per minute (a vote and its comment are two)
FIELDS = ("created_at", "site", "path", "kind", "block", "value", "comment", "source", "id")

_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_lock = threading.Lock()


def store_path() -> Path:
    """The JSONL file votes go to: ``$PRAISONAI_HOME`` / ``$AIUI_DATA_DIR``, else ``~/.praisonaiui``."""
    from praisonaiui.features._paths import aiui_default_data_dir, feature_data_path

    return feature_data_path("docs-feedback", aiui_default_data_dir() / "docs-feedback") / "feedback.jsonl"


def clean(body: Any, site: str = "", source: str = "reader") -> Union[dict, str]:
    """One stored record from a posted body, or the reason it is refused."""
    if not isinstance(body, dict):
        return "Send a JSON object"
    path, value, kind = body.get("path"), body.get("value"), body.get("kind", "page")
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 512 or _CONTROL.search(path):
        return "path must be the page's path, e.g. /docs/guide/install"
    if value not in (1, -1) or isinstance(value, bool):
        return "value must be 1 (helpful) or -1 (not helpful)"
    if kind not in ("page", "code"):
        return "kind must be page or code"
    block = body.get("block") if kind == "code" else None
    if kind == "code" and (not isinstance(block, int) or isinstance(block, bool) or not 0 <= block < 10_000):
        return "block must be the code block's index on the page"
    comment, rid = body.get("comment") or "", body.get("id")
    if not isinstance(comment, str):
        return "comment must be text"
    return {
        "id": rid if isinstance(rid, str) and _ID.match(rid) else str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "site": site, "path": path, "kind": kind, "block": block, "value": value,
        "comment": _CONTROL.sub("", comment).strip()[:MAX_COMMENT], "source": source,
    }


def append(record: dict, file: Optional[Path] = None) -> bool:
    """Append one record; ``False`` when the store is full."""
    file = file or store_path()
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with _lock:
        file.parent.mkdir(parents=True, exist_ok=True)
        if file.exists() and file.stat().st_size + len(line) > MAX_STORE_BYTES:
            return False
        with file.open("a", encoding="utf-8") as fh:
            fh.write(line)
    return True


def load(file: Optional[Path] = None, site: Optional[str] = None) -> list[dict]:
    """Every vote, oldest first; a later record with the same ``id`` (its comment) replaces it."""
    file = file or store_path()
    votes: dict[str, dict] = {}
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and "id" in rec and (site is None or rec.get("site", "").lower() == site.lower()):
            first = votes.get(rec["id"])
            votes[rec["id"]] = {**rec, "created_at": first["created_at"]} if first else rec
    return list(votes.values())


def by_page(records: list[dict]) -> list[dict]:
    """Per-page counts, the least helpful page first."""
    pages: dict[str, dict] = {}
    for r in records:
        p = pages.setdefault(r["path"], {"path": r["path"], "yes": 0, "no": 0, "code": 0, "comments": 0})
        if r.get("kind") == "code":
            p["code"] += 1
        else:
            p["yes" if r["value"] > 0 else "no"] += 1
        p["comments"] += bool(r.get("comment"))
    return sorted(pages.values(), key=lambda p: (-p["no"] - p["code"], p["yes"], p["path"]))


def _cell(value: Any) -> Any:
    # A cell a spreadsheet would run as a formula (=, +, -, @) is quoted.
    return "'" + value if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def to_csv(records: list[dict]) -> str:
    out = io.StringIO()
    csv.writer(out).writerows([FIELDS, *([_cell(r.get(f)) if r.get(f) is not None else "" for f in FIELDS] for r in records)])
    return out.getvalue()


class DocsFeedback:
    """The feedback endpoint of one built docs site."""

    def __init__(self, site: str = "", origins: Optional[list[str]] = None, file: Optional[Path] = None,
                 local: bool = True):
        self.site, self.origins, self.file = site, list(origins or []), file
        #: False when the site posts votes to its own ``endpoint``: then agents get no feedback tool.
        self.local = local
        self.hits: dict[str, deque] = {}
        #: The build; with ``patch_config`` this endpoint serves its ui-config.json with ``docsFeedback``
        #: (only when neither the MCP server nor Ask AI serves that file: cli._static_site_app).
        self.root: Optional[Path] = None
        self.patch_config = False
        self.base = ""

    def config_entry(self, base: str = "") -> dict:
        """What the served ``ui-config.json`` says about votes: where to post them."""
        return {"url": base + ENDPOINT}

    def allow(self, client: str) -> bool:
        """At most RATE_LIMIT posts per client in RATE_WINDOW_S (the HTTP endpoint and the MCP tool share it)."""
        now = time.monotonic()
        if len(self.hits) > 10_000:
            self.hits.clear()
        q = self.hits.setdefault(client, deque())
        while q and now - q[0] > RATE_WINDOW_S:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return False
        q.append(now)
        return True

    @classmethod
    def for_site(cls, root: Path, origins: Optional[list[str]] = None) -> Optional[DocsFeedback]:
        """The endpoint for a docs build, unless it sets ``content.docs.feedback: false``."""
        try:
            config = json.loads((root / "ui-config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {}
        config = config if isinstance(config, dict) else {}
        feedback = (config.get("pageFooter") or {}).get("feedback")
        if not (root / "docs-nav.json").is_file() or feedback is False:
            return None
        local = not (isinstance(feedback, dict) and "endpoint" in feedback)
        endpoint = cls(str((config.get("site") or {}).get("title") or ""), origins, local=local)
        endpoint.root = root
        return endpoint

    def submit(self, body: dict, client: str, source: str = "agent") -> Union[dict, str]:
        """Store one record under the endpoint's rate limit and caps: the record, or why it is refused."""
        if not self.allow(client):
            return "Too many reports; try again in a minute."
        if len(json.dumps(body, ensure_ascii=False).encode()) > MAX_BODY_BYTES:
            return "Feedback too large (4 KiB at most)."
        record = clean(body, self.site, source)
        if isinstance(record, str) or append(record, self.file):
            return record
        return "The feedback store is full."

    async def serve(self, scope: dict, receive, send) -> bool:
        """Answer ``/api/docs/feedback``; ``False`` for any other path."""
        from starlette.responses import JSONResponse, PlainTextResponse, Response

        from praisonaiui import http_guard as hg

        path, method = scope.get("path"), scope.get("method", "GET")
        config_file = path == "/ui-config.json" and self.patch_config and self.root and method in ("GET", "HEAD")
        if path != ENDPOINT and not config_file:
            return False
        response: Response
        if not hg.host_allowed(scope, hg.configured_hosts()):  # DNS rebinding
            response = PlainTextResponse("Host not allowed", status_code=400)
        elif config_file:
            try:
                config = json.loads((self.root / "ui-config.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return False
            if not isinstance(config, dict):
                return False
            response = JSONResponse({**config, "docsFeedback": self.config_entry(self.base)},
                                    headers={"Cache-Control": "no-cache"})
        elif method in ("GET", "HEAD"):
            response = JSONResponse({"enabled": True}, headers={"Cache-Control": "no-cache"})
        elif method != "POST":
            response = PlainTextResponse("Method Not Allowed", 405, headers={"Allow": "GET, POST"})
        elif not hg.origin_allowed(scope, hg.configured_origins() + self.origins):
            response = PlainTextResponse("Origin not allowed", status_code=403)
        elif not hg.header(scope, b"content-type").lower().startswith(("application/json", "text/plain")):
            response = PlainTextResponse("Send application/json", status_code=415)
        elif not self.allow((scope.get("client") or ("?",))[0]):
            response = PlainTextResponse("Too many votes; try again in a minute", 429, headers={"Retry-After": "60"})
        else:
            from praisonaiui.docs_auth import view

            response = await self._post(receive, view(scope))
        await response(scope, receive, send)
        return True

    async def _post(self, receive, reader: Any = None):
        from starlette.responses import JSONResponse, PlainTextResponse

        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if message["type"] == "http.disconnect" or not message.get("more_body") or len(body) > MAX_BODY_BYTES:
                break
        if len(body) > MAX_BODY_BYTES:
            return PlainTextResponse("Request too large", status_code=413)
        try:
            record = clean(json.loads(body), self.site)
        except ValueError:
            record = "Send a JSON object"
        if isinstance(record, str):
            return JSONResponse({"error": record}, status_code=400)
        if reader and not reader.may(record["path"].split("#")[0]):  # a page this reader may not read
            return JSONResponse({"error": "No such page"}, status_code=404)
        if not append(record, self.file):
            return JSONResponse({"error": "The feedback store is full"}, status_code=507)
        return JSONResponse({"ok": True, "id": record["id"]})
