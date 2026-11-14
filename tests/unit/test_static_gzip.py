"""Static code is sent gzip-compressed; streams and ranges are left alone."""

from __future__ import annotations

import gzip

import pytest
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.server import create_app, gzip_static


@pytest.fixture(autouse=True)
def _reset_style():
    prev = srv._style
    yield
    srv._style = prev


GZ = {"Accept-Encoding": "gzip, br"}


def test_plugins_mount_is_gzipped():
    c = TestClient(create_app())
    r = c.get("/plugins/dashboard.js", headers=GZ)
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "Accept-Encoding" in r.headers.get("vary", "")
    raw = c.get("/plugins/dashboard.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in raw.headers
    assert r.content == raw.content  # httpx decodes; same bytes either way


def test_assets_mount_is_gzipped_and_keeps_cache_headers():
    assets = srv._frontend_templates_dir() / "assets"
    js = sorted(p for p in assets.glob("*.js") if p.stat().st_size > 4096)
    if not js:
        pytest.skip("no built frontend assets")
    c = TestClient(create_app())
    r = c.get(f"/assets/{js[0].name}", headers=GZ)
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert r.headers.get("cache-control")


def test_small_files_and_ranges_are_not_compressed(tmp_path):
    (tmp_path / "small.js").write_text("x=1")
    (tmp_path / "big.js").write_text("console.log('hello world');\n" * 500)
    app = Starlette(routes=[Mount("/s", app=gzip_static(StaticFiles(directory=str(tmp_path))))])
    c = TestClient(app)
    assert "content-encoding" not in c.get("/s/small.js", headers=GZ).headers
    big = c.get("/s/big.js", headers=GZ)
    assert big.headers.get("content-encoding") == "gzip"
    part = c.get("/s/big.js", headers={**GZ, "Range": "bytes=0-9"})
    assert part.status_code == 206
    assert "content-encoding" not in part.headers
    assert part.content == b"console.lo"


def test_gzip_payload_is_valid(tmp_path):
    body = "body{color:red}\n" * 400
    (tmp_path / "a.css").write_text(body)
    app = Starlette(routes=[Mount("/s", app=gzip_static(StaticFiles(directory=str(tmp_path))))])
    c = TestClient(app)
    with c.stream("GET", "/s/a.css", headers=GZ) as r:
        compressed = b"".join(r.iter_raw())
    assert r.headers.get("content-encoding") == "gzip"
    assert gzip.decompress(compressed).decode() == body
    assert len(compressed) < len(body) // 5
