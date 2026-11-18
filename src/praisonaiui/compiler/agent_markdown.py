"""Agent-ready Markdown: what ``aiui build`` publishes at ``<route>.md`` and in ``llms-full.txt``.

The page source with its docs components turned into plain Markdown, front
matter as ``# Title`` and ``> description``, ``<Visibility for="agents">``
kept (``for="humans"`` dropped) and site links absolute, ``.md`` for pages.
Code is never changed. The browser renders the source, at ``<route>.source.md``.
See docs/features/ai-ready-docs.md.
"""

from __future__ import annotations

import posixpath
import re
from urllib.parse import urlparse

from praisonaiui.compiler.docs_tags import _prose_segments, heading_id, strip_comments

SOURCE_SUFFIX = ".source.md"

_FRONTMATTER = re.compile(r"\A﻿?---[ \t]*\r?\n.*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\Z)", re.S)
_SPAN = re.compile(r"(`+)[^\n]+?\1")
_VISIBILITY = re.compile(r"<Visibility\s+for=[\"'{]*(humans|agents)[\"'}]*\s*>(.*?)</Visibility>", re.S)
_ATTRS = r"(?:\s+[A-Za-z_$][\w:.$-]*(?:=(?:\"[^\"]*\"|'[^']*'|\{[^}]*\}|[^\s>\"'{]+))?)*"
_TAG = re.compile(rf"<(/?)([A-Z][A-Za-z0-9]*)({_ATTRS})\s*(/?)>")
_ATTR = re.compile(r"([A-Za-z_$][\w:.$-]*)(?:=(\"[^\"]*\"|'[^']*'|\{[^}]*\}|[^\s>\"'{]+))?")
_OPEN_TAG_START = re.compile(r"<[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?$")
_LINK = re.compile(r"(!?\[[^\]\n]*\]\()(<[^>\n]*>|[^)\s]+)")
_REF_DEF = re.compile(r"^(\s*\[[^\]\n]+\]:\s*)(\S+)", re.M)
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)

CALLOUTS = frozenset("Note Info Tip Check Warning Danger".split())
CONTAINERS = frozenset("Tabs Steps CardGroup AccordionGroup CodeGroup Frame Panel".split())
FIELD_IN = ("path", "query", "body", "header")


class _Code:
    """Fenced blocks and code spans swapped for placeholders while the prose is rewritten."""

    def __init__(self) -> None:
        self.parts: list[str] = []

    def mask(self, text: str) -> str:
        out: list[str] = []
        for code, chunk in _prose_segments(text):
            if not code:
                out.append(_SPAN.sub(self._keep_span, chunk))
                continue
            lines = chunk.rstrip("\n").split("\n")
            ind = len(lines[0]) - len(lines[0].lstrip(" "))
            self.parts.append("\n".join(line[min(ind, len(line) - len(line.lstrip(" "))) :] for line in lines))
            out.append(f"{' ' * ind}\x00{len(self.parts) - 1}\x00\n")
        return "".join(out)

    def _keep_span(self, m: re.Match[str]) -> str:
        self.parts.append(m.group(0))
        return f"\x01{len(self.parts) - 1}\x01"

    def unmask(self, text: str) -> str:
        def block(m: re.Match[str]) -> str:
            lead = m.group(1)
            return "\n".join(lead + line if line else lead.rstrip() for line in self.parts[int(m.group(2))].split("\n"))

        text = re.sub(r"^(.*?)\x00(\d+)\x00", block, text, flags=re.M)
        return re.sub(r"\x01(\d+)\x01", lambda m: self.parts[int(m.group(1))], text)


def visibility(text: str, audience: str, code: _Code | None = None) -> str:
    """``text`` for ``audience``: ``humans`` (the page, search) or ``agents`` (``.md``, llms files)."""
    if code is None:
        return (code := _Code()).unmask(visibility(code.mask(text), audience, code))
    return _VISIBILITY.sub(lambda m: m.group(2) if m.group(1) == audience else "", text)


def _attrs(raw: str) -> dict[str, str]:
    values = {}
    for name, value in _ATTR.findall(raw):
        value = value[1:-1].strip() if value[:1] == "{" else value
        values[name] = value[1:-1] if value[:1] in "\"'" and value[-1:] == value[:1] else (value or "true")
    return values


def _convert(lines: list[str]) -> list[str]:
    """Docs component tags to plain Markdown, line by line (code already masked)."""
    out: list[str] = []
    stack: list[dict] = []
    heading = 1
    cur = ""
    field: tuple[str, str] | None = None  # (prefix, "- `name` (…)"): joined to the field's first text

    def emit(text: str = "") -> None:
        nonlocal heading
        prefix = "".join(f["prefix"] for f in stack)
        if not text and field:
            return
        if not text:
            if out and out[-1] != prefix.rstrip():
                out.append(prefix.rstrip())
            return
        h = re.match(r"(#{1,6})\s", text)
        heading = len(h.group(1)) if h else heading
        out.append(prefix + text)

    def flush() -> None:
        nonlocal cur, field
        if field:
            out.append(field[0] + field[1] + (f": {cur.strip()}" if cur.strip() else ""))
            field, cur = None, ""
        if cur.strip():
            emit(cur.rstrip())
        cur = ""

    def titled(text: str) -> None:
        flush()
        emit()
        emit(text)
        emit()

    def close(name: str) -> None:
        at = next((k for k in range(len(stack) - 1, -1, -1) if stack[k]["name"] == name), None)
        if at is None:
            return
        flush()
        prefix = "".join(f["prefix"] for f in stack)
        if prefix.strip() and out and out[-1] == prefix.rstrip():
            out.pop()  # no empty quote line before the quote ends
        frame = stack[at]
        del stack[at:]
        if frame.get("caption"):
            emit(f"*{frame['caption']}*")
        if frame["block"]:
            emit()

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        joined = 0  # attributes over several lines: one tag
        while _OPEN_TAG_START.search(line) and i < len(lines) and joined < 20:
            line, i, joined = f"{line} {lines[i].strip()}", i + 1, joined + 1
        top = stack[-1] if stack else None
        if top and top["strip"] is None and line.strip():
            outer = sum(f["strip"] or 0 for f in stack[:-1])
            top["strip"] = max(0, len(line) - len(line.lstrip(" ")) - outer)
        strip = sum(f["strip"] or 0 for f in stack)
        line = line[min(strip, len(line) - len(line.lstrip(" "))) :]

        pos, had_text = 0, False
        for m in _TAG.finditer(line):
            text = line[pos : m.start()]
            pos = m.end()
            had_text = had_text or bool(text.strip())
            cur += text
            closing, name, a, self_closing = m.group(1) == "/", m.group(2), _attrs(m.group(3)), m.group(4) == "/"
            if not re.search("[a-z]", name):  # <DIV>, <B>: HTML, kept
                cur += m.group(0)
                continue
            if closing:
                close(name)
                continue
            frame = {"name": name, "prefix": "", "strip": None, "block": True}
            if name in CALLOUTS:
                flush()
                emit()
                stack.append({**frame, "prefix": "> "})
                if a.get("title"):
                    emit(f"**{name}: {a['title']}**")
                    emit()
                else:
                    cur = f"**{name}:** "
            elif name == "Tab":
                tabs = next((f for f in reversed(stack) if f["name"] == "Tabs"), None)
                titled("#" * (tabs["level"] if tabs else min(heading + 1, 6)) + " " + (a.get("title") or "Tab"))
                stack.append(frame)
            elif name == "Step":
                steps = next((f for f in reversed(stack) if f["name"] == "Steps"), None)
                n = steps["n"] = steps["n"] + 1 if steps else 1
                flush()
                emit()
                emit(f"{n}. **{a.get('title') or f'Step {n}'}**")
                stack.append({**frame, "prefix": "   "})
                emit()
            elif name == "Card":
                href, title = a.get("href"), a.get("title") or a.get("href") or "Card"
                flush()
                emit(f"- [{title}]({href})" if href else f"- **{title}**")
                stack.append({**frame, "prefix": "  ", "block": False})
            elif name in ("ParamField", "ResponseField"):
                at = next((k for k in FIELD_IN if k in a), None) if name == "ParamField" else None
                on = [k for k in ("required", "deprecated") if a.get(k, "false") != "false"]
                info = [x for x in (at, a.get("type"), *on) if x] + ([f"default: {a['default']}"] if a.get("default") else [])
                flush()
                field = ("".join(f["prefix"] for f in stack), f"- `{a.get(at or 'name', '')}`" + (f" ({', '.join(info)})" if info else ""))
                stack.append({**frame, "prefix": "  ", "block": False})
            elif name == "Expandable":  # its fields nest one level under the field it sits in
                flush()
                stack.append({**frame, "block": False})
            elif name in ("RequestExample", "ResponseExample"):
                titled(f"**{name[:-7]} example**")
                stack.append(frame)
            elif name == "Accordion":
                titled(f"**{a.get('title') or 'Details'}**")
                stack.append(frame)
            elif name in CONTAINERS:
                flush()
                emit()
                stack.append({**frame, "caption": a.get("caption"), "level": min(heading + 1, 6), "n": 0})
            elif not self_closing and not cur.strip() and not line[pos:].strip():
                stack.append({**frame, "block": False})  # unknown, alone on its line: its children stay
            if self_closing and stack and stack[-1]["name"] == name:
                close(name)
        rest = line[pos:]
        cur += rest
        if cur.strip():
            flush()
        elif not had_text and not rest.strip() and pos == 0:
            emit()  # a blank source line
        cur = ""
    flush()
    return out


def page_route(path: str) -> str:
    """A ``.md`` / ``.mdx`` file path's page route, as docs_scanner names pages."""
    if not re.search(r"\.mdx?$", path, re.I):
        return path
    route = re.sub(r"\.mdx?$", "", path, flags=re.I)
    route = re.sub(r"/(?:index|readme)$", "", route, flags=re.I)
    return re.sub(r"(^|/)\d+-", r"\1", route) or "/"


def page_md_path(route: str, docs_base: str = "/docs") -> str:
    """Where a page's Markdown is published: ``/docs/guide.md``; the docs home is ``/docs/index.md``."""
    base = docs_base.rstrip("/")
    route = route.rstrip("/") or "/"
    if route in ("/", base, f"{base}/index"):
        return f"{base}/index.md"
    return f"{route}.md"


def rewrite_target(target: str, page_dir: str, docs_base: str, site: str) -> str:
    """A link target as an absolute URL; one naming a page points at that page's ``.md``."""
    bracketed = target.startswith("<")
    t = target.strip("<>")
    if not t or t.startswith(("#", "//")) or _SCHEME.match(t):
        return target
    cut = min((k for k in (t.find("?"), t.find("#")) if k >= 0), default=len(t))
    path, tail = t[:cut], t[cut:]
    if not path.startswith("/"):
        path = posixpath.normpath(posixpath.join(page_dir or "/", path))
    base = docs_base.rstrip("/")
    last = path.rsplit("/", 1)[-1]
    in_docs = path == base or path.startswith(f"{base}/")
    if re.search(r"\.mdx?$", last, re.I) or path == "/" or (in_docs and "." not in last):
        path = page_md_path(page_route(path), docs_base)
    url = f"{site}{path}{tail}"
    return f"<{url}>" if bracketed else url


def instructions_block(instructions: str | list[str] | None) -> str:
    """``markdown.instructions`` as a ``> ## Agent instructions`` quote block ("" when unset)."""
    items = [instructions] if isinstance(instructions, str) else list(instructions or [])
    items = [s.strip() for s in items if s and s.strip()]
    if not items:
        return ""
    one = [f"> {line}".rstrip() for line in items[0].splitlines()]
    body = one if len(items) == 1 else [f"> - {item}" for item in items]
    return "\n".join(["> ## Agent instructions", ">", *body])


def to_agent_markdown(
    source: str,
    *,
    title: str,
    description: str = "",
    page_dir: str = "/docs",
    docs_base: str = "/docs",
    site: str = "",
    instructions: str | list[str] | None = None,
) -> str:
    """One page as agent-ready Markdown. ``page_dir``: the URL folder of its source
    file (relative links resolve there); ``site``: the site URL or base path links start with."""
    code = _Code()
    text = visibility(code.mask(strip_comments(_FRONTMATTER.sub("", source, count=1))), "agents", code)
    body = "\n".join(_convert(text.split("\n")))

    def link(m: re.Match[str]) -> str:
        return m.group(1) + rewrite_target(m.group(2), page_dir, docs_base, site)

    body = code.unmask(_REF_DEF.sub(link, _LINK.sub(link, body))).strip("\n")
    first, _, rest = body.partition("\n")
    if first.startswith("# ") and heading_id(first[2:])[0].strip().lower() == title.strip().lower():
        body = rest.lstrip("\n")
    head = [f"# {title}"]
    if description:
        head += ["", f"> {description}"]
    block = instructions_block(instructions)
    if block:
        head += ["", block]
    return "\n".join(head) + (f"\n\n{body}" if body else "") + "\n"


_ALTERNATE = re.compile(r'<link rel="alternate" type="text/markdown" href="([^"]+)"')


def prefers_markdown(accept: str) -> bool:
    """Whether an ``Accept`` header ranks ``text/markdown`` at least as high as ``text/html``."""
    q: dict[str, float] = {}
    for part in accept.lower().split(","):
        kind, _, params = (p.strip() for p in part.partition(";"))
        weight = re.search(r"\bq=([0-9.]+)", params)
        q[kind] = max(q.get(kind, 0.0), float(weight.group(1)) if weight else 1.0)
    return q.get("text/markdown", 0.0) > 0 and q["text/markdown"] >= q.get("text/html", 0.0)


def markdown_twin(html: str, base: str = "") -> str | None:
    """The app path of a built page's Markdown, from its alternate link (``/docs/guide.md``)."""
    m = _ALTERNATE.search(html)
    path = urlparse(m.group(1)).path if m else None
    return path[len(base) :] if path and base and path.startswith(base + "/") else path
