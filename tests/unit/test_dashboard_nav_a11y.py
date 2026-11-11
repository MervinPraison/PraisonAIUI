"""Regression tests for #342 — dashboard sidebar navigation keyboard semantics.

Sidebar entries were clickable ``div``s: not focusable, no role, and the
current page was only a CSS class. They are now native links (pages) or
buttons (actions such as the Inspector) with ``aria-current`` kept in sync.
"""

from __future__ import annotations

import re
from pathlib import Path

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "dashboard.js"
)


def _src() -> str:
    return DASHBOARD_JS.read_text(encoding="utf-8")


def _fn(name: str) -> str:
    m = re.search(rf"function {name}\([^)]*\)\s*\{{(.*?)^}}", _src(), re.DOTALL | re.MULTILINE)
    assert m, f"{name} not found"
    return m.group(1)


def test_nav_items_are_not_divs():
    src = _src()
    assert not re.search(
        r"createElement\('div'\);\s*\n\s*\w+\.className = 'db-nav-item'", src
    ), "db-nav-item must not be a clickable div"


def test_nav_entry_uses_link_or_button():
    body = _fn("navEntry")
    assert "onAction ? 'button' : 'a'" in body
    assert "el.href = '/' + encodeURIComponent(page.id)" in body
    assert "el.type = 'button'" in body


def test_nav_link_keeps_modified_clicks_native():
    body = _fn("navEntry")
    assert "e.preventDefault()" in body
    for mod in ("metaKey", "ctrlKey", "shiftKey", "altKey", "e.button !== 0"):
        assert mod in body


def test_sidebar_and_footer_use_nav_entry():
    body = _fn("buildSidebar")
    assert "navEntry(page, '📄')" in body
    assert "navEntry(page, '⚙', page.id === 'inspector' ? showTestPanel : null)" in body


def test_select_page_syncs_aria_current():
    m = re.search(r"async function selectPage\(pageId\)\s*\{(.*?)^}", _src(), re.DOTALL | re.MULTILINE)
    assert m
    body = m.group(1)
    assert "setAttribute('aria-current', 'page')" in body
    assert "removeAttribute('aria-current')" in body


def test_focus_visible_and_closed_drawer_hidden():
    src = _src()
    assert ".db-nav-item:focus-visible" in src
    assert re.search(r"\.db-sidebar \{ position: fixed !important;[^}]*visibility: hidden", src)
    assert re.search(r"\.db-sidebar\.db-sidebar-open \{[^}]*visibility: visible", src)
