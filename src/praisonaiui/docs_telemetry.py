"""Opt-in field telemetry of docs page loads (docs/features/writing-docs.md#load-telemetry).

The docs app records every page-load outcome as an ``aiui:docs-load`` record (frontend
``docs/loadEvents.ts``). With ``content.docs.telemetry`` set, the page sends the ones that went
wrong (retries, failures, loader mistakes) and a sampled share of the good timings home with
``navigator.sendBeacon`` when it is hidden (``docs/fieldTelemetry.ts``). Off by default.

``content.docs.telemetry: true`` posts them to ``aiui serve`` / ``aiui dev``: the build is served
with ``/api/docs/telemetry`` and the ``ui-config.json`` it serves names it
(``docsTelemetry.url``), so a static host, which has neither, gets no request.
``{endpoint: <url>}`` posts them to your own collector instead, and ``aiui serve`` mounts nothing.

``POST`` appends each valid record to ``<data dir>/docs-telemetry/telemetry.jsonl`` with a server
timestamp and the site title. Nothing personal is kept: no IP address, no header, no user or
session id, and paths lose their query and fragment. Public by design (a reader's page sends it),
so guarded like the feedback endpoint: Host and Origin checks, JSON or text/plain, 16 KiB, a
per-client rate limit and a size cap. Nothing is readable over HTTP: ``aiui docs telemetry`` lists.
"""

from __future__ import annotations

import csv
import io
import json
import re
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional, Union

ENDPOINT = "/api/docs/telemetry"
MAX_BODY_BYTES = 16 * 1024
MAX_RECORDS = 50  # per post (the page sends at most this many per beacon)
MAX_STORE_BYTES = 20 * 1024 * 1024
RATE_LIMIT, RATE_WINDOW_S = 30, 60.0  # posts per client per minute
OUTCOMES = ("ok", "retry", "failed", "inline", "inline-mismatch", "duplicate")
PROBLEMS = frozenset(OUTCOMES) - {"ok", "inline"}
FIELDS = ("created_at", "site", "page", "url", "kind", "attempt", "of", "ms", "outcome", "reason", "status",
          "sampled", "detail")

_REASON = re.compile(r"^[a-z0-9-]{1,32}$")  # known today: headers-timeout, body-idle, ...; new ones may be added
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_lock = threading.Lock()


def store_path() -> Path:
    """The JSONL file records go to: ``$PRAISONAI_HOME`` / ``$AIUI_DATA_DIR``, else ``~/.praisonaiui``."""
    from praisonaiui.features._paths import aiui_default_data_dir, feature_data_path

    return feature_data_path("docs-telemetry", aiui_default_data_dir() / "docs-telemetry") / "telemetry.jsonl"


def _path(value: Any) -> Optional[str]:
    """An app path without query or fragment, or None."""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return None
    value = re.split(r"[?#]", value, maxsplit=1)[0]
    return None if len(value) > 512 or _CONTROL.search(value) else value


def _int(value: Any, low: int, high: int) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return None
    return int(value) if low <= value <= high else None


def clean_record(rec: Any, site: str = "", now: Optional[str] = None) -> Union[dict, str]:
    """One stored record from a posted ``aiui:docs-load`` record, or the reason it is refused.

    Only the known fields are kept (whatever else a client sends is dropped)."""
    if not isinstance(rec, dict):
        return "each record must be an object"
    url = _path(rec.get("url"))
    if not url:
        return "url must be the app path requested, e.g. /docs/x.source.md"
    if rec.get("kind") not in ("doc", "manifest"):
        return "kind must be doc or manifest"
    outcome = rec.get("outcome")
    if outcome not in OUTCOMES:
        return f"outcome must be one of {', '.join(OUTCOMES)}"
    attempt, of, ms = _int(rec.get("attempt"), 0, 20), _int(rec.get("of"), 0, 20), _int(rec.get("ms"), 0, 600_000)
    if attempt is None or of is None or ms is None:
        return "attempt and of must be 0-20, ms 0-600000"
    reason = rec.get("reason")
    if reason is not None and not (isinstance(reason, str) and _REASON.match(reason)):
        return "reason must be a short lowercase name"
    status = rec.get("status")
    if status is not None and _int(status, 100, 599) is None:
        return "status must be an HTTP status"
    page = _path(rec.get("page")) if rec.get("page") is not None else None
    detail = rec.get("detail")
    return {
        "created_at": now or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "site": site, "page": page, "url": url, "kind": rec["kind"], "attempt": attempt, "of": of, "ms": ms,
        "outcome": outcome, "reason": reason, "status": _int(status, 100, 599) if status is not None else None,
        "sampled": rec.get("sampled") is True,
        "detail": _CONTROL.sub("", detail)[:200] if isinstance(detail, str) and detail else None,
    }


def clean(body: Any, site: str = "") -> Union[list[dict], str]:
    """The records of one post (``{"records": [...]}`` or a list), or the reason it is refused."""
    records = body.get("records") if isinstance(body, dict) else body
    if not isinstance(records, list) or not records:
        return "Send {\"records\": [...]} with at least one aiui:docs-load record"
    if len(records) > MAX_RECORDS:
        return f"At most {MAX_RECORDS} records per post"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = []
    for i, rec in enumerate(records):
        cleaned = clean_record(rec, site, now)
        if isinstance(cleaned, str):
            return f"record {i}: {cleaned}"
        out.append(cleaned)
    return out


def append(records: list[dict], file: Optional[Path] = None) -> bool:
    """Append the records; ``False`` when the store is full."""
    file = file or store_path()
    text = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
    with _lock:
        file.parent.mkdir(parents=True, exist_ok=True)
        if file.exists() and file.stat().st_size + len(text.encode()) > MAX_STORE_BYTES:
            return False
        with file.open("a", encoding="utf-8") as fh:
            fh.write(text)
    return True


_SINCE = re.compile(r"^(\d+)([mhd])$")


def parse_since(value: str, now: Optional[datetime] = None) -> datetime:
    """``30m``, ``24h``, ``7d`` or an ISO date/time (UTC unless it says otherwise)."""
    now = now or datetime.now(timezone.utc)
    m = _SINCE.match(value.strip())
    if m:
        unit = {"m": "minutes", "h": "hours", "d": "days"}[m.group(2)]
        return now - timedelta(**{unit: int(m.group(1))})
    when = datetime.fromisoformat(value.strip())
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def load(file: Optional[Path] = None, site: Optional[str] = None, outcome: Optional[str] = None,
         since: Optional[datetime] = None) -> list[dict]:
    """Every stored record, oldest first, filtered by site title, outcome (``problems``: not ok/inline) and time."""
    file = file or store_path()
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        if site is not None and str(rec.get("site", "")).lower() != site.lower():
            continue
        if outcome == "problems" and rec.get("outcome") not in PROBLEMS:
            continue
        if outcome not in (None, "problems") and rec.get("outcome") != outcome:
            continue
        if since is not None:
            try:
                if datetime.fromisoformat(str(rec.get("created_at"))) < since:
                    continue
            except ValueError:
                continue
        out.append(rec)
    return out


def _pct(values: list[int], q: float) -> Optional[int]:
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def by_url(records: list[dict]) -> list[dict]:
    """Per requested file: counts per outcome and attempt-time percentiles, most problems first."""
    rows: dict[str, dict] = {}
    for r in records:
        row = rows.setdefault(r["url"], {"url": r["url"], "records": 0, "ok": 0, "problems": 0, "reasons": {},
                                         "_ms": []})
        row["records"] += 1
        if r.get("outcome") in PROBLEMS:
            row["problems"] += 1
            key = r.get("reason") or r.get("outcome")
            row["reasons"][key] = row["reasons"].get(key, 0) + 1
        elif r.get("outcome") == "ok":
            row["ok"] += 1
        if r.get("outcome") in ("ok", "retry", "failed") and isinstance(r.get("ms"), int):
            row["_ms"].append(r["ms"])
    out = []
    for row in rows.values():
        ms = row.pop("_ms")
        out.append({**row, "p50_ms": _pct(ms, 0.5), "p95_ms": _pct(ms, 0.95)})
    return sorted(out, key=lambda r: (-r["problems"], -r["records"], r["url"]))


def to_csv(records: list[dict]) -> str:
    def cell(v: Any) -> Any:  # a cell a spreadsheet would run as a formula is quoted
        return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v

    out = io.StringIO()
    csv.writer(out).writerows([FIELDS, *([cell(r.get(f)) if r.get(f) is not None else "" for f in FIELDS]
                                         for r in records)])
    return out.getvalue()


class DocsTelemetry:
    """The telemetry endpoint of one built docs site (only when it opted in with ``telemetry: true``)."""

    def __init__(self, site: str = "", origins: Optional[list[str]] = None, file: Optional[Path] = None):
        self.site, self.origins, self.file = site, list(origins or []), file
        self.hits: dict[str, deque] = {}
        #: With ``patch_config`` this endpoint serves the build's ui-config.json plus ``extra_config``
        #: (when neither the MCP server nor Ask AI serves that file: cli._static_site_app).
        self.root: Optional[Path] = None
        self.patch_config = False
        self.extra_config: dict[str, Any] = {}
        self.base = ""

    def config_entry(self, base: str = "") -> dict:
        """What the served ``ui-config.json`` says: where to post records."""
        return {"url": base + ENDPOINT}

    def allow(self, client: str) -> bool:
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
    def for_site(cls, root: Path, origins: Optional[list[str]] = None) -> Optional[DocsTelemetry]:
        """The endpoint for a docs build that set ``telemetry: true`` (no ``endpoint`` of its own), else None."""
        try:
            config = json.loads((root / "ui-config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(config, dict) or not (root / "docs-nav.json").is_file():
            return None
        telemetry = config.get("telemetry")
        if not isinstance(telemetry, dict) or telemetry.get("endpoint"):
            return None
        endpoint = cls(str((config.get("site") or {}).get("title") or ""), origins)
        endpoint.root = root
        return endpoint

    async def serve(self, scope: dict, receive, send) -> bool:
        """Answer ``/api/docs/telemetry`` (and ui-config.json when patching it); ``False`` otherwise."""
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
            response = JSONResponse({**config, "docsTelemetry": self.config_entry(self.base), **self.extra_config},
                                    headers={"Cache-Control": "no-cache"})
        elif method in ("GET", "HEAD"):
            response = JSONResponse({"enabled": True}, headers={"Cache-Control": "no-cache"})
        elif method != "POST":
            response = PlainTextResponse("Method Not Allowed", 405, headers={"Allow": "GET, POST"})
        elif not hg.origin_allowed(scope, hg.configured_origins() + self.origins):
            response = PlainTextResponse("Origin not allowed", status_code=403)
        elif not hg.header(scope, b"content-type").lower().startswith(("application/json", "text/plain")):
            response = PlainTextResponse("Send application/json", status_code=415)
        elif not self.allow((scope.get("client") or ("?",))[0]):  # held in memory for a minute, never stored
            response = PlainTextResponse("Too many reports; try again in a minute", 429, headers={"Retry-After": "60"})
        else:
            response = await self._post(receive)
        await response(scope, receive, send)
        return True

    async def _post(self, receive):
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
            records = clean(json.loads(body), self.site)
        except ValueError:
            records = "Send a JSON object"
        if isinstance(records, str):
            return JSONResponse({"error": records}, status_code=400)
        if not append(records, self.file):
            return JSONResponse({"error": "The telemetry store is full"}, status_code=507)
        return JSONResponse({"ok": True, "stored": len(records)})
