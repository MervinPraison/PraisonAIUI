"""Small chat-adjacent API defects (review findings).

* Overview Approve/Deny sent no body (``Content-Length: 0``): the handler
  called ``request.json()`` on it and answered 500, so the buttons did nothing.
* Malformed JSON to any route answered 500 with a traceback, not 400.
* Deleting a chat left its artifacts (content included) in the store and index.
* ``aiui run chat.yaml`` ignored ``datastore:`` unless ``--datastore memory``
  was also passed.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv

JSON = {"Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import approvals, artifacts

    monkeypatch.setattr(srv, "_datastore", MemoryDataStore())
    monkeypatch.setattr(artifacts, "_store", None)
    monkeypatch.setattr(approvals, "_approval_manager", None, raising=False)
    yield tmp_path


def _client() -> TestClient:
    return TestClient(srv.create_app(), raise_server_exceptions=False)


def _pending_approval(client: TestClient) -> str:
    r = client.post(
        "/api/approvals",
        json={"tool_name": "shell", "arguments": {"cmd": "rm -rf /tmp/x"}, "risk_level": "critical"},
    )
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["status"] == "pending", entry
    return entry["id"]


# ── Approve / Deny with no body ──────────────────────────────────────


@pytest.mark.parametrize(("action", "status"), [("approve", "approved"), ("deny", "denied")])
def test_approve_and_deny_accept_an_empty_body(action, status):
    client = _client()
    approval_id = _pending_approval(client)
    # What overview.js sends: POST with no body (Content-Length: 0).
    r = client.post(f"/api/approvals/{approval_id}/{action}", content=b"")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == status


def test_approve_still_reads_a_json_body():
    client = _client()
    approval_id = _pending_approval(client)
    r = client.post(f"/api/approvals/{approval_id}/approve", json={"reason": "looks fine"})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


@pytest.mark.parametrize("body", [b"{not json", b"[1]"])
def test_approve_with_a_bad_body_is_400(body):
    client = _client()
    approval_id = _pending_approval(client)
    r = client.post(f"/api/approvals/{approval_id}/approve", content=body, headers=JSON)
    assert r.status_code == 400
    assert client.get(f"/api/approvals/{approval_id}").json()["status"] == "pending"


# ── Malformed JSON is a 400 ──────────────────────────────────────────


@pytest.mark.parametrize(
    "path", ["/api/approvals", "/api/schedules", "/api/skills", "/api/kanban/tasks", "/api/workflows"]
)
@pytest.mark.parametrize("body", [b"{not json", b""])
def test_malformed_json_is_400_not_500(path, body):
    r = _client().post(path, content=body, headers=JSON)
    assert r.status_code == 400, (path, body, r.status_code, r.text)


def test_a_json_error_outside_the_request_body_is_still_a_500():
    import json

    from starlette.applications import Starlette
    from starlette.routing import Route

    from praisonaiui.http_guard import json_exception_handlers

    async def broken(request):
        json.loads("{corrupt file")

    app = Starlette(routes=[Route("/x", broken)], exception_handlers=json_exception_handlers())
    assert TestClient(app, raise_server_exceptions=False).get("/x").status_code == 500


# ── Deleting a chat deletes its artifacts ────────────────────────────


def test_deleting_a_session_deletes_its_artifacts(monkeypatch):
    import asyncio

    from praisonaiui.features.artifacts import get_artifact_store

    monkeypatch.setattr(srv, "_style", "app")  # the artifacts API ships with the app shell

    sid = asyncio.run(srv._datastore.create_session())["id"]
    other = asyncio.run(srv._datastore.create_session())["id"]
    store = get_artifact_store()
    store.put(sid, "plan", {"title": "Plan", "kind": "markdown", "content": "secret plan"})
    store.put(other, "notes", {"title": "Notes", "kind": "markdown", "content": "keep me"})

    client = _client()
    assert client.get(f"/api/artifacts?session_id={sid}").json()["artifacts"]
    assert client.delete(f"/sessions/{sid}").status_code == 200

    assert client.get(f"/api/artifacts?session_id={sid}").json()["artifacts"] == []
    assert store.session(sid) == []
    assert [a["key"] for a in store.session(other)] == ["notes"]


# ── chat.yaml datastore: ─────────────────────────────────────────────


def _run_yaml(tmp_path, monkeypatch, yaml_text: str, *flags: str):
    from typer.testing import CliRunner

    from praisonaiui import cli
    from praisonaiui.cli import app as cli_app

    cfg = tmp_path / "chat.yaml"
    cfg.write_text(yaml_text)
    monkeypatch.setattr(cli, "_run_uvicorn", lambda *a, **kw: None)
    stores = []
    real = srv.set_datastore
    monkeypatch.setattr(srv, "set_datastore", lambda s: (stores.append(s), real(s)))
    srv.reset_state()
    try:
        result = CliRunner().invoke(cli_app, ["run", str(cfg), "--port", "8211", *flags])
    finally:
        srv.reset_state()
    assert result.exit_code == 0, result.output
    return stores[-1]


def test_chat_yaml_datastore_is_used(tmp_path, monkeypatch):
    from praisonaiui.datastore import MemoryDataStore

    store = _run_yaml(tmp_path, monkeypatch, "name: Bot\ndatastore: memory\n")
    assert isinstance(store, MemoryDataStore)


def test_datastore_flag_wins_over_the_yaml(tmp_path, monkeypatch):
    from praisonaiui.datastore import JSONFileDataStore, MemoryDataStore

    store = _run_yaml(
        tmp_path, monkeypatch, "name: Bot\ndatastore: memory\n", "--datastore", f"json:{tmp_path / 's'}"
    )
    assert isinstance(store, JSONFileDataStore) and not isinstance(store, MemoryDataStore)
