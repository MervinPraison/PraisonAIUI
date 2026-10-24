"""Tests for the Code Studio view (STITCH-006)."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app

VIEWS = Path("src/praisonaiui/templates/frontend/plugins/views")
PLUGINS = Path("src/praisonaiui/templates/frontend/plugins")


class TestCodeStudioPage:
    def test_page_registered(self):
        client = TestClient(create_app())
        r = client.get("/api/pages")
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()["pages"]}
        assert "code-studio" in ids

    def test_page_metadata(self):
        client = TestClient(create_app())
        pages = {p["id"]: p for p in client.get("/api/pages").json()["pages"]}
        page = pages["code-studio"]
        assert page["title"] == "Code Studio"
        assert page["api_endpoint"] == "/api/code/languages"


class TestCodeExecutionApi:
    def test_languages(self):
        client = TestClient(create_app())
        r = client.get("/api/code/languages")
        assert r.status_code == 200
        d = r.json()
        assert "languages" in d and "count" in d

    @pytest.fixture(autouse=True)
    def _fresh_approvals(self, monkeypatch):
        from praisonaiui.features import approvals

        monkeypatch.setattr(approvals, "_approval_manager", approvals.SimpleApprovalManager())
        return approvals._approval_manager

    def test_execute_requires_approval(self, _fresh_approvals):
        client = TestClient(create_app())
        payload = {"code": "print('hi')", "language": "python", "timeout": 30}
        r = client.post("/api/code/execute", json=payload)
        assert r.status_code == 202
        d = r.json()
        assert d["status"] == "pending_approval"
        approval_id = d["approval_id"]
        assert _fresh_approvals.get(approval_id)["tool_name"] == "execute_code"

        # Not yet approved
        r = client.post("/api/code/execute", json={**payload, "approval_id": approval_id})
        assert r.status_code == 403

        assert client.post(f"/api/approvals/{approval_id}/approve", json={}).status_code == 200
        # Approval is bound to the exact code
        r = client.post(
            "/api/code/execute",
            json={**payload, "code": "print('x')", "approval_id": approval_id},
        )
        assert r.status_code == 403

        r = client.post("/api/code/execute", json={**payload, "approval_id": approval_id})
        assert r.status_code == 200
        d = r.json()
        assert "status" in d and "language" in d

        # Single use
        r = client.post("/api/code/execute", json={**payload, "approval_id": approval_id})
        assert r.status_code == 403

    def test_execute_denied(self, _fresh_approvals):
        client = TestClient(create_app())
        r = client.post("/api/code/execute", json={"code": "1", "language": "python"})
        approval_id = r.json()["approval_id"]
        client.post(f"/api/approvals/{approval_id}/deny", json={})
        r = client.post(
            "/api/code/execute",
            json={"code": "1", "language": "python", "approval_id": approval_id},
        )
        assert r.status_code == 403

    def test_execute_auto_approved_by_policy(self, _fresh_approvals):
        _fresh_approvals.update_policies({"auto_approve_tools": ["execute_code"]})
        client = TestClient(create_app())
        r = client.post("/api/code/execute", json={"code": "1", "language": "python"})
        assert r.status_code == 200
        assert _fresh_approvals.list_history()[0]["approver"] == "auto-policy"

    def test_execute_disallowed_language(self, _fresh_approvals):
        client = TestClient(create_app())
        r = client.post("/api/code/execute", json={"code": "ls", "language": "ruby"})
        assert r.status_code == 400
        assert _fresh_approvals.list_pending() == []


class TestCodeStudioFrontend:
    def test_view_file_exists(self):
        assert (VIEWS / "code-studio.js").is_file()

    def test_view_exports_render(self):
        src = (VIEWS / "code-studio.js").read_text(encoding="utf-8")
        assert "export async function render" in src
        assert "export function cleanup" in src

    def test_view_calls_execute_api(self):
        src = (VIEWS / "code-studio.js").read_text(encoding="utf-8")
        assert "/api/code/execute" in src
        assert "/api/code/languages" in src

    def test_no_browser_eval(self):
        src = (VIEWS / "code-studio.js").read_text(encoding="utf-8")
        assert "eval(" not in src

    def test_registered_in_dashboard(self):
        src = (PLUGINS / "dashboard.js").read_text(encoding="utf-8")
        assert "'code-studio'" in src
        assert "code-studio.js" in src

    def test_send_to_agent_event(self):
        src = (VIEWS / "code-studio.js").read_text(encoding="utf-8")
        assert "aiui:prefill-composer" in src

    def test_chat_has_prefill_listener(self):
        src = (VIEWS / "chat.js").read_text(encoding="utf-8")
        assert "aiui:prefill-composer" in src
