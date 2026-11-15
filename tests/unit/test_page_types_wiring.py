"""Page templates reach the app shell manifest, and only it.

``pageType`` is shell presentation (like ``navIcon``): ``GET /api/pages`` and
the legacy dashboard never carry it (R6).
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin.page_types import PAGE_TYPE_BY_ID
from praisonaiui.plugin_registry import PageSpec, get_plugin_registry


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


def _client() -> TestClient:
    return TestClient(srv.create_app())


@pytest.mark.parametrize("style", ["dashboard", "app"])
def test_builtin_manifest_rows_carry_their_template(style):
    srv.set_style(style)
    pages = _client().get("/api/shell/manifest").json()["pages"]
    builtin = {p["id"]: p for p in pages if p["source"] == "builtin"}
    assert builtin, "no built-in pages in the manifest"
    for pid, row in builtin.items():
        assert row.get("pageType") == PAGE_TYPE_BY_ID[pid], pid


def test_api_pages_never_carry_a_template():
    rows = _client().get("/api/pages").json()["pages"]
    assert rows
    assert not [r["id"] for r in rows if "pageType" in r or "page_type" in r]


def test_registry_pages_have_page_type():
    _client()
    specs = {s.id: s for s in get_plugin_registry().pages(origin="builtin")}
    assert specs["logs"].page_type == "log"
    assert specs["kanban"].page_type == "board"


class _Plugin:
    name = "pt-demo"

    def __init__(self, page_type):
        self._page_type = page_type

    def pages(self):
        return [PageSpec(id="pt-demo", title="Demo", kind="blocks", page_type=self._page_type)]


def _plugin_row(page_type):
    reg = get_plugin_registry()
    reg.register(_Plugin(page_type))
    srv.set_style("app")
    pages = _client().get("/api/shell/manifest").json()["pages"]
    return next((p for p in pages if p["id"] == "pt-demo"), None)


def test_a_plugin_page_declares_its_template():
    row = _plugin_row("board")
    assert row is not None and row["pageType"] == "board"


def test_a_plugin_page_without_a_template_has_none():
    row = _plugin_row(None)
    assert row is not None and "pageType" not in row


def test_an_invalid_plugin_template_drops_that_page_with_a_warning(caplog):
    with caplog.at_level("WARNING", logger="praisonaiui.plugin_registry"):
        row = _plugin_row("Not Valid!")
    assert row is None
    assert "invalid page type 'Not Valid!'" in caplog.text
