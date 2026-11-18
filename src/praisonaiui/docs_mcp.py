"""A read-only MCP server for a built docs site (docs/features/ai-ready-docs.md#mcp-server).

``aiui serve`` and ``aiui dev`` answer the Model Context Protocol's Streamable
HTTP transport at ``/mcp``: JSON-RPC 2.0 over ``POST`` (``initialize``,
``ping``, ``tools/list``, ``tools/call``), stateless, no session id and no
server-to-client stream. Three tools: ``search_docs`` (the build's
``search-index.json``, ranked as the search dialog ranks it,
``src/frontend/src/docs/searchIndex.ts``), ``read_page`` (a page's agent-ready
``.md``) and ``list_pages`` (``llms.txt``).

Discovery: a server card at ``/.well-known/mcp`` (also ``mcp.json`` and
``mcp/server-card.json``), an "MCP server" section appended to ``llms.txt`` and
an ``mcp`` entry added to ``ui-config.json``, which shows the page menu's MCP
items. ``content.docs.mcp: false`` turns it all off (the build writes
``"mcp": false``). A static host serves none of it: it needs the server.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from praisonaiui.__version__ import __version__

#: Newest first; ``initialize`` answers the client's version when it is here.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
ENDPOINT = "/mcp"
CARD_PATHS = ("/.well-known/mcp", "/.well-known/mcp.json", "/.well-known/mcp/server-card.json")
LLMS_PATHS = ("/llms.txt", "/.well-known/llms.txt")
MAX_BODY_BYTES = 64 * 1024
MAX_RESULTS = 50

_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_docs",
        "title": "Search the docs",
        "description": "Search these docs. Returns the best matching pages and sections, each with "
        "the path read_page takes, its URL and a snippet.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to look for, in a few words"},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_RESULTS, "default": 10,
                          "description": "Most results (default 10)"},
            },
            "required": ["query"],
        },
        "annotations": _READ_ONLY,
    },
    {
        "name": "read_page",
        "title": "Read a docs page",
        "description": "One page of these docs as Markdown (front matter, components and links "
        "resolved for agents).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "A page path from search_docs or list_pages "
                         "(/docs/guide/install), or the page's URL"},
            },
            "required": ["path"],
        },
        "annotations": _READ_ONLY,
    },
    {
        "name": "list_pages",
        "title": "List the docs pages",
        "description": "Every page of these docs by section, with its description and Markdown URL (llms.txt).",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": _READ_ONLY,
    },
]
_TOOL_NAMES = {t["name"] for t in TOOLS}

# -- search: a port of docs/searchRank.ts and docs/searchIndex.ts -------------

_STOP = frozenset("a an and are can do does for how i in is it of on or the to what when where why with".split())
_WORD = re.compile(r"[^\W_]+")
K1, B, HEADING_WEIGHT = 1.2, 0.75, 2


def tokenize(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def query_terms(query: str) -> list[str]:
    words = tokenize(query)
    return [w for w in words if w not in _STOP] or words


def stem(word: str) -> str:
    w = word
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 5 and w.endswith("ing"):
        w = w[:-3]
    elif len(w) > 4 and w.endswith("ed"):
        w = w[:-2]
    elif len(w) > 4 and re.search(r"(?:s|x|z|ch|sh)es$", w):
        w = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return w[:-1] if len(w) > 3 and w.endswith("e") else w


def _one_edit(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]:
        i += 1
    if i == len(a) == len(b):
        return True
    if len(a) == len(b):
        swap = i + 1 < len(a) and a[i] == b[i + 1] and a[i + 1] == b[i] and a[i + 2 :] == b[i + 2 :]
        return a[i + 1 :] == b[i + 1 :] or swap
    return a[i + 1 :] == b[i:] if len(a) > len(b) else a[i:] == b[i + 1 :]


def term_match(term: str, word: str) -> float:
    """1 for the same stem, 0.7 for a prefix, 0.5 for one typo (5+ letters), else 0."""
    if term == word or stem(term) == stem(word):
        return 1.0
    if len(term) >= 2 and word.startswith(term):
        return 0.7
    if len(term) >= 5 and len(word) >= 4 and _one_edit(term, word):
        return 0.5
    return 0.0


def _best(term: str, words: list[str]) -> float:
    return max((term_match(term, w) for w in words), default=0.0)


def _title_score(title: str, terms: list[str], keywords: list[str]) -> float:
    t, title_words = title.lower(), tokenize(title)
    keyword_words = [w for k in keywords for w in tokenize(k)]
    total = 0.0
    for w in terms:
        if t.startswith(w):
            total += 1
        elif re.search(rf"(?:^|[\W_]){re.escape(w)}", t):
            total += 0.8
        elif w in t or _best(w, keyword_words) >= 0.7:
            total += 0.6
        elif m := _best(w, title_words):
            total += 0.5 * m
        else:
            return 0.0
    return total / len(terms)


def prepare(index: dict) -> tuple[list, dict, float]:
    """Every section as a BM25 document, and the inverted index (word -> section -> count)."""
    docs: list[tuple[dict, dict, int, list[str]]] = []
    postings: dict[str, dict[int, int]] = {}
    total = 0
    for page in index.get("pages", []):
        for sec in page.get("s", []):
            head = tokenize(sec.get("h", ""))
            words = head * HEADING_WEIGHT + tokenize(sec.get("x", ""))
            for w in words:
                counts = postings.setdefault(w, {})
                counts[len(docs)] = counts.get(len(docs), 0) + 1
            docs.append((page, sec, len(words), head))
            total += len(words)
    return docs, postings, (total / max(1, len(docs))) or 1


def _bm25(prepared: tuple[list, dict, float], terms: list[str]) -> dict[int, float]:
    """Sections that match every term, with their summed score (best matching word per term)."""
    docs, postings, avg = prepared
    per_term = []
    for term in terms:
        out: dict[int, float] = {}
        for word, counts in postings.items():
            match = term_match(term, word)
            if not match:
                continue
            idf = math.log(1 + (len(docs) - len(counts) + 0.5) / (len(counts) + 0.5))
            for i, tf in counts.items():
                score = match * idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * docs[i][2] / avg))
                out[i] = max(out.get(i, 0.0), score)
        per_term.append(out)
    first, *rest = per_term
    return {i: s + sum(r[i] for r in rest) for i, s in first.items() if all(i in r for r in rest)}


def _snippet(text: str, terms: list[str], width: int = 200) -> str:
    if len(text) <= width:
        return text
    hits = (m.start() for m in _WORD.finditer(text) if any(term_match(t, m.group().lower()) for t in terms))
    start = max(0, next(hits, 0) - width // 3)
    if start > 0:
        start = text.find(" ", start) + 1 or start
    end = min(len(text), start + width)
    if end < len(text) and (space := text.rfind(" ", 0, end + 1)) > start:
        end = space
    return ("… " if start else "") + text[start:end] + (" …" if end < len(text) else "")


def search(index: dict, query: str, limit: int = 10, prepared: Optional[tuple] = None) -> list[dict]:
    """Pages whose title matches first, then sections whose heading holds every word, then text."""
    terms = query_terms(query)
    if not terms:
        return []
    inner = lambda x: x / (x + 1)  # noqa: E731 - a score inside its tier, below 1
    out, titled = [], set()
    for page in index.get("pages", []):
        s = _title_score(page["t"], terms, page.get("k", []))
        if s > 0:
            titled.add(page["p"])
            out.append({"title": page["t"], "heading": "", "anchor": "", "path": page["p"],
                        "snippet": page.get("d", ""), "score": 3 + inner(2 * s * page.get("b", 1))})
    prepared = prepared or prepare(index)
    for i, score in _bm25(prepared, terms).items():
        page, sec, _, head = prepared[0][i]
        in_heading = bool(sec["h"]) and all(_best(t, head) > 0 for t in terms)
        if not in_heading and not sec["h"] and page["p"] in titled:
            continue
        out.append({"title": page["t"], "heading": sec["h"], "anchor": sec["a"], "path": page["p"],
                    "snippet": _snippet(sec["x"], terms),
                    "score": (2 if in_heading else 1) + inner(score * page.get("b", 1))})
    out.sort(key=lambda r: -r["score"])
    results, seen = [], set()
    for r in out:
        if (r["path"], r["anchor"]) not in seen:
            seen.add((r["path"], r["anchor"]))
            results.append(r)
    return results[:limit]


# -- the server ---------------------------------------------------------------


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "docs"


def _result(rid: Any, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _error(rid: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


class DocsMcp:
    """The MCP endpoint, server card and discovery entries of one built site (``root``)."""

    def __init__(self, root: Path, base: str = "", origins: Optional[list[str]] = None):
        self.root, self.base, self.origins = root.resolve(), base, list(origins or [])
        self._cache: dict[str, tuple[int, Any]] = {}

    @classmethod
    def for_site(cls, root: Path, base: str = "", origins: Optional[list[str]] = None) -> Optional[DocsMcp]:
        """The server for a docs build (it has ``docs-nav.json``), unless ``content.docs.mcp: false``."""
        try:
            config = json.loads((root / "ui-config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {}
        if not (root / "docs-nav.json").is_file() or (isinstance(config, dict) and config.get("mcp") is False):
            return None
        return cls(root, base, origins)

    def _load(self, name: str) -> Any:
        """A file of the build (JSON parsed), re-read when it changes (``aiui serve --watch``)."""
        path = self.root / name
        try:
            stamp = path.stat().st_mtime_ns
            hit = self._cache.get(name)
            if hit and hit[0] == stamp:
                return hit[1]
            data: Any = path.read_text(encoding="utf-8")
            if name.endswith(".json"):
                data = json.loads(data)
        except (OSError, ValueError):
            return None
        if name == "search-index.json":
            data = (data, prepare(data)) if isinstance(data, dict) else None
        self._cache[name] = (stamp, data)
        return data

    def server_info(self) -> dict:
        site = (self._load("ui-config.json") or {}).get("site") or {}
        title = site.get("title") or "Docs"
        return {"name": _slug(title), "title": title, "version": __version__}

    def instructions(self) -> str:
        return (f"Read-only access to the {self.server_info()['title']} documentation. search_docs finds "
                "pages and sections, read_page returns one page as Markdown, list_pages lists every page.")

    def card(self, site_url: str) -> dict:
        """The server card ``/.well-known/mcp`` serves."""
        info = self.server_info()
        return {
            **info,
            "description": f"Search and read the {info['title']} documentation.",
            "protocolVersion": PROTOCOL_VERSIONS[0],
            "serverInfo": info,
            "transport": {"type": "streamable-http", "url": site_url + ENDPOINT},
            "capabilities": {"tools": {"listChanged": False}},
            "authentication": {"required": False},
            "instructions": self.instructions(),
            "tools": TOOLS,
        }

    def page_markdown(self, path: str) -> Optional[str]:
        """A page's agent-ready Markdown, from its path or URL (``None`` when there is no such page)."""
        from praisonaiui.compiler.agent_markdown import page_md_path

        rel = urlsplit(path.strip()).path
        if self.base and (rel == self.base or rel.startswith(self.base + "/")):
            rel = rel[len(self.base) :]
        rel = rel.strip("/").removesuffix(".md").removesuffix(".source").removesuffix(".html").strip("/")
        docs = ((self._load("ui-config.json") or {}).get("site") or {}).get("routeBaseDocs") or "/docs"
        for candidate in (page_md_path("/" + rel, docs), f"/{rel}/index.md"):
            file = (self.root / candidate.lstrip("/")).resolve()
            if file.is_relative_to(self.root) and file.suffix == ".md" and file.is_file():
                return file.read_text(encoding="utf-8")
        return None

    def call_tool(self, name: str, args: dict, site_url: str) -> tuple[str, bool]:
        """Run a tool: its text and whether it is an error the model should see."""
        if name == "list_pages":
            text = self._load("llms.txt")
            return (text, False) if text else ("This site publishes no page list.", True)
        if name == "read_page":
            path = args.get("path")
            if not isinstance(path, str) or not path.strip():
                return "read_page needs a path, e.g. /docs/guide/install.", True
            text = self.page_markdown(path)
            return (text, False) if text is not None else (f"No page at {path}; search_docs or list_pages give page paths.", True)
        query, limit = args.get("query"), args.get("limit", 10)
        if not isinstance(query, str) or not query.strip():
            return "search_docs needs a query.", True
        if not isinstance(limit, int) or isinstance(limit, bool):
            return "limit must be a whole number.", True
        loaded = self._load("search-index.json")
        if not loaded:
            return "This site has no search index; list_pages lists every page.", True
        hits = search(loaded[0], query, min(max(limit, 1), MAX_RESULTS), loaded[1])
        if not hits:
            return f"No pages match {query!r}. Try other words, or list_pages.", False
        lines = []
        for n, r in enumerate(hits, 1):
            link = r["path"] + (f"#{r['anchor']}" if r["anchor"] else "")
            lines.append(f"{n}. {r['title']}" + (f" > {r['heading']}" if r["heading"] else ""))
            lines.append(f"   path: {link}\n   url: {site_url}{link}")
            lines += [f"   {r['snippet']}"] if r["snippet"] else []
        return "\n".join(lines) + "\n\nread_page(path) returns a page as Markdown.", False

    def answer(self, msg: Any, site_url: str) -> Optional[dict]:
        """The JSON-RPC reply to one message; ``None`` for a notification or a response."""
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            return _error(None, -32600, "Invalid Request: one JSON-RPC 2.0 message per POST")
        if "method" not in msg or "id" not in msg:
            return None
        rid, method, params = msg["id"], msg["method"], msg.get("params") or {}
        if not isinstance(params, dict):
            return _error(rid, -32602, "params must be an object")
        if method == "initialize":
            asked = params.get("protocolVersion")
            return _result(rid, {
                "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": self.server_info(),
                "instructions": self.instructions(),
            })
        if method == "ping":
            return _result(rid, {})
        if method == "tools/list":
            return _result(rid, {"tools": TOOLS})
        if method == "tools/call":
            name, args = params.get("name"), params.get("arguments") or {}
            if name not in _TOOL_NAMES:
                return _error(rid, -32602, f"Unknown tool: {name}")
            text, failed = self.call_tool(name, args if isinstance(args, dict) else {}, site_url)
            return _result(rid, {"content": [{"type": "text", "text": text}], "isError": failed})
        return _error(rid, -32601, f"Method not found: {method}")

    # -- HTTP -------------------------------------------------------------

    def _site_url(self, scope: dict) -> str:
        from praisonaiui.http_guard import header

        host = header(scope, b"host") or "localhost"
        return f"{scope.get('scheme', 'http')}://{host}{self.base}"

    async def serve(self, scope: dict, receive, send) -> bool:
        """Answer the MCP and discovery paths; ``False`` for any other request."""
        from starlette.responses import JSONResponse, PlainTextResponse, Response

        from praisonaiui.http_guard import (
            configured_hosts,
            configured_origins,
            header,
            host_allowed,
            origin_allowed,
        )

        path, method = scope.get("path", "/"), scope.get("method", "GET")
        if path not in (ENDPOINT, *CARD_PATHS, *LLMS_PATHS, "/ui-config.json"):
            return False
        no_cache = {"Cache-Control": "no-cache"}
        response: Response
        if not host_allowed(scope, configured_hosts()):  # DNS rebinding
            response = PlainTextResponse("Host not allowed", status_code=400)
        elif path == ENDPOINT:
            if method != "POST":
                response = PlainTextResponse("Method Not Allowed", 405, headers={"Allow": "POST"})
            elif not origin_allowed(scope, configured_origins() + self.origins):
                response = PlainTextResponse("Origin not allowed", status_code=403)
            elif header(scope, b"mcp-protocol-version") not in ("", *PROTOCOL_VERSIONS):
                response = PlainTextResponse("Unsupported MCP-Protocol-Version", status_code=400)
            elif not header(scope, b"content-type").lower().startswith("application/json"):
                response = PlainTextResponse("Send application/json", status_code=415)
            else:
                body = b""
                while True:
                    message = await receive()
                    body += message.get("body", b"")
                    if message["type"] == "http.disconnect" or not message.get("more_body") or len(body) > MAX_BODY_BYTES:
                        break
                if len(body) > MAX_BODY_BYTES:
                    response = PlainTextResponse("Request too large", status_code=413)
                else:
                    try:
                        msg = json.loads(body)
                    except ValueError:
                        response = JSONResponse(_error(None, -32700, "Parse error"), status_code=400)
                    else:
                        reply = self.answer(msg, self._site_url(scope))
                        response = JSONResponse(reply) if reply else Response(status_code=202)
        elif method not in ("GET", "HEAD"):
            return False
        elif path in CARD_PATHS:
            response = JSONResponse(self.card(self._site_url(scope)), headers=no_cache)
        elif path == "/ui-config.json":
            config = self._load("ui-config.json")
            if not isinstance(config, dict):
                return False
            mcp = {"url": ENDPOINT, "name": self.server_info()["name"]}
            response = JSONResponse({**config, "mcp": mcp}, headers=no_cache)
        else:
            text = self._load(path.lstrip("/"))
            if text is None:
                return False
            url = self._site_url(scope) + ENDPOINT
            title = self.server_info()["title"]
            text = (f"{text.rstrip()}\n\n## MCP server\n\n- [{title} MCP server]({url}): search and read "
                    "these docs from an AI tool (Streamable HTTP, read-only)\n")
            response = PlainTextResponse(text, headers=no_cache)
        await response(scope, receive, send)
        return True
