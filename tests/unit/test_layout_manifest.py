"""Layouts in the app shell manifest (ADR 0003, F2).

The shell manifest gains a top-level ``layouts`` key. Shell-only built-in
pages reach the manifest's ``pages`` only while a layout they name is on
offer, and never the page table, ``/api/pages`` or the dashboard (R6).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin import BUILTIN_PLUGINS, BuiltinPlugin, page
from praisonaiui.plugin_registry import LayoutSpec, get_plugin_registry

FIXTURES = Path(__file__).parent / "fixtures"
SNAPSHOT = json.loads((FIXTURES / "builtin_pages_snapshot.json").read_text(encoding="utf-8"))
LAYOUT_IDS = ["chat-canvas", "chat", "workbench", "command", "guided", "mission"]
LAYOUT_RECORDS = [f"builtin.layout-{i}" for i in LAYOUT_IDS]
#: The layout records that own pages: those whose frame ships the React page.
SHIPPED_LAYOUT_PAGES = {"guided": ("start", "templates")}
#: Shell-only pages that name a layout: page id -> (owning record, layouts).
#: Each arrives with the React page that renders it.
LAYOUT_PAGES = {"artifacts": ("builtin.artifacts", ["chat-canvas"])}
#: Shell-only pages for every layout (no ``layouts``): listed whenever the app
#: shell offers a layout, like the layout records' own pages.
ANY_LAYOUT_PAGES = {"connect", "api-reference"}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.delenv("AIUI_LAYOUT", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield data
    srv.reset_state()


def _client(style: str = "app", **cfg) -> TestClient:
    srv.set_style(style)
    return TestClient(srv.create_app(config=cfg or None))


def _manifest(client: TestClient) -> dict:
    return client.get("/api/shell/manifest").json()


def _page_ids(manifest: dict) -> list[str]:
    return [p["id"] for p in manifest["pages"]]


# ── the shell sees exactly the pages it saw before layouts ───────────


@pytest.mark.parametrize("layout", [None, "classic", "guided", "mission"])
def test_layout_records_add_only_their_shipped_pages_to_the_app_shell(layout, monkeypatch):
    # Regression: Guided start/templates and Mission ops-overview reached the
    # nav under every layout (start became the landing page) and nothing
    # rendered them. Pages join a layout record with the frame that draws them
    # (SHIPPED_LAYOUT_PAGES), and each names its layout, so the shell lists it
    # only while that layout is the frame and never lands on it otherwise.
    without = _page_ids(_manifest(_client(extensions={"disabled": LAYOUT_RECORDS})))
    srv.reset_state()
    if layout:
        monkeypatch.setenv("AIUI_LAYOUT", layout)
    with_layouts = _manifest(_client())
    assert [p["id"] for p in with_layouts["pages"] if not p.get("layouts") and p["id"] not in ANY_LAYOUT_PAGES] == without
    assert ANY_LAYOUT_PAGES <= {p["id"] for p in with_layouts["pages"]}
    owned = {p["id"]: p for p in with_layouts["pages"] if p.get("layouts")}
    assert sorted(owned) == sorted([i for ids in SHIPPED_LAYOUT_PAGES.values() for i in ids] + list(LAYOUT_PAGES))
    for lid, ids in SHIPPED_LAYOUT_PAGES.items():
        for pid in ids:
            assert owned[pid]["layouts"] == [lid] and owned[pid]["kind"] == "native", pid
            assert owned[pid]["source"] == f"builtin.layout-{lid}", pid
    for pid, (record, layouts) in LAYOUT_PAGES.items():
        assert (owned[pid]["source"], owned[pid]["layouts"], owned[pid]["kind"]) == (record, layouts, "native")
    assert [s["id"] for s in with_layouts["layouts"]["available"]] == LAYOUT_IDS
    assert "ops-overview" not in owned  # arrives with the Mission frame


def test_a_layouts_pages_leave_the_manifest_with_the_layout():
    m = _manifest(_client(extensions={"disabled": ["builtin.layout-guided"]}))
    assert not set(SHIPPED_LAYOUT_PAGES["guided"]) & set(_page_ids(m))
    assert "guided" not in [s["id"] for s in m["layouts"]["available"]]


def test_every_layout_home_is_a_manifest_page():
    m = _manifest(_client())
    ids = set(_page_ids(m))
    for spec in m["layouts"]["available"]:
        assert spec["home"] in ids, spec["id"]


# ── switching a layout off ───────────────────────────────────────────


def test_disabling_a_layout_removes_it_from_the_manifest():
    client = _client(extensions={"disabled": ["builtin.layout-guided"]})
    m = _manifest(client)
    assert [s["id"] for s in m["layouts"]["available"]] == [i for i in LAYOUT_IDS if i != "guided"]
    statuses = {r["name"]: r["status"] for r in client.get("/api/plugins?origin=builtin").json()["plugins"]}
    assert statuses["builtin.layout-guided"] == "disabled"
    assert statuses["builtin.layout-mission"] == "ok"


def test_disabling_the_default_layout_falls_back_to_the_next():
    m = _manifest(_client(extensions={"disabled": ["builtin.layout-chat-canvas"]}))
    assert m["layouts"]["default"] == "chat"  # the next by order


def test_a_plugin_layout_can_be_the_default():
    class _Deck:
        name = "deck"

        def layouts(self):
            return [LayoutSpec(id="deck", title="Deck", module="/x/deck.js")]

    aiui.register_plugin(_Deck())
    aiui.set_layout("deck")
    m = _manifest(_client())
    assert m["layouts"]["default"] == "deck"
    deck = next(s for s in m["layouts"]["available"] if s["id"] == "deck")
    assert deck["source"] == "plugin:deck" and deck["module"] == "/x/deck.js"


def test_plugin_layout_module_and_css_carry_sri(tmp_path):
    """plugins.md: a relative layout module gets an SRI hash and css is
    resolved the same way. The module hash must reach the import map (the
    layout is imported through it, possibly long after the manifest was
    built) and the css hash the manifest (cssIntegrity)."""
    import base64
    import hashlib

    static = tmp_path / "deck_static"
    static.mkdir()
    (static / "deck.js").write_text("export default function Deck() { return null }\n")
    (static / "deck.css").write_text(".deck { color: inherit }\n")

    def sri(name: str) -> str:
        digest = hashlib.sha384((static / name).read_bytes()).digest()
        return "sha384-" + base64.b64encode(digest).decode()

    class _Deck:
        name = "deck"

        def layouts(self):
            return [LayoutSpec(id="deck", title="Deck", module="deck.js", css="deck.css")]

        def static_dir(self):
            return static

    aiui.register_plugin(_Deck())
    client = _client()
    deck = next(s for s in _manifest(client)["layouts"]["available"] if s["id"] == "deck")
    assert deck["module"] == "/_plugins/deck/deck.js" and deck["integrity"] == sri("deck.js")
    assert deck["css"] == "/_plugins/deck/deck.css" and deck["cssIntegrity"] == sri("deck.css")
    html = client.get("/").text
    importmap = json.loads(html.split('<script type="importmap">', 1)[1].split("</script>", 1)[0])
    assert importmap["integrity"]["/_plugins/deck/deck.js"] == sri("deck.js")


# ── a built-in shell-only page (the mechanism the layout tracks use) ─


def _register_layout_page() -> None:
    get_plugin_registry().register_builtin(
        BuiltinPlugin(
            "layout-test",
            "A test owner of a mission page",
            (
                page("ops-test", "Overview", "📊", "Control", "Ops", 10, kind="native", nav_icon="gauge",
                     shell_only=True, layouts=("mission",), replaces="overview"),
            ),
        )
    )


def _layout_rows(manifest: dict) -> dict[str, dict]:
    return {p["id"]: p for p in manifest["pages"] if p["source"] == "builtin.layout-test"}


def test_a_shell_only_page_reaches_the_manifest_with_its_data_and_nothing_else():
    srv.set_style("app")
    app = srv.create_app()
    _register_layout_page()
    client = TestClient(app)
    rows = _layout_rows(_manifest(client))
    assert set(rows) == {"ops-test"}
    row = rows["ops-test"]
    assert row["layouts"] == ["mission"] and row["replaces"] == "overview"
    assert row["kind"] == "native" and row["navIcon"] == "gauge"
    assert "shellOnly" not in row and "shell_only" not in row
    assert "ops-test" not in {p["id"] for p in client.get("/api/pages").json()["pages"]}
    assert "ops-test" not in srv._pages
    nav = {"type": "http", "method": "GET", "path": "/ops-test",
           "headers": [(b"sec-fetch-mode", b"navigate")]}
    assert srv._is_page_navigation(nav)


def test_a_shell_only_page_follows_the_layouts_on_offer():
    for available, expected in ((["chat-canvas", "mission"], {"ops-test"}), (["workbench"], set())):
        srv.reset_state()
        aiui.set_layout(available=available)
        srv.set_style("app")
        app = srv.create_app()
        _register_layout_page()
        assert set(_layout_rows(_manifest(TestClient(app)))) == expected


def test_page_navigation_does_not_resolve_layouts_without_shell_only_pages(monkeypatch):
    from praisonaiui import layouts

    calls = []
    real = layouts.resolve
    monkeypatch.setattr(layouts, "resolve", lambda *a, **k: calls.append(1) or real(*a, **k))
    # Records that declare a shell-only page (a later track's) are switched off.
    owners = [f"builtin.{p.name}" for p in BUILTIN_PLUGINS if p.shell_pages()]
    _client(extensions={"disabled": owners}) if owners else _client()
    calls.clear()  # create_app resolves them once to gate for_layouts records
    nav = {"type": "http", "method": "GET", "path": "/chat", "headers": [(b"sec-fetch-mode", b"navigate")]}
    assert srv._is_page_navigation(nav)
    assert calls == []


def test_an_app_page_with_the_same_id_wins_over_a_shell_only_page():
    srv.set_style("app")
    app = srv.create_app()
    _register_layout_page()
    srv.register_page("ops-test", title="Mine", handler=lambda: {"_components": []})
    rows = [p for p in _manifest(TestClient(app))["pages"] if p["id"] == "ops-test"]
    assert len(rows) == 1 and rows[0]["source"] == "app"


# ── R6: the default style is untouched ───────────────────────────────


def _golden_dashboard() -> str:
    out, current = {}, None
    for line in (FIXTURES / "golden_dashboard_html.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^===== style=(\w+) =====$", line)
        if m:
            current = m.group(1)
            out[current] = ""
        elif current is not None:
            out[current] += line
    return out["dashboard"]


@pytest.mark.parametrize("chosen", [False, True])
def test_dashboard_html_and_pages_unchanged_even_with_a_layout_chosen(chosen, monkeypatch):
    if chosen:
        aiui.set_layout("command", available=["command", "guided"])
    client = _client("dashboard")
    _register_layout_page()
    monkeypatch.setattr(srv, "_server_start_time", 0)
    assert srv._build_html("dashboard") == _golden_dashboard()
    rows = [p for p in client.get("/api/pages").json()["pages"]
            if p["id"] in SNAPSHOT["insertion_order"] and "api_endpoint" in p]
    assert rows == SNAPSHOT["api_pages"]
    assert list(srv._pages) == SNAPSHOT["insertion_order"]
    m = _manifest(client)
    assert m["layouts"] == {"default": "", "userChoice": True, "available": []}
    assert _layout_rows(m) == {}
