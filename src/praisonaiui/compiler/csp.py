"""Content-Security-Policy of a docs build (docs/features/content-security-policy.md).

The build knows everything its pages load: the app's own files, the inline
scripts it writes (allowed by their sha256), fonts, custom CSS/JS and
integrations (``Compiler.external_origins()``), video embeds, the Try-it
servers, the Ask AI and feedback endpoints and the GitHub stars API. From
that it makes one policy and writes it

* as ``<meta http-equiv="Content-Security-Policy">`` in every page it writes
  (enforced only: a meta tag cannot report, and browsers ignore
  ``frame-ancestors`` there);
* as a header in ``_headers`` (Netlify, Cloudflare Pages), with
  ``frame-ancestors``; ``aiui serve`` and ``aiui dev`` send its ``/*`` headers.

Styles keep ``'unsafe-inline'``: the app's components set inline styles and
add ``<style>`` elements at run time (code highlighting, diagrams, dialogs).
"""

from __future__ import annotations

import base64
import hashlib
import itertools
import re
from collections.abc import Iterable
from pathlib import Path

HEADERS_FILE = "_headers"
HEADER = "Content-Security-Policy"
REPORT_ONLY = "Content-Security-Policy-Report-Only"

#: The policy before the build adds what it uses (directive order is output order).
BASE: dict[str, list[str]] = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],  # Markdown images and badges from anywhere
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "media-src": ["'self'", "blob:", "https:"],
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
}
#: Directives a ``<meta>`` policy may not carry.
META_IGNORED = {"frame-ancestors", "report-uri", "sandbox"}
#: The players docs/embeds.ts plays inside the page.
EMBEDS = {
    re.compile(r"(?:youtube(?:-nocookie)?\.com|youtu\.be)/", re.I): "https://www.youtube-nocookie.com",
    re.compile(r"vimeo\.com/", re.I): "https://player.vimeo.com",
    re.compile(r"loom\.com/(?:share|embed)/", re.I): "https://www.loom.com",
}
#: Legacy ``site.plugins`` that load from a CDN.
PLUGINS = {
    "mermaid": {"script-src": ["https://cdn.jsdelivr.net"]},
    "syntax-highlight": {"script-src": ["https://cdnjs.cloudflare.com"], "style-src": ["https://cdnjs.cloudflare.com"]},
}
GITHUB_API = "https://api.github.com"

_SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.I | re.S)
_ATTR = re.compile(r"""\b(src|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
_RUNS = {"", "text/javascript", "application/javascript", "module", "importmap", "speculationrules"}
_SRC_ATTR = re.compile(r"""\bsrc\s*=\s*["']?(https?://[^"'\s>]+)""", re.I)
_CHARSET = re.compile(r"<meta\s+charset=[^>]*>\s*", re.I)
_HEAD = re.compile(r"<head\b[^>]*>", re.I)
_OLD_META = re.compile(r'\s*<meta http-equiv="Content-Security-Policy"[^>]*>', re.I)


def inline_hashes(html: str) -> set[str]:
    """``'sha256-…'`` of every inline script in ``html`` a browser runs (JSON
    data blocks such as JSON-LD are not run, so need none)."""
    out = set()
    for attrs, body in _SCRIPT.findall(html):
        found = {m.group(1).lower(): next(g for g in m.groups()[1:] if g is not None) for m in _ATTR.finditer(attrs)}
        if "src" in found or found.get("type", "").strip().lower() not in _RUNS:
            continue
        text = body.replace("\r\n", "\n").replace("\r", "\n")  # what the HTML parser hands the hash
        digest = base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()
        out.add(f"'sha256-{digest}'")
    return out


def embed_origins(text: str) -> set[str]:
    """The video players a page's ``src="…"`` URLs play in."""
    return {player for url in _SRC_ATTR.findall(text) for rx, player in EMBEDS.items() if rx.search(url)}


def server_origins(server: dict) -> set[str]:
    """Where Try it may send a request for an OpenAPI ``server`` (``{url, variables}``).
    A variable with ``enum`` is each of its values; a free one in the host is a
    ``*.`` wildcard when it is the first label, else any host of the scheme."""
    url = str(server.get("url") or "")
    variables = server.get("variables") or {}
    names = re.findall(r"\{([^}]+)\}", url)
    choices = [(variables.get(n) or {}).get("enum") or [None] for n in names]
    out = set()
    for combo in itertools.islice(itertools.product(*choices), 64):
        filled = url
        for name, value in zip(names, combo):
            filled = filled.replace(f"{{{name}}}", "\0" if value is None else str(value))
        if filled.startswith("\0"):  # the reader types the whole base URL
            out.add("https:")
            continue
        if not re.match(r"(?i)^(https?|wss?)://", filled):
            continue  # a relative server is this site ('self')
        scheme, rest = filled.split("://", 1)
        authority = re.split(r"[/?#]", rest, maxsplit=1)[0]
        name, _, port = authority.rpartition(":") if ":" in authority else (authority, "", "")
        port = ":*" if "\0" in port else f":{port}" if port else ""
        if "\0" not in name:
            out.add(f"{scheme.lower()}://{name}{port}")
        elif re.fullmatch(r"\0\.[^\0]+", name):
            out.add(f"{scheme.lower()}://*{name[1:]}{port}")
        else:
            out.add(f"{scheme.lower()}:")
    return out


def build(sources: dict[str, Iterable[str]], extra: dict[str, list[str]] | None = None) -> dict[str, list[str]]:
    """:data:`BASE` plus ``sources`` per directive, then ``extra`` (``site.csp``): its
    sources are added, or replace the directive's when they include ``'none'``."""
    policy = {d: list(v) for d, v in BASE.items()}
    for directive, values in [*sources.items(), *(extra or {}).items()]:
        values = list(values)
        if "'none'" in values:
            policy[directive] = ["'none'"]
            continue
        have = [v for v in policy.get(directive, []) if v != "'none'"]
        policy[directive] = have + sorted(set(values) - set(have))
    return policy


def render(policy: dict[str, list[str]], meta: bool = False) -> str:
    """The header value (``meta``: without the directives a meta tag may not carry)."""
    return "; ".join(
        " ".join([d, *v]) for d, v in policy.items() if not (meta and d in META_IGNORED)
    )


def patch_page(html: str, value: str) -> str:
    """``html`` with the policy as the second element of ``<head>``, after
    ``<meta charset>`` (moved first), so it covers every script that follows."""
    head = _HEAD.search(html)
    if not head:
        return html
    html = _OLD_META.sub("", html)
    charset = _CHARSET.search(html, head.end())
    tag = charset.group(0).strip() if charset else ""
    if charset:
        html = html[: charset.start()] + html[charset.end():]
    escaped = value.replace("&", "&amp;").replace('"', "&quot;")
    lead = (f"\n  {tag}" if tag else "") + f'\n  <meta http-equiv="{HEADER}" content="{escaped}" />'
    return html[: head.end()] + lead + html[head.end():]


def headers_file(name: str, value: str) -> str:
    """``_headers`` (Netlify / Cloudflare Pages format) sending the policy on every path."""
    return f"/*\n  {name}: {value}\n"


def site_headers(root: Path) -> list[tuple[bytes, bytes]]:
    """The ``/*`` headers of a build's ``_headers`` file (what ``aiui serve`` sends)."""
    try:
        lines = (root / HEADERS_FILE).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out, active = [], False
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            active = line.strip() == "/*"
        elif active and ":" in line:
            name, value = line.strip().split(":", 1)
            out.append((name.strip().lower().encode("latin-1"), value.strip().encode("latin-1")))
    return out
