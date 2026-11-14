"""A plain ``pip install aiui`` has no httpx: the server must still start."""

import importlib
import sys

from starlette.testclient import TestClient


def _reload_without_httpx(monkeypatch):
    monkeypatch.setitem(sys.modules, "httpx", None)  # makes `import httpx` raise ImportError
    import praisonaiui.jobs_proxy as jp

    return importlib.reload(jp)


def test_jobs_proxy_imports_and_mounts_without_httpx(monkeypatch):
    jp = _reload_without_httpx(monkeypatch)
    jp.set_jobs_proxy("http://127.0.0.1:9")
    try:
        assert jp.jobs_proxy_routes(), "jobs proxy routes must still mount without httpx"
    finally:
        jp.set_jobs_proxy(None)
        monkeypatch.delitem(sys.modules, "httpx", raising=False)
        importlib.reload(jp)


def test_create_app_starts_without_httpx(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    _reload_without_httpx(monkeypatch)
    from praisonaiui.server import create_app

    try:
        client = TestClient(create_app())
        assert client.get("/health").status_code in (200, 503)
    finally:
        monkeypatch.delitem(sys.modules, "httpx", raising=False)
        import praisonaiui.jobs_proxy as jp

        importlib.reload(jp)


def test_jobs_proxy_reports_missing_httpx_when_used(monkeypatch):
    jp = _reload_without_httpx(monkeypatch)
    from starlette.applications import Starlette

    jp.set_jobs_proxy("http://127.0.0.1:9")
    try:
        client = TestClient(Starlette(routes=jp.jobs_proxy_routes()))
        resp = client.get("/api/jobs/abc")
        assert resp.status_code == 501
        assert "httpx" in resp.json()["error"]
    finally:
        jp.set_jobs_proxy(None)
        monkeypatch.delitem(sys.modules, "httpx", raising=False)
        importlib.reload(jp)
