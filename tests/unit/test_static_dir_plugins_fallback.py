"""A stale docs build in static_dir must not hide packaged plugins (#424).

``aiui run app.py`` passes ``./aiui`` as static_dir when it exists; a docs
``aiui build`` there ships a plugins/ tree without dashboard.js.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _reset_style():
    prev = srv._style
    yield
    srv._style = prev


@pytest.fixture
def docs_build(tmp_path):
    site = tmp_path / "aiui"
    (site / "plugins").mkdir(parents=True)
    (site / "plugins" / "topnav.js").write_text("/* docs topnav */")
    (site / "plugins" / "plugin-loader.js").write_text("/* stale loader */")
    (site / "index.html").write_text("<p>docs</p>")
    return site


def test_missing_plugin_falls_back_to_package(docs_build):
    client = TestClient(create_app(static_dir=docs_build))
    r = client.get("/plugins/dashboard.js")
    assert r.status_code == 200
    assert "buildDashboard" in r.text


def test_static_dir_plugin_still_overrides(docs_build):
    client = TestClient(create_app(static_dir=docs_build))
    assert client.get("/plugins/topnav.js").text == "/* docs topnav */"
    assert client.get("/plugins/plugin-loader.js").text == "/* stale loader */"


def test_unknown_plugin_still_404(docs_build):
    client = TestClient(create_app(static_dir=docs_build), raise_server_exceptions=False)
    assert client.get("/plugins/nope-does-not-exist.js").status_code == 404
