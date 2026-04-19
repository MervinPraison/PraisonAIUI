"""Tests for aiui.set_custom_js(path) — user-side client extension injection.

This closes the gap documented in how-to-add-a-feature.md: previously,
users had no way to load plugin JS (e.g. registerComponent / registerView)
from their Python app without modifying the package's frontend bundle.
"""

from __future__ import annotations

import pytest
from pathlib import Path
from starlette.testclient import TestClient

from praisonaiui import server as srv
from praisonaiui.datastore import MemoryDataStore


@pytest.fixture(autouse=True)
def _clean_state():
    srv.reset_state()
    srv.set_datastore(MemoryDataStore())
    yield
    srv.reset_state()


@pytest.fixture
def client():
    return TestClient(srv.create_app())


@pytest.fixture
def tmp_js(tmp_path: Path):
    p = tmp_path / "plugin.js"
    p.write_text(
        "console.log('custom plugin loaded');\n"
        "if (window.aiui) { window.aiui.registerComponent('x', c => "
        "document.createTextNode('hi')); }\n"
    )
    return p


# ── Python API surface ────────────────────────────────────────────

class TestSetCustomJsAPI:
    def test_set_custom_js_is_exported(self):
        import praisonaiui as aiui
        assert callable(aiui.set_custom_js), (
            "aiui.set_custom_js must be publicly exported"
        )

    def test_set_custom_js_accepts_path(self, tmp_js):
        srv.set_custom_js(str(tmp_js))
        # Should be read and stored
        assert srv._custom_js is not None

    def test_set_custom_js_accepts_path_object(self, tmp_js):
        srv.set_custom_js(tmp_js)  # pathlib.Path
        assert srv._custom_js is not None

    def test_reset_state_clears_custom_js(self, tmp_js):
        srv.set_custom_js(tmp_js)
        srv.reset_state()
        assert srv._custom_js is None

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises((FileNotFoundError, OSError)):
            srv.set_custom_js(tmp_path / "does-not-exist.js")


# ── Served content ────────────────────────────────────────────────

class TestCustomJsServing:
    def test_custom_js_route_serves_content(self, tmp_js, client):
        srv.set_custom_js(tmp_js)
        # Recreate app to pick up the route
        app = srv.create_app()
        c = TestClient(app)
        resp = c.get("/custom.js")
        assert resp.status_code == 200
        assert "custom plugin loaded" in resp.text
        assert resp.headers["content-type"].startswith("application/javascript") \
            or resp.headers["content-type"].startswith("text/javascript")

    def test_custom_js_not_served_when_unset(self, client):
        resp = client.get("/custom.js")
        assert resp.status_code == 404

    def test_index_injects_script_tag_when_set(self, tmp_js):
        srv.set_custom_js(tmp_js)
        srv.set_style("dashboard")
        app = srv.create_app()
        c = TestClient(app)
        resp = c.get("/")
        assert resp.status_code == 200
        # Script tag with our endpoint must be present
        assert "/custom.js" in resp.text, (
            "set_custom_js() must inject <script src='/custom.js'> into the HTML"
        )
        # Must be a <script src=...> tag (not accidentally inside a CSS/other block)
        assert '<script' in resp.text and 'src="/custom.js' in resp.text

    def test_index_no_script_tag_when_unset(self, client):
        srv.set_style("dashboard")
        app = srv.create_app()
        c = TestClient(app)
        resp = c.get("/")
        assert resp.status_code == 200
        assert "/custom.js" not in resp.text

    def test_script_injected_after_plugin_loader(self, tmp_js):
        """User JS should load AFTER plugin-loader.js so window.aiui exists."""
        srv.set_custom_js(tmp_js)
        srv.set_style("dashboard")
        app = srv.create_app()
        c = TestClient(app)
        html = c.get("/").text
        loader_idx = html.find("plugin-loader.js")
        custom_idx = html.find("/custom.js")
        assert loader_idx != -1, "plugin-loader.js must be present"
        assert custom_idx > loader_idx, (
            "custom.js must be injected AFTER plugin-loader.js so window.aiui "
            "APIs are available when custom.js runs"
        )
