"""tools/preqa serve: GitHub-Pages-like resolution and headers, local bind only."""

import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "preqa"))

from preqa import serve  # noqa: E402


def make_site(root: Path) -> Path:
    (root / "docs" / "guide" / "page").mkdir(parents=True)
    (root / "docs" / "empty").mkdir(parents=True)
    (root / "index.html").write_text("<h1>home</h1>" + "x" * 2000)
    (root / "404.html").write_text("<h1>missing</h1>")
    (root / "docs" / "guide" / "page.html").write_text("<h1>page</h1>")
    (root / "docs" / "guide" / "page" / "index.html").write_text("<h1>page dir</h1>")
    (root / "docs" / "index.html").write_text("<h1>docs</h1>")
    return root


def test_serve_resolves_like_pages(tmp_path):
    root = make_site(tmp_path)
    assert serve.resolve(root, "/") == ("file", root / "index.html")
    assert serve.resolve(root, "/docs/guide/page") == ("file", root / "docs/guide/page.html")
    assert serve.resolve(root, "/docs/guide/page/")[1] == root / "docs/guide/page/index.html"
    assert serve.resolve(root, "/docs") == ("redirect", None)
    assert serve.resolve(root, "/docs/")[1] == root / "docs/index.html"
    assert serve.resolve(root, "/docs/empty/") == ("missing", None)
    assert serve.resolve(root, "/nope") == ("missing", None)
    assert serve.resolve(root, "/../../etc/passwd")[0] == "missing"
    assert serve.resolve(root, "/%2e%2e/%2e%2e/etc/passwd")[0] == "missing"


@pytest.fixture
def server(tmp_path):
    site = make_site(tmp_path / "site")
    (tmp_path / "dash").mkdir()
    (tmp_path / "dash" / "index.html").write_text("dashboard")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.make_handler(site, tmp_path / "dash", None))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_serve_headers_match_production(server):
    status, h, body = fetch(server + "/", {"Accept-Encoding": "gzip"})
    assert status == 200 and h["Cache-Control"] == "max-age=600" and h["Content-Encoding"] == "gzip"
    status, h2, _ = fetch(server + "/", {"If-None-Match": h["ETag"]})
    assert status == 304
    status, h, body = fetch(server + "/nope")
    assert status == 404 and b"missing" in body
    status, h, body = fetch(server + "/preqa/")
    assert status == 200 and body == b"dashboard" and h["Cache-Control"] == "no-cache"


def test_serve_refuses_public_bind():
    with pytest.raises(SystemExit):
        serve.main(["--site", ".", "--host", "0.0.0.0"])
