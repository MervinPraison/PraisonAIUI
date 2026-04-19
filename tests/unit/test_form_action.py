"""Tests for the form_action component and /api/pages/{page_id}/action endpoint.

The form action protocol allows form inputs to POST data back to server
page handlers, closing the gap between read-only components and interactive UIs.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from praisonaiui import server as srv
from praisonaiui.datastore import MemoryDataStore
from praisonaiui.ui import form_action, select_input, text_input


@pytest.fixture(autouse=True)
def _clean_state():
    srv.reset_state()
    srv.set_datastore(MemoryDataStore())
    yield
    srv.reset_state()


@pytest.fixture
def client():
    app = srv.create_app()
    return TestClient(app)


# ── Python component tests ────────────────────────────────────────

class TestFormActionComponent:
    def test_basic(self):
        fa = form_action(
            "settings",
            children=[text_input("Name"), select_input("Role", options=["admin", "user"])],
        )
        assert fa["type"] == "form_action"
        assert fa["action"] == "settings"
        assert len(fa["children"]) == 2

    def test_with_submit_label(self):
        fa = form_action("save", children=[], submit_label="Save Changes")
        assert fa["submit_label"] == "Save Changes"

    def test_default_submit_label(self):
        fa = form_action("save", children=[])
        assert fa["submit_label"] == "Submit"

    def test_returns_dict_with_type(self):
        fa = form_action("x", children=[])
        assert isinstance(fa, dict)
        assert fa["type"] == "form_action"


# ── Server endpoint tests ─────────────────────────────────────────

class TestFormActionEndpoint:
    def test_action_endpoint_exists(self, client):
        """The /api/pages/{page_id}/action endpoint exists and returns 404 for unknown page."""
        resp = client.post("/api/pages/nonexistent/action", json={"data": {}})
        assert resp.status_code == 404

    def test_action_invokes_handler(self, client):
        """Registered page action handler is invoked with form data."""
        received = {}

        @srv.register_page_action("test-page")
        async def handle_action(data):
            received.update(data)
            return {"status": "ok"}

        resp = client.post(
            "/api/pages/test-page/action",
            json={"name": "Alice", "role": "admin"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert received["name"] == "Alice"
        assert received["role"] == "admin"

    def test_action_returns_handler_result(self, client):
        @srv.register_page_action("result-page")
        async def handle_action(data):
            return {"message": f"Hello {data.get('name', 'World')}"}

        resp = client.post(
            "/api/pages/result-page/action",
            json={"name": "Bob"},
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "Hello Bob"


# ── Frontend data-collection tests ────────────────────────────────
# Regression: form_action's submit handler reads `el.name || el.dataset.label`.
# If the input renderers don't emit `data-label`, the POSTed body is always {}.

class TestFormInputDataLabel:
    """Every form input renderer must expose the label via data-label attribute
    so the form_action submit handler can collect values by label."""

    def _js(self):
        from pathlib import Path
        p = (
            Path(__file__).resolve().parents[2]
            / "src" / "praisonaiui" / "templates" / "frontend"
            / "plugins" / "dashboard.js"
        )
        return p.read_text()

    @pytest.mark.parametrize("renderer", [
        "renderTextInput",
        "renderNumberInput",
        "renderSelectInput",
        "renderSliderInput",
        "renderCheckboxInput",
        "renderTextareaInput",
    ])
    def test_renderer_emits_data_label(self, renderer):
        import re
        source = self._js()
        match = re.search(
            rf"function {renderer}\(comp\)\s*\{{(.*?)^}}",
            source, re.DOTALL | re.MULTILINE,
        )
        assert match, f"{renderer} not found in dashboard.js"
        body = match.group(1)
        assert "data-label=" in body, (
            f"{renderer} must emit data-label so form_action can collect "
            f"its value on submit"
        )
