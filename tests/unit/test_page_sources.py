"""Every page registration path feeds one merged page list (gap G9).

``register_page`` / ``@aiui.page``, the built-in records, plugins and
dashboard-plugin folders each become a ``PageSpec`` record
(``praisonaiui.builtin.page_sources``). ``GET /api/pages`` and the shell
manifest read the same merged list, with one precedence rule.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin import page_sources as ps
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
    yield data
    srv.reset_state()


def _records(extra_dirs=()) -> dict[str, ps.PageRecord]:
    return {r.id: r for r in srv._page_records(False, list(extra_dirs))}


def _ids(client: TestClient) -> tuple[set[str], set[str]]:
    api = {p["id"] for p in client.get("/api/pages").json()["pages"]}
    shell = {p["id"] for p in client.get("/api/shell/manifest").json()["pages"]}
    return api, shell


@pytest.fixture
def folder(tmp_path):
    """A user dashboard-plugin folder whose page id is ``board``."""
    root = tmp_path / "dash-plugins"
    mine = root / "board"
    mine.mkdir(parents=True)
    (mine / "manifest.json").write_text(
        '{"name": "board", "label": "Board", "group": "Mine", "css": "b.css"}', encoding="utf-8"
    )
    (mine / "index.js").write_text("// board", encoding="utf-8")
    srv.set_dashboard(plugin_dirs=[str(root)])
    return root


def test_register_page_becomes_an_app_record():
    aiui.register_page("metrics", title="Metrics", icon="📈", group="Ops", order=5)
    srv.create_app()
    rec = _records()["metrics"]
    assert rec.source == "app"
    assert rec.spec == PageSpec(
        id="metrics",
        title="Metrics",
        kind="legacy",
        icon="📈",
        group="Ops",
        order=5,
        api_endpoint="/api/pages/metrics/data",
        source="app",
    )
    # wire rows exactly as before
    assert list(rec.api_row) == [
        "id", "title", "icon", "group", "description", "api_endpoint", "order",
    ]
    assert rec.shell_row["source"] == "app" and rec.shell_row["kind"] == "legacy"


def test_page_decorator_becomes_a_blocks_app_record():
    @aiui.page("kpis", title="KPIs")
    async def kpis():
        return {"value": 1}

    client = TestClient(srv.create_app())
    rec = _records()["kpis"]
    assert (rec.source, rec.spec.kind) == ("app", "blocks")
    api, shell = _ids(client)
    assert "kpis" in api and "kpis" in shell
    assert client.get("/api/pages/kpis/data").json()["value"] == 1


def test_builtin_page_record_is_the_catalog_spec():
    srv.create_app()
    rec = _records()["logs"]
    assert rec.source == "builtin" and rec.spec.nav_icon == "scroll-text"
    assert "navIcon" in rec.shell_row and "navIcon" not in rec.api_row


def test_set_pages_filters_records_before_the_merge():
    aiui.set_pages(["chat", "logs"])
    aiui.register_page("metrics", title="Metrics")
    client = TestClient(srv.create_app())
    builtin = {i for i, r in _records().items() if r.source == "builtin"}
    assert builtin == {"chat", "logs"}
    api, shell = _ids(client)
    assert {"chat", "logs", "metrics"} <= api and "usage" not in api
    assert api == shell


def test_dashboard_plugin_folder_becomes_a_folder_record(folder):
    client = TestClient(srv.create_app())
    rec = _records([str(folder)])["board"]
    assert rec.source == "dashboard-plugin:board"
    assert rec.spec.kind == "legacy" and rec.spec.group == "Mine"
    assert rec.spec.module == "/dashboard-plugins/board/index.js"
    assert rec.spec.css == "/dashboard-plugins/board/b.css"
    api, shell = _ids(client)
    assert "board" in api and "board" in shell
    assert client.get("/dashboard-plugins/board/index.js").text == "// board"


def test_endpoints_agree_on_the_owner_of_an_id(folder):
    """app > built-in > plugin > folder, for /api/pages and the manifest alike.

    /api/pages used to merge folders before plugin pages, so a plugin blocks
    page and a folder page with the same id showed the folder on the
    dashboard and the plugin in the app shell.
    """

    class Mine:
        name = "mine"

        def pages(self):
            return [PageSpec(id="board", title="Plugin Board", kind="blocks")]

    get_plugin_registry().register(Mine())
    client = TestClient(srv.create_app())
    api = {p["id"]: p for p in client.get("/api/pages").json()["pages"]}
    shell = {p["id"]: p for p in client.get("/api/shell/manifest").json()["pages"]}
    assert shell["board"]["source"] == "plugin:mine"
    assert api["board"]["title"] == "Plugin Board"
    # an app page beats both
    srv.reset_state()
    srv.set_dashboard(plugin_dirs=[str(folder)])
    get_plugin_registry().register(Mine())
    aiui.register_page("board", title="App Board")
    client = TestClient(srv.create_app())
    api = {p["id"]: p for p in client.get("/api/pages").json()["pages"]}
    shell = {p["id"]: p for p in client.get("/api/shell/manifest").json()["pages"]}
    assert api["board"]["title"] == shell["board"]["title"] == "App Board"


def test_merge_keeps_the_first_record_and_logs_plugin_shadows(caplog):
    a = ps.plugin_page(PageSpec(id="x", title="A", source="plugin:a"))
    b = ps.plugin_page(PageSpec(id="x", title="B", source="plugin:b"))
    c = ps.plugin_page(PageSpec(id="w", title="C", order=1, source="plugin:c"))
    with caplog.at_level("WARNING"):
        merged = ps.merge_pages([a, b, c], log_shadows=True)
    assert [(r.id, r.spec.title) for r in merged] == [("w", "C"), ("x", "A")]
    assert "shadowed" in caplog.text


def test_folder_without_a_page_is_skipped():
    assert ps.folder_page({"name": "n", "entry": "i.js", "page": {}}) is None
