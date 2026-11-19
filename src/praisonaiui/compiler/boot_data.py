"""Fewer requests before a built page can draw (docs/getting-started/github-pages.md#first-load).

The docs app needs ``ui-config.json``, ``docs-nav.json`` and ``route-manifest.json``
before it shows anything. ``aiui build`` puts the last two in every page it writes, as
one JSON script keyed by URL (``<script type="application/json" id="aiui-boot-data">``),
the way it inlines the page's own Markdown: ``docs/docLoader.ts`` ``inlinedManifest``
reads it, and so does the legacy ``nav-intercept`` plugin. ``ui-config.json`` is not
inlined, because a live server answers it with more than the build wrote (``aiui serve``
adds Ask AI, MCP and feedback; ``create_app`` builds its own), so the page preloads it
instead: the request starts with the HTML rather than after the app's code has run.

Left out: a file over :data:`MAX_BYTES` (every page would carry it, while the request is
cached once) and the nav of a site with ``content.docs.auth`` (``docs_auth.py`` cuts it
to what each reader may read). The files are still written for servers, older bundles
and other readers. A JSON script is data, not code, so the CSP needs no hash for it;
``http_guard.strip_page_content`` removes it with the page's other content.
"""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.utils import json_for_html

#: The element's id (docs/docLoader.ts BOOT_DATA_ID).
ID = "aiui-boot-data"
#: Files inlined, by name in the build's root.
FILES = ("docs-nav.json", "route-manifest.json")
#: Largest file inlined (its compact JSON); a bigger one is fetched as before.
MAX_BYTES = 100_000
#: Requested as the page loads, not inlined (see above).
PRELOAD = "/ui-config.json"
_ROOT = '<div id="root"></div>'


def script(output_dir: Path, *, private_nav: bool = False) -> str:
    """The JSON script for the build in ``output_dir`` ("" when nothing is inlined)."""
    data = {}
    for name in FILES:
        if name == "docs-nav.json" and private_nav:
            continue
        try:
            value = json.loads((output_dir / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if len(json_for_html(value).encode("utf-8")) <= MAX_BYTES:
            data["/" + name] = value
    return f'<script type="application/json" id="{ID}">{json_for_html(data)}</script>' if data else ""


def preload_link() -> str:
    """``<link rel="preload">`` for :data:`PRELOAD`; ``fetch()`` from the app takes it over."""
    return f'<link rel="preload" href="{PRELOAD}" as="fetch" crossorigin>'


def patch_head(html: str) -> str:
    """``html`` with :func:`preload_link` before ``</head>`` (once)."""
    if f'href="{PRELOAD}" as="fetch"' in html or "</head>" not in html:
        return html
    return html.replace("</head>", f"  {preload_link()}\n</head>", 1)


def patch_body(html: str, block: str) -> str:
    """``html`` with ``block`` right after ``<div id="root"></div>`` (once; no root: unchanged)."""
    if not block or f'id="{ID}"' in html or _ROOT not in html:
        return html
    return html.replace(_ROOT, f"{_ROOT}\n  {block}", 1)
