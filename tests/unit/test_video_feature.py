"""Unit tests for Video Studio feature routes."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from praisonaiui.features import register_feature
from praisonaiui.features.video import VideoFeature
from praisonaiui.server import create_app
from praisonaiui.video_config import set_video_engine


@pytest.fixture
def projects_tmp(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_PROJECTS_DIR", str(tmp_path))
    set_video_engine(projects_dir=str(tmp_path))
    yield tmp_path


@pytest.fixture
def client(projects_tmp, monkeypatch):
    monkeypatch.setattr("praisonaiui.features._features", {})
    register_feature(VideoFeature())
    return TestClient(create_app())


class TestVideoProjects:
    def test_create_and_list_project(self, client, projects_tmp):
        r = client.post("/api/video/projects", json={"name": "Demo reel"})
        assert r.status_code == 201
        body = r.json()
        assert body["id"]
        assert (projects_tmp / body["id"] / "scene.yaml").is_file()

        r2 = client.get("/api/video/projects")
        assert r2.status_code == 200
        ids = [p["id"] for p in r2.json()["projects"]]
        assert body["id"] in ids

    def test_get_and_update_scene(self, client):
        created = client.post("/api/video/projects", json={"name": "Edit test"}).json()
        pid = created["id"]
        r = client.get(f"/api/video/projects/{pid}")
        assert r.status_code == 200
        assert "sceneYaml" in r.json()

        client.put(
            f"/api/video/projects/{pid}/scene",
            json={"yaml": "schemaVersion: 1\ncomposition:\n  id: x\n"},
        )
        r2 = client.get(f"/api/video/projects/{pid}")
        assert "composition:" in r2.json()["sceneYaml"]


class TestVideoProxy:
    def test_health(self, client):
        with patch(
            "praisonaiui.features.video.health",
            new_callable=AsyncMock,
            return_value={"status": "ok", "version": "0.4"},
        ):
            r = client.get("/api/video/health")
        assert r.status_code == 200
        assert r.json()["engine"]["status"] == "ok"

    def test_lint_via_mock(self, client):
        created = client.post("/api/video/projects", json={"name": "Lint"}).json()
        with patch(
            "praisonaiui.features.video.lint",
            new_callable=AsyncMock,
            return_value=[{"path": "scene", "message": "bad ease", "severity": "error"}],
        ):
            r = client.post(
                "/api/video/lint",
                json={"projectId": created["id"]},
            )
        assert r.status_code == 200
        assert len(r.json()["issues"]) == 1

    def test_registry(self, client):
        with patch(
            "praisonaiui.features.video.registry",
            new_callable=AsyncMock,
            return_value={"nodeTypes": ["text"], "sceneRefs": []},
        ):
            r = client.get("/api/video/registry")
        assert r.status_code == 200
        assert "text" in r.json()["nodeTypes"]

    def test_health_and_lint_never_500_when_engine_unreachable(self, client, monkeypatch):
        """Regression: httpx.ConnectError used to bubble out as HTTP 500."""
        # Point at an unused local port and ensure no CLI fallback exists.
        set_video_engine(url="http://127.0.0.1:1")
        monkeypatch.setattr("shutil.which", lambda _name: None)
        try:
            r_health = client.get("/api/video/health")
            assert r_health.status_code == 200
            assert r_health.json()["engine"]["status"] == "unavailable"

            r_lint = client.post("/api/video/lint", json={"yaml": "schemaVersion: 1\n"})
            assert r_lint.status_code == 200
            issues = r_lint.json().get("issues", [])
            assert issues and issues[0]["severity"] == "error"

            r_compile = client.post("/api/video/compile", json={"yaml": "schemaVersion: 1\n"})
            assert r_compile.status_code == 503
        finally:
            set_video_engine(url="http://127.0.0.1:3921")
