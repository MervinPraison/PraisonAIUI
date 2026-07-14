"""Work Hub (STITCH-003) registration and wiring tests."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = FRONTEND / "views"


def test_work_hub_view_file_exists():
    assert (VIEWS / "work-hub.js").exists()


def test_work_registered_in_builtin_views():
    source = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert "work:" in source
    assert "/plugins/views/work-hub.js" in source


def test_kanban_banner_links_to_work_hub():
    source = (VIEWS / "kanban.js").read_text(encoding="utf-8")
    assert 'href="/work"' in source
    assert "Work Hub" in source


def test_board_supports_on_open_override():
    source = (FRONTEND / "board.js").read_text(encoding="utf-8")
    assert "typeof opts.onOpen === 'function'" in source


def test_work_page_registered_in_server():
    from starlette.testclient import TestClient

    import praisonaiui as aiui
    import praisonaiui.server as server

    server.reset_state()
    aiui.set_style("dashboard")
    app = server.create_app()
    client = TestClient(app)
    resp = client.get("/api/pages")
    assert resp.status_code == 200
    pages = resp.json().get("pages") or []
    work = next((p for p in pages if p.get("id") == "work"), None)
    assert work is not None
    assert work["group"] == "Work"
