"""Paths taken from a request stay inside the folder they belong to (ARCHITECTURE R8).

- ``/dashboard-plugins/{name}/{path}`` serves only files inside that plugin's
  folder, not a sibling whose name starts with the same text.
- Video project ids are one folder name; ``projectPath`` and export file names
  are confined to the projects folder.
- ``POST /api/knowledge/add-file`` reads only from the attachments folder and
  ``AIUI_KNOWLEDGE_ROOTS``.
- The ``/api/jobs`` proxy stays on ``/api/v1/runs`` upstream and never forwards
  aiui's own credentials.

Requests go through ``TestClient(create_app())``. httpx removes literal ``..``
segments before sending, so traversal requests use ``%2e%2e``, which the
server decodes to ``..``.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

import praisonaiui.dashboard_plugins as dp
import praisonaiui.server as srv

# ── dashboard plugins ─────────────────────────────────────────────


@pytest.fixture
def plugin_root(tmp_path, monkeypatch):
    home = tmp_path / "home"
    root = home / ".praisonai" / "dashboard-plugins"
    (root / "foo").mkdir(parents=True)
    (root / "foo" / "manifest.json").write_text(json.dumps({"name": "foo"}))
    (root / "foo" / "index.js").write_text("// plugin")
    (root / "foo-private").mkdir()
    (root / "foo-private" / "secret.env").write_text("SECRET=1")
    monkeypatch.setattr(dp.Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(dp, "_BUILTIN_PLUGIN_ROOT", tmp_path / "none")
    srv.reset_state()
    srv.set_style("dashboard")
    yield root
    srv.reset_state()


def test_plugin_file_resolves_inside_its_folder(plugin_root):
    assert dp._resolve_plugin_file("foo", "index.js", None) == (plugin_root / "foo" / "index.js").resolve()


def test_plugin_file_cannot_reach_a_sibling_with_the_same_prefix(plugin_root):
    assert dp._resolve_plugin_file("foo", "../foo-private/secret.env", None) is None


@pytest.mark.parametrize("auth_enforce", [False, True])
def test_plugin_route_refuses_sibling_folder(plugin_root, monkeypatch, auth_enforce):
    if auth_enforce:
        monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(srv.create_app())
    assert client.get("/dashboard-plugins/foo/index.js").status_code == 200
    r = client.get("/dashboard-plugins/foo/%2e%2e/foo-private/secret.env")
    assert r.status_code == 404
    assert "SECRET" not in r.text


# ── video projects ────────────────────────────────────────────────


@pytest.fixture
def video_client(tmp_path, monkeypatch):
    from praisonaiui.features import _features, register_feature
    from praisonaiui.features.video import VideoFeature
    from praisonaiui.video_config import set_video_engine

    projects = tmp_path / "root" / "projects"
    projects.mkdir(parents=True)
    monkeypatch.setenv("PRAISONAI_PROJECTS_DIR", str(projects))
    set_video_engine(projects_dir=str(projects))
    srv.reset_state()
    _features.clear()
    register_feature(VideoFeature())
    yield TestClient(srv.create_app()), projects
    _features.clear()
    srv.reset_state()


@pytest.mark.parametrize("pid", ["%2e%2e", "%2E%2E", "%2e"])
def test_video_scene_put_cannot_leave_projects_folder(video_client, pid):
    client, projects = video_client
    r = client.put(f"/api/video/projects/{pid}/scene", json={"yaml": "x: 1"})
    assert r.status_code == 404
    assert not (projects.parent / "scene.yaml").exists()
    assert not (projects / "scene.yaml").exists()


def test_video_resolve_project_rejects_multi_segment_ids(video_client):
    from praisonaiui.video_projects import resolve_project

    _, projects = video_client
    (projects / "a" / "b").mkdir(parents=True)
    for bad in ("..", "a/b", "a\\b", "", "../projects/a"):
        with pytest.raises(FileNotFoundError):
            resolve_project(bad)
    assert resolve_project("a") == projects / "a"


def test_video_render_rejects_export_name_outside_exports(video_client):
    client, projects = video_client
    pid = client.post("/api/video/projects", json={"name": "Demo"}).json()["id"]
    r = client.post("/api/video/render", json={"projectId": pid, "out": "../../x.mp4"})
    assert r.status_code == 400
    r = client.post("/api/video/render", json={"projectId": "%2e%2e"})
    assert r.status_code == 404


def test_video_preview_start_confines_project_path(video_client):
    client, projects = video_client
    created = client.post("/api/video/projects", json={"name": "Demo"}).json()
    started = AsyncMock(return_value={"url": "http://x"})
    with patch("praisonaiui.features.video.preview_start", started):
        assert client.post("/api/video/preview/start", json={"projectPath": str(projects.parent)}).status_code == 404
        assert client.post("/api/video/preview/start", json={"projectPath": "/"}).status_code == 404
        ok = client.post("/api/video/preview/start", json={"projectPath": created["path"]})
    assert ok.status_code == 200
    started.assert_awaited_once()


def test_video_artifact_download_stays_in_exports(video_client):
    client, projects = video_client
    pid = client.post("/api/video/projects", json={"name": "Demo"}).json()["id"]
    (projects / pid / "scene.yaml").write_text("x: 1")
    r = client.get(f"/api/video/projects/{pid}/artifacts/%2e%2e")
    assert r.status_code == 404


# ── knowledge add-file ────────────────────────────────────────────


@pytest.fixture
def knowledge_client(tmp_path, monkeypatch):
    from praisonaiui.features import _features, register_feature
    from praisonaiui.features.knowledge import KnowledgeFeature

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("AIUI_KNOWLEDGE_ROOTS", raising=False)
    srv.reset_state()
    _features.clear()
    register_feature(KnowledgeFeature())
    mgr = MagicMock()
    mgr.add_file.return_value = {"ok": True}
    with patch("praisonaiui.features.knowledge.get_knowledge_manager", return_value=mgr):
        yield TestClient(srv.create_app()), mgr
    _features.clear()
    srv.reset_state()


def test_knowledge_add_file_refuses_a_server_file(knowledge_client, tmp_path):
    client, mgr = knowledge_client
    secret = tmp_path / "elsewhere" / "secret.txt"
    secret.parent.mkdir()
    secret.write_text("secret")
    r = client.post("/api/knowledge/add-file", json={"file_path": str(secret)})
    assert r.status_code == 400
    r = client.post("/api/knowledge/add-file", json={"file_path": "/etc/hosts"})
    assert r.status_code == 400
    mgr.add_file.assert_not_called()


def test_knowledge_add_file_accepts_allowed_roots(knowledge_client, tmp_path, monkeypatch):
    from praisonaiui.features.attachments import get_attachment_manager

    client, mgr = knowledge_client
    upload = __import__("pathlib").Path(get_attachment_manager()._storage_dir) / "aiui-test-upload.txt"
    upload.write_text("hello")
    try:
        assert client.post("/api/knowledge/add-file", json={"file_path": str(upload)}).status_code == 200
    finally:
        upload.unlink()

    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "a.md").write_text("# A")
    monkeypatch.setenv("AIUI_KNOWLEDGE_ROOTS", str(docs))
    assert client.post("/api/knowledge/add-file", json={"file_path": str(docs / "a.md")}).status_code == 200
    r = client.post("/api/knowledge/add-file", json={"file_path": str(docs / ".." / "elsewhere")})
    assert r.status_code == 400
    assert mgr.add_file.call_count == 2


# ── jobs proxy ────────────────────────────────────────────────────


def _mock_upstream():
    resp = MagicMock()
    resp.status_code = 200
    resp.headers = {"content-type": "application/json"}
    resp.json.return_value = {"ok": True}
    resp.content = b""
    client = AsyncMock()
    client.request = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


@pytest.fixture
def jobs_app(monkeypatch):
    import praisonaiui as aiui

    srv.reset_state()
    aiui.set_style("dashboard")
    yield aiui
    srv.reset_state()


@pytest.mark.parametrize(
    "path",
    ["/api/jobs/%2e%2e/%2e%2e/admin", "/api/jobs/x/%2E%2E/%2e%2e/%2e%2e/internal", "/api/jobs/%2e"],
)
def test_jobs_proxy_refuses_dot_segments(jobs_app, path):
    jobs_app.set_jobs_proxy("http://jobs-upstream:9000")
    upstream = _mock_upstream()
    with patch("httpx.AsyncClient", return_value=upstream):
        r = TestClient(srv.create_app()).get(path)
    assert r.status_code == 400
    upstream.request.assert_not_awaited()


def test_jobs_proxy_encodes_decoded_separators(jobs_app):
    jobs_app.set_jobs_proxy("http://jobs-upstream:9000")
    upstream = _mock_upstream()
    with patch("httpx.AsyncClient", return_value=upstream):
        TestClient(srv.create_app()).get("/api/jobs/run_1%3Fx=1/status")
    assert upstream.request.await_args[0][1] == "http://jobs-upstream:9000/api/v1/runs/run_1%3Fx=1/status"


@pytest.mark.parametrize("mode", ["open", "url_token"])
def test_jobs_proxy_does_not_forward_aiui_credentials(jobs_app, monkeypatch, mode):
    if mode == "url_token":
        monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
        monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
    jobs_app.set_jobs_proxy("http://jobs-upstream:9000")
    upstream = _mock_upstream()
    with patch("httpx.AsyncClient", return_value=upstream):
        r = TestClient(srv.create_app()).get(
            "/api/jobs/run_1?token=s3cret&page=2",
            headers={
                "Authorization": "Bearer s3cret",
                "Cookie": "praisonaiui_token=s3cret",
                "X-API-Key": "s3cret",
                "X-Trace": "keep",
            },
        )
    assert r.status_code == 200
    url = upstream.request.await_args[0][1]
    headers = {k.lower(): v for k, v in upstream.request.await_args[1]["headers"].items()}
    assert url == "http://jobs-upstream:9000/api/v1/runs/run_1?page=2"
    assert "s3cret" not in json.dumps(headers)
    assert headers.get("x-trace") == "keep"


def test_jobs_proxy_sends_the_configured_upstream_token(jobs_app):
    jobs_app.set_jobs_proxy("http://jobs-upstream:9000", token="upstream-key")
    upstream = _mock_upstream()
    with patch("httpx.AsyncClient", return_value=upstream):
        TestClient(srv.create_app()).get("/api/jobs", headers={"Authorization": "Bearer mine"})
    headers = upstream.request.await_args[1]["headers"]
    assert headers["Authorization"] == "Bearer upstream-key"
