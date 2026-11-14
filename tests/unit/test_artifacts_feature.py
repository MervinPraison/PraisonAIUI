"""Artifacts store (ADR 0003, Track D): index, per-session versions, user
edits and deletes under the data dir."""

from __future__ import annotations

import json

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    from praisonaiui.features import artifacts

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("PRAISONAI_HOME", raising=False)
    monkeypatch.setattr(artifacts, "_store", None)
    return tmp_path


@pytest.fixture
def client() -> TestClient:
    from praisonaiui.features.artifacts import ArtifactsFeature

    return TestClient(Starlette(routes=ArtifactsFeature().routes()))


def _table(**kw):
    return {"kind": "table", "title": "Comparison table", "messageId": "m1",
            "content": "| a | b |\n|---|---|\n| 1 | 2 |", **kw}  # fmt: skip


def test_put_derived_versions_then_read_the_session(client, _isolated):
    r = client.put("/api/artifacts/s1/table:a|b", json=_table(version=1))
    assert r.status_code == 200
    art = r.json()["artifact"]
    assert art["key"] == "table:a|b" and art["version"] == 1 and art["sessionId"] == "s1"
    assert "edited" not in art and art["updatedAt"] > 0
    client.put("/api/artifacts/s1/table:a|b", json=_table(version=2, messageId="m2"))
    client.put("/api/artifacts/s1/sort_demo.py", json={"kind": "code", "language": "python",
                                                        "content": "print(1)", "version": 1})  # fmt: skip
    # the same derived version again (a history reload) replaces it
    client.put("/api/artifacts/s1/table:a|b", json=_table(version=1, title="Renamed"))
    body = client.get("/api/artifacts/s1").json()
    assert body["sessionId"] == "s1"
    rows = [(a["key"], a["version"]) for a in body["artifacts"]]
    assert rows == [("table:a|b", 1), ("table:a|b", 2), ("sort_demo.py", 1)]
    assert body["artifacts"][0]["title"] == "Renamed"
    assert body["artifacts"][2]["title"] == "sort_demo.py"  # no title: the key
    assert client.get("/api/artifacts/other").json()["artifacts"] == []


def test_user_edit_adds_a_version_and_is_never_overwritten(client):
    client.put("/api/artifacts/s1/f.py", json={"kind": "code", "content": "a", "version": 1})
    r = client.put("/api/artifacts/s1/f.py", json={"kind": "code", "content": "b", "edited": True, "version": 1})
    edit = r.json()["artifact"]
    assert edit["version"] == 2 and edit["edited"] is True and edit["content"] == "b"
    # a derived upsert may not replace the user's version
    r = client.put("/api/artifacts/s1/f.py", json={"kind": "code", "content": "c", "version": 2})
    assert r.status_code == 409
    # without a version: the next number
    r = client.put("/api/artifacts/s1/f.py", json={"kind": "code", "content": "c"})
    assert r.json()["artifact"]["version"] == 3
    versions = [(a["version"], a.get("edited", False)) for a in client.get("/api/artifacts/s1").json()["artifacts"]]
    assert versions == [(1, False), (2, True), (3, False)]


def test_keys_may_contain_slashes(client):
    r = client.put("/api/artifacts/s1/src/app/main.py", json={"kind": "code", "content": "x"})
    assert r.json()["artifact"]["key"] == "src/app/main.py"
    assert client.delete("/api/artifacts/s1/src/app/main.py").json() == {"deleted": 1}


def test_cross_session_index_is_latest_first_without_content(client):
    import time

    client.put("/api/artifacts/s1/a", json={"kind": "markdown", "content": "x", "version": 1})
    client.put("/api/artifacts/s1/a", json={"kind": "markdown", "content": "y", "version": 2})
    time.sleep(0.002)
    client.put("/api/artifacts/s2/img", json={"kind": "image", "url": "/files/a.png", "mimeType": "image/png"})
    body = client.get("/api/artifacts").json()
    assert body["count"] == 2 and body["sessions"] == 2
    assert [(a["sessionId"], a["key"], a["version"]) for a in body["artifacts"]] == [
        ("s2", "img", 1),
        ("s1", "a", 2),
    ]
    assert all("content" not in a for a in body["artifacts"])
    one = client.get("/api/artifacts?session_id=s1&limit=1").json()
    assert one["count"] == 1 and one["artifacts"][0]["key"] == "a"
    assert len(client.get("/api/artifacts?limit=1").json()["artifacts"]) == 1
    assert client.get("/api/artifacts?limit=x").status_code == 200


def test_delete_a_version_a_key_and_a_session(client, _isolated):
    for v in (1, 2):
        client.put("/api/artifacts/s1/a", json={"kind": "code", "content": str(v), "version": v})
    client.put("/api/artifacts/s1/b", json={"kind": "code", "content": "b"})
    assert client.delete("/api/artifacts/s1/a?version=1").json() == {"deleted": 1}
    assert [(a["key"], a["version"]) for a in client.get("/api/artifacts/s1").json()["artifacts"]] == [
        ("a", 2),
        ("b", 1),
    ]
    assert client.delete("/api/artifacts/s1/a").json() == {"deleted": 1}
    assert client.delete("/api/artifacts/s1/a").status_code == 404
    assert client.delete("/api/artifacts/s1/b?version=x").status_code == 400
    assert client.delete("/api/artifacts/s1").json() == {"deleted": 1}
    assert list((_isolated / "artifacts").glob("*.json")) == []
    assert client.delete("/api/artifacts/s1").json() == {"deleted": 0}


def test_storage_is_json_under_the_data_dir_and_never_uses_the_session_id_as_a_path(client, _isolated):
    sid = "../../etc/passwd"
    r = client.put(f"/api/artifacts/{sid.replace('/', '%2F')}/k", json={"kind": "code", "content": "x"})
    assert r.status_code in (200, 404)  # some clients normalise the path first
    client.put("/api/artifacts/s1/k", json={"kind": "code", "content": "x"})
    files = list((_isolated / "artifacts").glob("*.json"))
    assert files and all(f.parent == _isolated / "artifacts" for f in files)
    data = [json.loads(f.read_text()) for f in files]
    assert {"s1"} <= {d["sessionId"] for d in data}
    assert not (_isolated / "etc").exists() and not (_isolated.parent / "etc" / "passwd.json").exists()


def test_store_survives_a_restart_and_a_corrupt_file(_isolated, caplog):
    from praisonaiui.features import artifacts

    artifacts.get_artifact_store().put("s1", "k", {"kind": "code", "content": "x"})
    artifacts._store = None
    assert [a["key"] for a in artifacts.get_artifact_store().session("s1")] == ["k"]
    artifacts._session_file("s2").write_text("{not json")
    assert artifacts.get_artifact_store().session("s2") == []
    assert artifacts.get_artifact_store().index()["count"] == 1
    assert "could not read" in caplog.text


@pytest.mark.parametrize(
    "body, status",
    [
        ([], 400),
        ({"kind": "exe"}, 400),
        ({"kind": "code", "title": 5}, 400),
        ({"kind": "code", "title": "x" * 301}, 400),
        ({"kind": "code", "content": 5}, 400),
        ({"kind": "code", "version": 0}, 400),
        ({"kind": "code", "version": True}, 400),
        ({"kind": "code", "version": "2"}, 400),
        ({"kind": "file", "url": "javascript:alert(1)"}, 400),
        ({"kind": "file", "url": " JavaScript:alert(1)"}, 400),
        ({"kind": "code", "messageId": ["x"]}, 400),
    ],
)
def test_bad_bodies_are_refused(client, body, status):
    assert client.put("/api/artifacts/s1/k", json=body).status_code == status


def test_limits(client, monkeypatch):
    from praisonaiui.features import artifacts

    big = "x" * (artifacts.MAX_CONTENT + 1)
    assert client.put("/api/artifacts/s1/k", json={"kind": "code", "content": big}).status_code == 413
    assert client.put("/api/artifacts/s1/k", content=b"nope").status_code == 400
    assert client.put("/api/artifacts/s1/" + "k" * 301, json={"kind": "code"}).status_code == 400
    assert client.get("/api/artifacts/" + "s" * 201).status_code == 400
    assert client.get("/api/artifacts?session_id=" + "s" * 201).status_code == 400

    monkeypatch.setattr(artifacts, "MAX_KEYS_PER_SESSION", 2)
    monkeypatch.setattr(artifacts, "MAX_VERSIONS_PER_KEY", 2)
    for key in ("a", "b"):
        assert client.put(f"/api/artifacts/s2/{key}", json={"kind": "code"}).status_code == 200
    assert client.put("/api/artifacts/s2/c", json={"kind": "code"}).status_code == 409
    client.put("/api/artifacts/s2/a", json={"kind": "code", "edited": True})
    client.put("/api/artifacts/s2/a", json={"kind": "code"})
    kept = [(a["version"], a.get("edited", False)) for a in client.get("/api/artifacts/s2").json()["artifacts"] if a["key"] == "a"]
    assert kept == [(2, True), (3, False)]  # the oldest unedited version went first


@pytest.mark.asyncio
async def test_health_does_not_touch_the_disk(monkeypatch):
    from praisonaiui.features import artifacts

    monkeypatch.setattr(artifacts, "artifacts_dir", lambda: (_ for _ in ()).throw(AssertionError("disk")))
    h = await artifacts.ArtifactsFeature().health()
    assert h["status"] == "ok"
