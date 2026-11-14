"""The static_dir catch-all must never serve a file outside static_dir.

Uvicorn decodes ``%2f`` to ``/`` before the app sees the path, and the
catch-all is public in every auth mode, so an uncontained lookup is an
unauthenticated arbitrary file read (``aiui run`` always passes static_dir).
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.server import create_app

SECRET = "TOP-SECRET-OUTSIDE-STATIC-DIR"


@pytest.fixture(autouse=True)
def _reset_style():
    prev = srv._style
    yield
    srv._style = prev


@pytest.fixture
def static_tree(tmp_path):
    (tmp_path / "secret.txt").write_text(SECRET)
    (tmp_path / "secret.html").write_text(SECRET)
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "index.html").write_text(SECRET)
    site = tmp_path / "site"
    site.mkdir()
    (site / "hello.txt").write_text("hello inside")
    (site / "page.html").write_text("<p>page inside</p>")
    (site / "sub").mkdir()
    (site / "sub" / "index.html").write_text("<p>sub index</p>")
    return site


TRAVERSALS = [
    "/..%2fsecret.txt",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2fsecret.txt",
    "/..%2fsecret",
    "/..%2foutside/",
    "/sub/..%2f..%2fsecret.txt",
]


@pytest.mark.parametrize("path", TRAVERSALS)
def test_traversal_never_returns_outside_file(static_tree, path):
    client = TestClient(create_app(static_dir=static_tree), raise_server_exceptions=False)
    r = client.get(path)
    assert SECRET not in r.text


@pytest.mark.parametrize("path", TRAVERSALS)
def test_traversal_blocked_under_auth_enforce(static_tree, monkeypatch, path):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(create_app(static_dir=static_tree), raise_server_exceptions=False)
    r = client.get(path)
    assert SECRET not in r.text


def test_files_inside_static_dir_still_served(static_tree):
    client = TestClient(create_app(static_dir=static_tree), raise_server_exceptions=False)
    assert client.get("/hello.txt").text == "hello inside"
    assert "page inside" in client.get("/page").text
    assert "sub index" in client.get("/sub/").text
