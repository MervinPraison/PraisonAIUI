"""A real browser reloading a page URL gets the page (dashboard and app).

``GET /sessions`` and ``GET /agents`` are JSON APIs as well as page URLs. The
dashboard pushes ``/<page id>`` into the address bar, so a reload or a pasted
link used to show raw JSON. A real server and Chromium's own request
headers (``Sec-Fetch-Mode: navigate`` for the page, ``cors`` for the view's
``fetch``) check the real negotiation.
Skipped when Playwright or its Chromium is not installed.
"""

from __future__ import annotations

import contextlib
import socket
import threading
import time

import pytest

import praisonaiui.config_store as config_store
import praisonaiui.server as srv


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


@contextlib.contextmanager
def _serve(app):
    """Run *app* on a free loopback port (real HTTP, streams included)."""
    import uvicorn

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


@pytest.mark.parametrize("style", ["dashboard", "app"])
def test_reloading_a_page_url_shows_the_page_in_chromium(style):
    sync_api = pytest.importorskip("playwright.sync_api")
    srv.set_style(style)
    with _serve(srv.create_app()) as base, sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # noqa: BLE001
            pytest.skip(f"chromium unavailable: {exc}")
        try:
            page = browser.new_page()
            for path in ("/sessions", "/agents"):
                res = page.goto(base + path, wait_until="domcontentloaded")
                assert res is not None and res.headers["content-type"].startswith("text/html")
                res = page.reload(wait_until="domcontentloaded")
                assert res is not None and res.headers["content-type"].startswith("text/html")
                assert not page.inner_text("body").lstrip().startswith("{"), path
            if style == "dashboard":
                # the Sessions view's own fetch('/sessions') still gets JSON
                with page.expect_response(
                    lambda r: r.url == f"{base}/sessions" and r.request.resource_type == "fetch"
                ) as api:
                    page.goto(base + "/sessions", wait_until="domcontentloaded")
                assert api.value.headers["content-type"].startswith("application/json")
                assert "sessions" in api.value.json()
        finally:
            browser.close()
