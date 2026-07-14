"""Tests for the Code Studio view (STITCH-006)."""

from pathlib import Path

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

    def test_execute(self):
        client = TestClient(create_app())
        r = client.post(
            "/api/code/execute",
            json={"code": "print('hi')", "language": "python", "timeout": 30},
        )
        assert r.status_code == 200
        d = r.json()
        assert "status" in d and "language" in d


class TestCodeStudioFrontend:
    def test_view_file_exists(self):
        assert (VIEWS / "code-studio.js").is_file()

    def test_view_exports_render(self):
        src = (VIEWS / "code-studio.js").read_text()
        assert "export async function render" in src
        assert "export function cleanup" in src

    def test_view_calls_execute_api(self):
        src = (VIEWS / "code-studio.js").read_text()
        assert "/api/code/execute" in src
        assert "/api/code/languages" in src

    def test_no_browser_eval(self):
        src = (VIEWS / "code-studio.js").read_text()
        assert "eval(" not in src

    def test_registered_in_dashboard(self):
        src = (PLUGINS / "dashboard.js").read_text()
        assert "'code-studio'" in src
        assert "code-studio.js" in src

    def test_send_to_agent_event(self):
        src = (VIEWS / "code-studio.js").read_text()
        assert "aiui:prefill-composer" in src

    def test_chat_has_prefill_listener(self):
        src = (VIEWS / "chat.js").read_text()
        assert "aiui:prefill-composer" in src
