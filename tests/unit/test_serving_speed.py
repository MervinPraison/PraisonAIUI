"""Serving speed: what the server sends, and how often it redoes the work.

- ``aiui run app.py`` (a chat app) no longer recopies the 11 MB bundle into
  ./aiui on every start; the package bundle is served directly.
- A built site served by ``aiui run --config`` (``static_dir``) is gzipped
  and sent ``no-cache`` like ``aiui serve``, and its own ``/assets/theme.css``
  is found.
- Static files are compressed once per (path, mtime, size), off the event
  loop, instead of on every request.
- Page HTML, ``/api/pages``, ``/api/shell/manifest`` and dashboard-plugin
  files are compressed; plugin discovery does not reparse every manifest.
- ``aiui serve`` answers ``/docs/x`` without a 307 to ``/docs/x/``.
"""

from __future__ import annotations

import gzip
import os
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui import _run_factory, dashboard_plugins, static_gzip

GZ = {"Accept-Encoding": "gzip"}
PKG_ASSETS = Path(srv.__file__).parent / "templates" / "frontend" / "assets"

APP = """
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say("hi")
"""


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setenv(_run_factory.SPEC_ENV, "")
    monkeypatch.delenv(_run_factory.SPEC_ENV)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    static_gzip.clear_cache()
    srv.reset_state()
    yield
    srv.reset_state()


def _encoding(resp) -> str | None:
    return resp.headers.get("content-encoding")


def _hashed_chunk() -> Path:
    big = [p for p in PKG_ASSETS.glob("*-*.js") if p.stat().st_size > 20_000]
    return max(big, key=lambda p: p.stat().st_size)


# ── aiui run: no bundle copy ─────────────────────────────────────────


def _run_app(tmp_path, monkeypatch, *extra: str):
    import uvicorn

    app_file = tmp_path / "proj" / "app.py"
    app_file.parent.mkdir(exist_ok=True)
    app_file.write_text(APP)
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda target, **kw: calls.append(target))
    result = CliRunner().invoke(
        __import__("praisonaiui.cli", fromlist=["app"]).app,
        ["run", str(app_file), "--datastore", "memory", "--port", "8204", *extra],
    )
    assert result.exit_code == 0, result.output
    return app_file.parent, calls[-1]


def test_run_does_not_copy_the_bundle_and_still_serves_it(tmp_path, monkeypatch):
    proj, app = _run_app(tmp_path, monkeypatch)
    assert not (proj / "aiui").exists()
    client = TestClient(app)
    assert client.get("/assets/index.js").status_code == 200
    assert client.get("/plugins/dashboard.js").status_code == 200
    assert client.get("/icon.svg").status_code == 200
    assert client.get("/ui-config.json").json()["style"] == "app"
    assert client.get("/chat", headers={"Accept": "text/html"}).status_code == 200


def test_run_ignores_a_stale_bundle_copy(tmp_path, monkeypatch):
    stale = tmp_path / "proj" / "aiui" / "plugins"
    stale.mkdir(parents=True)
    (stale / "dashboard.js").write_text("/* STALE COPY */")
    _proj, app = _run_app(tmp_path, monkeypatch)
    body = TestClient(app).get("/plugins/dashboard.js").text
    assert "STALE COPY" not in body


# ── static_dir (aiui run --config): gzip, Cache-Control, site assets ─


@pytest.fixture
def site(tmp_path) -> Path:
    root = tmp_path / "site"
    (root / "assets").mkdir(parents=True)
    (root / "docs" / "x").mkdir(parents=True)
    (root / "index.html").write_text("<html><body>" + "home " * 400 + "</body></html>")
    (root / "docs" / "x.html").write_text("<html><body>" + "page x " * 400 + "</body></html>")
    (root / "docs" / "x" / "index.html").write_text("<html>dir</html>")
    (root / "search-index.json").write_text('{"docs": [' + ",".join(['"entry"'] * 800) + "]}")
    (root / "assets" / "theme.css").write_text(":root{--x:1}" * 200)
    return root


def test_static_dir_files_are_gzipped_and_revalidated(site):
    srv.set_style("docs")
    client = TestClient(srv.create_app(static_dir=site))
    resp = client.get("/search-index.json", headers=GZ)
    assert resp.status_code == 200
    assert _encoding(resp) == "gzip"
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.json()["docs"][0] == "entry"
    page = client.get("/docs/x", headers=GZ)
    assert page.status_code == 200 and "page x" in page.text
    assert _encoding(page) == "gzip"
    plain = client.get("/search-index.json", headers={"Accept-Encoding": "identity"})
    assert _encoding(plain) is None


def test_static_dir_own_assets_are_served_after_the_package_ones(site):
    srv.set_style("docs")
    client = TestClient(srv.create_app(static_dir=site))
    assert client.get("/assets/theme.css").status_code == 200
    assert client.get("/assets/index.js").status_code == 200  # package bundle first


# ── cached gzip for static files ─────────────────────────────────────


def test_hashed_chunk_is_compressed_once(monkeypatch):
    calls = []
    real = gzip.compress
    monkeypatch.setattr(
        static_gzip.gzip, "compress", lambda data, **kw: calls.append(1) or real(data, **kw)
    )
    chunk = _hashed_chunk()
    client = TestClient(srv.create_app())
    url = f"/assets/{chunk.name}"
    first = client.get(url, headers=GZ)
    second = client.get(url, headers=GZ)
    assert first.status_code == second.status_code == 200
    assert _encoding(first) == _encoding(second) == "gzip"
    assert first.content == second.content == chunk.read_bytes()
    assert "immutable" in first.headers["cache-control"]
    assert first.headers["etag"]
    assert len(calls) == 1


def test_range_head_and_conditional_requests_stay_identity():
    chunk = _hashed_chunk()
    client = TestClient(srv.create_app())
    url = f"/assets/{chunk.name}"
    part = client.get(url, headers={**GZ, "Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert _encoding(part) is None
    etag = client.get(url, headers=GZ).headers["etag"]
    assert client.get(url, headers={**GZ, "If-None-Match": etag}).status_code == 304
    assert client.head(url, headers=GZ).status_code == 200


def test_a_changed_file_is_compressed_again(tmp_path):
    f = tmp_path / "a.js"
    f.write_text("x" * 5000)
    st = f.stat()
    one = static_gzip.gzip_file(str(f), st.st_mtime_ns, st.st_size)
    f.write_text("y" * 6000)
    st = f.stat()
    two = static_gzip.gzip_file(str(f), st.st_mtime_ns, st.st_size)
    assert gzip.decompress(one) == b"x" * 5000
    assert gzip.decompress(two) == b"y" * 6000


# ── HTML / JSON / dashboard-plugin files ─────────────────────────────


@pytest.mark.parametrize("style", ["dashboard", "app"])
def test_page_html_and_json_are_compressed(style):
    srv.set_style(style)
    client = TestClient(srv.create_app())
    for path in ("/api/pages", "/api/shell/manifest"):
        resp = client.get(path, headers=GZ)
        assert resp.status_code == 200, path
        assert _encoding(resp) == "gzip", path
        assert resp.json()
    page = client.get("/", headers={**GZ, "Accept": "text/html"})
    assert _encoding(page) == "gzip" and "<html" in page.text
    plain = client.get("/api/pages", headers={"Accept-Encoding": "identity"})
    assert _encoding(plain) is None and plain.json()["pages"]


def test_dashboard_plugin_files_are_compressed_and_revalidated():
    client = TestClient(srv.create_app())
    resp = client.get("/dashboard-plugins/video-studio/index.js", headers=GZ)
    assert resp.status_code == 200
    assert _encoding(resp) == "gzip"
    assert resp.headers["cache-control"] == "no-cache"


def test_plugin_discovery_reads_each_manifest_once(tmp_path, monkeypatch):
    plug = tmp_path / "plugins" / "demo"
    plug.mkdir(parents=True)
    manifest = plug / "manifest.json"
    manifest.write_text('{"name": "demo", "label": "Demo"}')
    monkeypatch.setattr(dashboard_plugins, "_children_cache", {})
    monkeypatch.setattr(dashboard_plugins, "_manifest_cache", {})
    reads: list[str] = []
    real = Path.read_text

    def counting(self, *a, **kw):
        if self.name == "manifest.json":
            reads.append(str(self))
        return real(self, *a, **kw)

    monkeypatch.setattr(Path, "read_text", counting)
    extra = [str(tmp_path / "plugins")]
    first = dashboard_plugins.discover_dashboard_plugins(extra)
    second = dashboard_plugins.discover_dashboard_plugins(extra)
    assert first == second
    assert reads.count(str(manifest)) == 1
    # an edited manifest is read again
    manifest.write_text('{"name": "demo", "label": "Demo 2"}')
    os.utime(manifest, ns=(1, 2_000_000_000_000_000_000))
    labels = {m["name"]: m["label"] for m in dashboard_plugins.discover_dashboard_plugins(extra)}
    assert labels["demo"] == "Demo 2"
    # a new plugin folder is found
    (tmp_path / "plugins" / "other").mkdir()
    (tmp_path / "plugins" / "other" / "manifest.json").write_text('{"name": "other"}')
    os.utime(tmp_path / "plugins", ns=(1, 2_000_000_000_000_000_001))
    names = {m["name"] for m in dashboard_plugins.discover_dashboard_plugins(extra)}
    assert {"demo", "other"} <= names


# ── aiui serve: canonical URLs answer directly ───────────────────────


def test_serve_answers_canonical_docs_urls_without_a_redirect(site):
    from praisonaiui.cli import _static_site_app

    client = TestClient(_static_site_app(site), follow_redirects=False)
    resp = client.get("/docs/x", headers=GZ)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "page x" in resp.text
    assert resp.headers["cache-control"] == "no-cache"
    assert _encoding(resp) == "gzip"
    assert client.get("/docs/x/").status_code == 200
    assert "home" in client.get("/no/such/page").text  # SPA fallback kept
    assert client.get("/no-such.js").status_code == 404
    escaped = client.get("/docs/..%2f..%2f..%2fetc%2fpasswd")
    assert "root:" not in escaped.text
