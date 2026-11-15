"""Layout records and the ``layouts()`` hook (ADR 0003, F2).

Each built-in layout is a ``builtin.layout-<id>`` record whose plugin
declares one :class:`LayoutSpec`. Third-party plugins use the same hook.
Pages gain ``shell_only``, ``layouts`` and ``replaces``: a ``shell_only``
page never enters the page table, ``/api/pages`` or the dashboard (R6).

No layout record owns a page yet. A layout's own pages (Guided ``start`` and
``templates``, Mission ``ops-overview``) arrive with the track that ships
their React page; listing them earlier gave the shell nav items it could
not render.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin import BUILTIN_PLUGINS, BuiltinPlugin, page, register_builtin_plugins
from praisonaiui.plugin_registry import LayoutSpec, PageSpec, get_plugin_registry

FIXTURES = Path(__file__).parent / "fixtures"
SNAPSHOT = json.loads((FIXTURES / "builtin_pages_snapshot.json").read_text(encoding="utf-8"))
LAYOUT_IDS = ["chat-canvas", "workbench", "command", "guided", "mission"]


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


def _registry():
    reg = get_plugin_registry()
    register_builtin_plugins(reg)
    return reg


# ── the built-in records ─────────────────────────────────────────────


def test_one_record_per_builtin_layout():
    recs = {p.name: p for p in BUILTIN_PLUGINS if p.name.startswith("layout-")}
    assert sorted(recs) == sorted(f"layout-{i}" for i in LAYOUT_IDS)
    for lid in LAYOUT_IDS:
        specs = recs[f"layout-{lid}"].layouts()
        assert [s.id for s in specs] == [lid]
        assert isinstance(specs[0], LayoutSpec) and specs[0].source == "builtin"
        assert not recs[f"layout-{lid}"].feature_refs  # frames only; data is its own record
    # Layout records add no page-table page: the catalog still holds the 38.
    assert [s.id for p in BUILTIN_PLUGINS for s in p.pages()] == SNAPSHOT["insertion_order"]


def test_no_layout_record_owns_a_page_before_its_frame_ships():
    # A page here reaches the app shell nav at once, under every layout, and
    # nothing in the bundle renders it yet (the regression this guards).
    for plugin in BUILTIN_PLUGINS:
        if plugin.name.startswith("layout-"):
            assert plugin.shell_pages() == [] and plugin.pages() == [], plugin.name


def test_every_builtin_layout_opens_on_a_page_that_exists():
    pages = set(SNAPSHOT["insertion_order"])
    for spec in _registry().layout_specs():
        assert spec.home in pages, (spec.id, spec.home)
        assert spec.primary and 1 <= len(spec.primary) <= 7
        assert spec.primary[0] in pages or spec.home in spec.primary


def test_layout_records_are_listed_ok_and_never_as_third_party():
    reg = _registry()
    names = {r.name: r for r in reg.builtin_records()}
    for lid in LAYOUT_IDS:
        assert names[f"builtin.layout-{lid}"].status == "ok"
    assert reg.records_for_manifest(restricted=False) == []
    assert [s.id for s in reg.layout_specs()] == LAYOUT_IDS


def test_a_disabled_layout_record_declares_no_layout():
    aiui.set_extensions(disabled=["builtin.layout-guided"])
    assert [s.id for s in _registry().layout_specs()] == [i for i in LAYOUT_IDS if i != "guided"]


def test_layout_spec_wire_form():
    spec = next(s for s in _registry().layout_specs() if s.id == "mission")
    d = spec.to_dict()
    assert d["id"] == "mission" and d["home"] == "overview" and d["source"] == "builtin"
    assert isinstance(d["primary"], list) and "module" not in d


# ── shell-only pages of a built-in record (the mechanism) ────────────


def _owner(*pages_: PageSpec) -> BuiltinPlugin:
    return BuiltinPlugin("layout-test", "A test layout with pages", pages_)


def test_shell_only_pages_stay_out_of_the_page_table_and_follow_their_layouts():
    reg = _registry()
    reg.register_builtin(
        _owner(
            page("deck-home", "Home", "🏠", "Agent", "Start", 0, kind="native", shell_only=True,
                 layouts=("deck",), replaces="overview"),
            page("deck-any", "Any", "🧩", "Agent", "Any layout", 1, kind="native", shell_only=True),
        )
    )
    assert not {"deck-home", "deck-any"} & {s.id for s in reg.pages(origin="all")}
    assert [s.id for s in reg.shell_pages(["deck"])] == ["deck-home", "deck-any"]
    assert [s.id for s in reg.shell_pages(["other"])] == ["deck-any"]
    home = reg.shell_pages(["deck"])[0]
    assert home.shell_only and home.layouts == ("deck",) and home.replaces == "overview"
    assert home.source == "builtin.layout-test"
    assert "shellOnly" not in home.to_dict() and home.to_dict()["layouts"] == ["deck"]


def test_a_bad_shell_page_entry_is_dropped(caplog):
    reg = _registry()
    reg.register_builtin(_owner(page("bad", "Bad", "x", "Agent", "Bad", 0, shell_only=True, layouts="deck")))
    with caplog.at_level(logging.WARNING, logger="praisonaiui.plugin_registry"):
        assert reg.shell_pages(["deck"]) == []
    assert any("layouts must be a list" in r.getMessage() for r in caplog.records)


# ── third-party layouts: the same hook ───────────────────────────────


class _LayoutPlugin:
    name = "deck"

    def __init__(self, static: Path, layouts: list, pages: list | None = None) -> None:
        self._static, self._layouts, self._pages = static, layouts, pages or []

    def static_dir(self) -> Path:
        return self._static

    def layouts(self):
        return self._layouts

    def pages(self):
        return self._pages


def test_a_plugin_layout_resolves_its_module_into_the_static_dir(tmp_path, caplog):
    static = tmp_path / "static"
    static.mkdir()
    (static / "deck.js").write_text("export default {}\n")
    aiui.register_plugin(
        _LayoutPlugin(
            static,
            [
                {"id": "deck", "title": "Deck", "module": "deck.js", "order": 15,
                 "home": "chat", "primary": ["chat", "logs"]},
                {"id": "chat-canvas", "title": "Imposter", "module": "deck.js"},  # taken
                {"id": "classic", "title": "Nope", "module": "deck.js"},  # reserved
                {"id": "nomodule", "title": "No module"},
                {"id": "Bad Id", "title": "x", "module": "deck.js"},
                {"id": "escape", "title": "x", "module": "../outside.js"},
                {"id": "badorder", "title": "x", "module": "deck.js", "order": "first"},
            ],
        )
    )
    with caplog.at_level(logging.WARNING, logger="praisonaiui.plugin_registry"):
        specs = _registry().layout_specs()
    assert [s.id for s in specs] == [*LAYOUT_IDS, "deck"]  # built-ins first; resolve() sorts
    deck = specs[-1]
    assert deck.source == "plugin:deck" and deck.order == 15
    assert deck.module == "/_plugins/deck/deck.js"
    assert deck.integrity and deck.integrity.startswith("sha384-")
    assert deck.primary == ("chat", "logs") and deck.home == "chat"
    assert specs[0].title == "Chat and Canvas"
    logged = " ".join(r.getMessage() for r in caplog.records)
    for bad in ("'chat-canvas' ignored", "'classic'", "nomodule", "Bad Id", "escapes static dir",
                "order must be a number"):
        assert bad in logged


def test_a_plugin_layout_as_a_dataclass():
    aiui.register_plugin(
        _LayoutPlugin(Path(__file__).parent, [LayoutSpec(id="deck", title="Deck", module="/x/deck.js")])
    )
    deck = _registry().layout_specs()[-1]
    assert (deck.id, deck.module, deck.source) == ("deck", "/x/deck.js", "plugin:deck")


def test_plugin_pages_carry_layout_data_and_shell_only_keeps_blocks_out_of_api_pages(tmp_path):
    pages = [
        {"id": "deck-home", "title": "Deck home", "kind": "blocks", "shellOnly": True,
         "layouts": ["deck"], "replaces": "overview"},
        {"id": "deck-board", "title": "Board", "kind": "blocks"},
        {"id": "deck-bad", "title": "Bad", "kind": "blocks", "layouts": "deck"},
    ]
    aiui.register_plugin(_LayoutPlugin(tmp_path, [], pages))
    srv.set_style("app")
    client = TestClient(srv.create_app())
    rows = {p["id"]: p for p in client.get("/api/shell/manifest").json()["pages"]
            if p["source"] == "plugin:deck"}
    assert set(rows) == {"deck-home", "deck-board"}  # deck-bad: layouts is not a list
    assert rows["deck-home"]["layouts"] == ["deck"] and rows["deck-home"]["replaces"] == "overview"
    assert "shellOnly" not in rows["deck-home"]
    api_ids = {p["id"] for p in client.get("/api/pages").json()["pages"]}
    assert "deck-board" in api_ids and "deck-home" not in api_ids
