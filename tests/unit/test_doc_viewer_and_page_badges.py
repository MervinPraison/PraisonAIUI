"""Tests for markdown_text(toc=...), doc_viewer(), and sidebar page badges."""

from __future__ import annotations

from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.server as srv


def test_markdown_text_and_doc_viewer_shapes():
    plain = aiui.markdown_text("# Hello")
    assert plain == {"type": "markdown_text", "content": "# Hello"}
    assert "toc" not in plain and "title" not in plain

    with_toc = aiui.markdown_text("## One\n\nBody", toc=True, title="Guide")
    assert with_toc == {
        "type": "markdown_text",
        "content": "## One\n\nBody",
        "toc": True,
        "title": "Guide",
    }

    dv = aiui.doc_viewer("## Intro\n\nText", title="Manual")
    assert dv == {
        "type": "markdown_text",
        "content": "## Intro\n\nText",
        "toc": True,
        "title": "Manual",
    }
    assert "doc_viewer" in aiui.__all__


def test_page_badges_static_callable_and_error_safe():
    srv.reset_state()
    counter = {"n": 3}
    try:

        @aiui.page("inbox-static", title="Inbox", badge=7)
        async def inbox_static():
            return aiui.layout([aiui.text("ok")])

        @aiui.page("queue-live", title="Queue", badge=lambda: counter["n"])
        async def queue_live():
            return aiui.layout([aiui.text("ok")])

        @aiui.page("broken-badge", title="Broken", badge=lambda: 1 / 0)
        async def broken_badge():
            return aiui.layout([aiui.text("ok")])

        app = srv.create_app()
        client = TestClient(app)

        m1 = client.get("/api/shell/manifest").json()
        by_id = {p["id"]: p for p in m1["pages"]}
        assert by_id["inbox-static"]["badge"] == "7"
        assert by_id["queue-live"]["badge"] == "3"
        assert "badge" not in by_id["broken-badge"]

        # Dynamic badge updates on subsequent manifest reads without mutating /api/pages.
        counter["n"] = 12
        m2 = client.get("/api/shell/manifest").json()
        by_id2 = {p["id"]: p for p in m2["pages"]}
        assert by_id2["queue-live"]["badge"] == "12"

        # Legacy /api/pages remains valid JSON (callable never leaked into _pages).
        api_pages = client.get("/api/pages")
        assert api_pages.status_code == 200
        assert any(p["id"] == "queue-live" for p in api_pages.json()["pages"])
    finally:
        srv.reset_state()
