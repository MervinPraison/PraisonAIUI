"""Regression tests for #322 — Chat must fill the dashboard main column.

Chat pages declare ``layout: "full-bleed"``; ``selectPage()`` then adds
``db-fill`` to ``#db-main-content`` and skips the duplicate page header, and
``.chat-root`` sizes from flex allocation instead of ``calc(100vh - 140px)``.
"""

from __future__ import annotations

import re
from pathlib import Path

PLUGINS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)


def _select_page_body() -> str:
    src = (PLUGINS / "dashboard.js").read_text(encoding="utf-8")
    m = re.search(r"async function selectPage\(pageId\)\s*\{(.*?)^}", src, re.DOTALL | re.MULTILINE)
    assert m
    return m.group(1)


def test_chat_pages_declare_full_bleed():
    from starlette.testclient import TestClient

    from praisonaiui.server import create_app

    pages = {p["id"]: p for p in TestClient(create_app()).get("/api/pages").json()["pages"]}
    for pid in ("chat", "chat-canvas"):
        if pid in pages:
            assert pages[pid].get("layout") == "full-bleed"
    if "overview" in pages:
        assert pages["overview"].get("layout") is None


def test_select_page_toggles_fill_and_skips_header():
    body = _select_page_body()
    assert "page.layout === 'full-bleed'" in body
    assert "classList.toggle('db-fill'" in body
    assert re.search(r"showPageHeader = .*&& !fullBleed", body)


def test_fill_css_defined():
    src = (PLUGINS / "dashboard.js").read_text(encoding="utf-8")
    assert ".db-main.db-fill > #db-page-content" in src


def test_chat_root_fills_column_in_fill_mode():
    chat = (PLUGINS / "views" / "chat.js").read_text(encoding="utf-8")
    assert re.search(r"\.db-fill \.chat-root \{[^}]*flex:1;[^}]*min-height:0", chat)
    canvas = (PLUGINS / "views" / "chat-canvas.js").read_text(encoding="utf-8")
    assert ".db-fill .chat-canvas-root" in canvas
