"""First-party plugins (``praisonaiui.builtin``).

The built-in pages are plugin records read through ``PluginRegistry``. These
tests pin the default output to a snapshot captured before the change, and
cover what the records add: a built-in can be switched off by policy.
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
from praisonaiui.plugin_registry import (
    ExtensionPolicy,
    PageSpec,
    PluginRegistry,
    get_plugin_registry,
    set_extensions,
)

SNAPSHOT = json.loads(
    (Path(__file__).parent / "fixtures" / "builtin_pages_snapshot.json").read_text(encoding="utf-8")
)
BUILTIN_IDS = SNAPSHOT["insertion_order"]


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Fresh server state and a private data dir / config store per test."""
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield data
    srv.reset_state()


def _client(**cfg) -> TestClient:
    return TestClient(srv.create_app(config=cfg or None))


def _wire(entries: list[dict]) -> list[str]:
    """Serialize like the JSON response does, so key order is compared too."""
    return [json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in entries]


def _api_pages(client: TestClient) -> list[dict]:
    return client.get("/api/pages").json()["pages"]


def _manifest_pages(client: TestClient) -> list[dict]:
    return client.get("/api/shell/manifest").json()["pages"]


def _builtin_only(pages: list[dict]) -> list[dict]:
    # Dashboard-plugin folders (bundled or in the user's home) add pages too;
    # theirs carry no api_endpoint.
    return [p for p in pages if p["id"] in BUILTIN_IDS and "api_endpoint" in p]


# ── the catalog ──────────────────────────────────────────────────────


def test_catalog_holds_the_38_pages_once_each():
    ids = [spec.id for plugin in BUILTIN_PLUGINS for spec in plugin.pages()]
    assert ids == BUILTIN_IDS
    assert len(ids) == len(set(ids)) == 38
    names = [p.name for p in BUILTIN_PLUGINS]
    assert len(names) == len(set(names))
    for plugin in BUILTIN_PLUGINS:
        for spec in plugin.pages():
            assert isinstance(spec, PageSpec)
            assert spec.source == "builtin" and spec.kind == "legacy"


def test_records_are_trusted_first_party_and_separate_from_third_party():
    reg = get_plugin_registry()
    register_builtin_plugins(reg)
    register_builtin_plugins(reg)  # idempotent
    recs = reg.builtin_records()
    assert [r.name for r in recs] == [f"builtin.{p.name}" for p in BUILTIN_PLUGINS]
    assert {r.origin for r in recs} == {"builtin"}
    assert {r.status for r in recs} == {"ok"}
    assert not any(r.autoloaded for r in recs)  # trusted, like register_plugin()
    assert all(r.version == aiui.__version__ and r.dist == "praisonaiui" for r in recs)
    # Third-party-facing queries are unchanged: no built-in leaks into them.
    assert reg.discover() == [] and reg.active() == []
    assert reg.pages() == [] and reg.pages(restricted=True) == []
    assert reg.records_for_manifest(restricted=False) == []
    assert [s.id for s in reg.pages(origin="builtin")] == BUILTIN_IDS
    assert [s.id for s in reg.pages(origin="all")] == BUILTIN_IDS
    assert reg.records("all") == recs and reg.records("third-party") == []


def test_reset_clears_builtins_and_create_app_restores_them():
    reg = get_plugin_registry()
    register_builtin_plugins(reg)
    reg.reset()
    assert reg.builtin_records() == []
    _client()
    assert len(reg.builtin_records()) == len(BUILTIN_PLUGINS)


# ── default output is unchanged ──────────────────────────────────────


@pytest.mark.parametrize("style", ["dashboard", "app"])
def test_default_pages_match_the_pre_change_snapshot(style):
    srv.set_style(style)
    client = _client()
    assert list(srv._pages) == BUILTIN_IDS
    assert _wire(_builtin_only(_api_pages(client))) == _wire(SNAPSHOT["api_pages"])
    builtin = [p for p in _manifest_pages(client) if p["source"] == "builtin"]
    assert _wire(builtin) == _wire(SNAPSHOT["manifest_pages"])
    # No plugin record shows up where only third-party plugins were listed.
    assert client.get("/api/shell/manifest").json()["plugins"] == []
    assert client.get("/api/plugins").content == b'{"plugins":[]}'


def test_api_plugins_can_list_builtins_on_request():
    client = _client()
    listed = client.get("/api/plugins?origin=builtin").json()["plugins"]
    assert [p["name"] for p in listed] == [f"builtin.{p.name}" for p in BUILTIN_PLUGINS]
    assert {p["origin"] for p in listed} == {"builtin"} and {p["status"] for p in listed} == {"ok"}
    assert client.get("/api/plugins?origin=all").json()["plugins"] == listed


# ── disabling a built-in ─────────────────────────────────────────────


def _assert_gone(client: TestClient, *gone: str) -> None:
    api_ids = [p["id"] for p in _builtin_only(_api_pages(client))]
    manifest_ids = [p["id"] for p in _manifest_pages(client) if p["source"] == "builtin"]
    expected = sorted(i for i in BUILTIN_IDS if i not in gone)
    assert sorted(api_ids) == expected
    assert sorted(manifest_ids) == expected
    # Every remaining page is exactly what it was.
    kept = [e for e in SNAPSHOT["api_pages"] if e["id"] not in gone]
    assert _wire(_builtin_only(_api_pages(client))) == _wire(kept)


def test_set_extensions_disables_a_builtin_page():
    set_extensions(disabled=["builtin.training"])
    client = _client()
    _assert_gone(client, "training")
    status = {p["name"]: p["status"] for p in client.get("/api/plugins?origin=builtin").json()["plugins"]}
    assert status["builtin.training"] == "disabled" and status["builtin.logs"] == "ok"


def test_disabling_a_multi_page_builtin_removes_all_its_pages():
    set_extensions(disabled=["builtin.work"])
    client = _client()
    _assert_gone(client, "work", "jobs-board", "kanban")
    # The bundled dashboard-plugins/kanban folder belongs to builtin.work: it
    # must not put the Kanban page straight back, in any of the three places
    # the dashboard reads it from.
    assert "kanban" not in {p["id"] for p in _api_pages(client)}
    assert "kanban" not in {p["id"] for p in _manifest_pages(client)}
    folders = {p["name"] for p in client.get("/api/dashboard/plugins").json()["plugins"]}
    assert "kanban" not in folders and "sample-board" in folders
    assert client.get("/dashboard-plugins/kanban/index.js").status_code == 404


def test_bundled_folders_are_untouched_by_default_and_by_other_disables():
    assert "kanban" in {
        p["name"] for p in _client().get("/api/dashboard/plugins").json()["plugins"]
    }
    srv.reset_state()
    set_extensions(disabled=["builtin.logs"])
    client = _client()
    assert "kanban" in {p["name"] for p in client.get("/api/dashboard/plugins").json()["plugins"]}
    assert client.get("/dashboard-plugins/kanban/index.js").status_code == 200


def test_user_folder_named_like_a_bundled_one_survives_the_disable(tmp_path):
    mine = tmp_path / "plugins" / "kanban"
    mine.mkdir(parents=True)
    (mine / "manifest.json").write_text('{"name": "kanban", "label": "My Board"}', encoding="utf-8")
    (mine / "index.js").write_text("// mine", encoding="utf-8")
    import praisonaiui.dashboard_plugins as dp

    # Same search order as a home-dir install: the user's folder comes first.
    real = dp._plugin_search_dirs
    dp._plugin_search_dirs = lambda extra=None: [tmp_path / "plugins", *real(extra)]
    try:
        set_extensions(disabled=["builtin.work"])
        client = _client()
        listed = {p["name"]: p for p in client.get("/api/dashboard/plugins").json()["plugins"]}
        assert listed["kanban"]["label"] == "My Board"
        assert client.get("/dashboard-plugins/kanban/index.js").text == "// mine"
    finally:
        dp._plugin_search_dirs = real


def test_yaml_plugin_dir_folders_survive_a_builtin_disable(_isolated, tmp_path):
    # The shell manifest also reads folders from the YAML dashboard.pluginDirs;
    # dropping the owned bundled folder must not drop those.
    extra = tmp_path / "yaml-plugins"
    mine = extra / "my-board"
    mine.mkdir(parents=True)
    (mine / "manifest.json").write_text(
        '{"name": "my-board", "label": "My Board", "tab": {"path": "/my-board"}}', encoding="utf-8"
    )
    (mine / "index.js").write_text("// mine", encoding="utf-8")
    (_isolated / "config.yaml").write_text(
        f"dashboard:\n  pluginDirs:\n    - {extra}\n", encoding="utf-8"
    )
    config_store._config_store = None
    srv.set_style("app")
    set_extensions(disabled=["builtin.work"])
    ids = {p["id"] for p in _manifest_pages(_client())}
    assert "my-board" in ids and "kanban" not in ids


@pytest.mark.parametrize("spelling",["builtin.logs", "builtin-logs", "builtin:logs", "Builtin.Logs"])
def test_yaml_config_disables_a_builtin(spelling):
    _assert_gone(_client(extensions={"disabled": [spelling]}), "logs")


def test_data_dir_config_yaml_disables_a_builtin(_isolated):
    (_isolated / "config.yaml").write_text(
        "extensions:\n  disabled:\n    - builtin.code-studio\n", encoding="utf-8"
    )
    config_store._config_store = None
    _assert_gone(_client(), "code-studio")


def test_bare_page_id_does_not_disable_a_builtin():
    # "logs" is a third-party plugin name; built-ins need the builtin. prefix.
    _assert_gone(_client(extensions={"disabled": ["logs"]}))


def test_enabled_allowlist_only_restricts_third_party_plugins():
    set_extensions(enabled=["some-plugin"])
    _assert_gone(_client())
    assert ExtensionPolicy(enabled=["x"]).allows_builtin("builtin.chat")
    assert not ExtensionPolicy(disabled=["builtin.chat"]).allows_builtin("builtin.chat")


def test_unknown_builtin_name_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="praisonaiui.server"):
        _assert_gone(_client(extensions={"disabled": ["builtin.nope", "builtin.logs"]}), "logs")
    messages = [r.getMessage() for r in caplog.records]
    assert any("builtin.nope" in m for m in messages)
    assert not any("builtin.logs" in m for m in messages)


def test_policy_change_between_apps_drops_the_stale_page():
    client = _client()
    assert "training" in {p["id"] for p in _api_pages(client)}
    get_plugin_registry().set_policy(ExtensionPolicy(disabled=["builtin.training"]))
    _assert_gone(_client(), "training")
    get_plugin_registry().set_policy(ExtensionPolicy())
    _assert_gone(_client())


def test_disabled_builtin_does_not_build_its_pages():
    calls = []

    def _pages():
        calls.append(1)
        return (page("lazy-page", "Lazy", "L", "Control", "built on demand", 5),)

    reg = get_plugin_registry()
    reg.register_builtin(BuiltinPlugin("lazy", "test", _pages))
    set_extensions(disabled=["builtin.lazy"])
    client = _client()
    assert calls == []
    assert "lazy-page" not in {p["id"] for p in _api_pages(client)}


# ── existing page APIs keep working on top ───────────────────────────


def test_app_page_survives_disabling_the_builtin_with_the_same_id():
    aiui.register_page("training", title="My Training", icon="T", group="Custom")
    set_extensions(disabled=["builtin.training"])
    client = _client()
    mine = next(p for p in _api_pages(client) if p["id"] == "training")
    assert mine["title"] == "My Training"
    entry = next(p for p in _manifest_pages(client) if p["id"] == "training")
    assert entry["source"] == "app"


def test_register_page_still_overrides_a_builtin():
    aiui.register_page("logs", title="My Logs", icon="L", group="Custom")
    client = _client()
    assert next(p for p in _api_pages(client) if p["id"] == "logs")["title"] == "My Logs"
    sources = {p["id"]: p["source"] for p in _manifest_pages(client)}
    assert sources["logs"] == "app"
    # the built-in row is replaced, the rest untouched
    assert sorted(i for i, s in sources.items() if s == "builtin") == sorted(
        i for i in BUILTIN_IDS if i != "logs"
    )


def test_set_pages_whitelist_and_policy_compose():
    aiui.set_pages(["chat", "training", "logs"])
    set_extensions(disabled=["builtin.training"])
    client = _client()
    assert sorted(p["id"] for p in _builtin_only(_api_pages(client))) == ["chat", "logs"]


def test_set_pages_hides_one_page_of_a_multi_page_builtin():
    aiui.set_pages([i for i in BUILTIN_IDS if i != "jobs-board"])
    _assert_gone(_client(), "jobs-board")  # only the one page, not all of builtin.work


def test_remove_page_and_custom_js_still_work(tmp_path):
    js = tmp_path / "custom.js"
    js.write_text("window.__mine = 1;", encoding="utf-8")
    aiui.set_custom_js(js)
    client = _client()
    srv.remove_page("debug")
    assert "debug" not in {p["id"] for p in _api_pages(client)}
    assert client.get("/custom.js").text == "window.__mine = 1;"


def test_third_party_page_takes_the_id_of_a_disabled_builtin():
    class Mine:
        name = "mine"

        def pages(self):
            return [PageSpec(id="training", title="Plugin Training", kind="blocks")]

    get_plugin_registry().register(Mine())
    client = _client()
    by_id = {p["id"]: p for p in _manifest_pages(client)}
    assert by_id["training"]["source"] == "builtin"  # built-in wins while enabled

    srv.reset_state()
    get_plugin_registry().register(Mine())
    set_extensions(disabled=["builtin.training"])
    by_id = {p["id"]: p for p in _manifest_pages(_client())}
    assert by_id["training"]["source"] == "plugin:mine"
    assert by_id["training"]["title"] == "Plugin Training"


# ── registry unit behaviour ──────────────────────────────────────────


def test_register_builtin_replaces_same_name_and_rejects_bad_names():
    reg = PluginRegistry()
    first = BuiltinPlugin("demo", "one", (page("demo", "Demo", "D", "Control", "", 1),))
    second = BuiltinPlugin("demo", "two", (page("demo2", "Demo 2", "D", "Control", "", 1),))
    reg.register_builtin(first)
    reg.register_builtin(second)
    assert [r.name for r in reg.builtin_records()] == ["builtin.demo"]
    assert [s.id for s in reg.pages(origin="builtin")] == ["demo2"]
    with pytest.raises(ValueError):
        reg.register_builtin(BuiltinPlugin("???"))


def test_host_supplied_builtin_is_not_overwritten_by_the_catalog():
    reg = PluginRegistry()
    mine = BuiltinPlugin("logs", "replacement", (page("logs", "Audit", "A", "Settings", "", 20),))
    reg.register_builtin(mine)
    register_builtin_plugins(reg)
    logs = next(r for r in reg.builtin_records() if r.name == "builtin.logs")
    assert logs.plugin is mine
    assert len(reg.builtin_records()) == len(BUILTIN_PLUGINS)


def test_builtin_page_failures_are_isolated(caplog):
    class Broken:
        name = "broken"

        def pages(self):
            raise RuntimeError("boom")

    reg = PluginRegistry()
    reg.register_builtin(Broken())
    reg.register_builtin(BuiltinPlugin("ok", "", (page("ok", "OK", "O", "Control", "", 1),)))
    with caplog.at_level(logging.WARNING):
        assert [s.id for s in reg.pages(origin="builtin")] == ["ok"]


def test_third_party_pages_cannot_carry_inline_svg():
    class Mine:
        name = "mine"

        def pages(self):
            return [PageSpec(id="mine", title="Mine", icon_svg="<svg onload=alert(1)/>")]

    reg = PluginRegistry()
    reg.register(Mine())
    (spec,) = reg.pages()
    assert spec.icon_svg is None and "iconSvg" not in spec.to_dict()


# ── G2: built-in features come from the same records ─────────────────

# The feature names create_app() registered before features moved into the
# plugin records (captured from feat/ui-reset).
DEFAULT_FEATURES = [
    "agents_crud", "agui", "approvals", "attachments", "auth", "browser_automation",
    "channels", "chat", "code_execution", "config_hot_reload", "config_runtime",
    "device_pairing", "eval", "guardrails", "hooks", "i18n", "jobs", "kanban",
    "knowledge", "logs", "marketplace", "media_analysis", "memory", "model_fallback",
    "nodes", "openai_api", "protocol", "pwa", "realtime", "replay", "schedules",
    "security", "sessions_ext", "skills", "subagents", "surfaces", "telemetry", "theme",
    "tracing", "training", "tts", "usage", "video", "workflows",
]  # fmt: skip
REQUIRED_FEATURES = {"auth", "theme", "chat", "usage", "config_runtime", "sessions_ext"}
# Feature classes that exist but were never registered by default.
NOT_DEFAULT = {"AudioFeature", "LifecycleFeature", "WindowMessageFeature"}
FEATURES_DIR = Path(srv.__file__).parent / "features"


def _feature_names() -> list[str]:
    from praisonaiui.features import get_features

    return sorted(get_features())


def test_default_feature_set_is_unchanged():
    _client()
    assert _feature_names() == DEFAULT_FEATURES


def test_every_feature_class_belongs_to_exactly_one_builtin():
    import re

    declared = [(r.module, r.cls) for p in BUILTIN_PLUGINS for r in p.feature_refs]
    assert len(declared) == len(set(declared)) == len(DEFAULT_FEATURES)
    in_package = set()
    for path in FEATURES_DIR.glob("*.py"):
        for cls in re.findall(r"^class (\w+)\(BaseFeatureProtocol\)", path.read_text("utf-8"), re.M):
            in_package.add((f".{path.stem}", cls))
    # A new feature module must be given to a built-in record (or listed here).
    assert set(declared) == {(m, c) for m, c in in_package if c not in NOT_DEFAULT}


def test_required_features_are_the_ones_the_host_needs():
    required = {
        r.load().feature_name for p in BUILTIN_PLUGINS for r in p.feature_refs if r.required
    }
    assert required == REQUIRED_FEATURES
    reg = get_plugin_registry()
    register_builtin_plugins(reg)
    flagged = {r.name for r in reg.builtin_records() if r.required}
    assert flagged == {
        "builtin.auth", "builtin.chat", "builtin.config",
        "builtin.sessions", "builtin.theme-picker", "builtin.usage",
    }  # fmt: skip
    listed = {p["name"]: p for p in _client().get("/api/plugins?origin=builtin").json()["plugins"]}
    assert listed["builtin.auth"]["required"] is True and "required" not in listed["builtin.logs"]


def test_disabling_a_builtin_unmounts_its_feature_routes():
    client = _client()
    assert client.get("/api/training/status").status_code == 200
    srv.reset_state()
    set_extensions(disabled=["builtin.training"])
    client = _client()
    assert "training" not in _feature_names()
    assert set(_feature_names()) == set(DEFAULT_FEATURES) - {"training"}
    for path in ("/api/training/status", "/api/training/sessions"):
        assert client.get(path).status_code == 404
    _assert_gone(client, "training")
    assert "training" not in {f["name"] for f in client.get("/api/features").json()["features"]}


def test_feature_only_builtin_can_be_disabled():
    def _paths(app) -> set[str]:
        return {getattr(r, "path", "") for r in app.routes}

    app = srv.create_app()
    assert "/api/video/projects" in _paths(app)
    assert "video-studio" in {p["id"] for p in _manifest_pages(TestClient(app))}
    srv.reset_state()
    set_extensions(disabled=["builtin.video"])
    app = srv.create_app()
    client = TestClient(app)
    assert "video" not in _feature_names()
    assert not any(p.startswith("/api/video") for p in _paths(app))
    assert client.get("/api/video/projects").status_code == 404
    # The bundled Video Studio folder only talks to /api/video: it goes too.
    assert "video-studio" not in {p["id"] for p in _manifest_pages(client)}
    assert client.get("/dashboard-plugins/video-studio/index.js").status_code == 404
    _assert_gone(client)  # no built-in page belongs to builtin.video


def test_required_feature_stays_on_with_a_warning(caplog):
    set_extensions(disabled=["builtin.auth", "builtin.chat"])
    with caplog.at_level(logging.WARNING, logger="praisonaiui.features"):
        client = _client()
    assert {"auth", "chat"} <= set(_feature_names())
    # chat's optional feature goes, its required one stays
    assert "attachments" not in _feature_names()
    assert client.get("/api/auth/status").status_code != 404
    _assert_gone(client, "auth", "chat", "chat-canvas")
    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "builtin.auth is disabled, but the server needs its auth feature" in messages
    assert "builtin.chat is disabled, but the server needs its chat feature" in messages


def test_policy_change_between_apps_unmounts_and_restores_features():
    _client()
    assert "training" in _feature_names()
    get_plugin_registry().set_policy(ExtensionPolicy(disabled=["builtin.training"]))
    client = _client()
    assert "training" not in _feature_names()
    assert client.get("/api/training/status").status_code == 404
    get_plugin_registry().set_policy(ExtensionPolicy())
    client = _client()
    assert _feature_names() == DEFAULT_FEATURES
    assert client.get("/api/training/status").status_code == 200


def test_disabled_builtin_does_not_import_its_feature_module():
    import importlib
    from unittest import mock

    from praisonaiui.features import auto_register_defaults

    seen: list[str] = []
    real = importlib.import_module

    def _spy(name, package=None):
        seen.append(name)
        return real(name, package=package)

    set_extensions(disabled=["builtin.training"])
    with mock.patch("importlib.import_module", side_effect=_spy):
        auto_register_defaults()
    assert ".training" not in seen and ".chat" in seen


def test_register_feature_still_replaces_a_builtin_and_survives_a_disable():
    from praisonaiui.features import auto_register_defaults, get_feature, register_feature
    from praisonaiui.features.training import TrainingFeature

    class MyTraining(TrainingFeature):
        pass

    mine = MyTraining()
    register_feature(mine)
    try:
        auto_register_defaults()
        assert get_feature("training") is mine
        set_extensions(disabled=["builtin.training"])
        auto_register_defaults()
        assert get_feature("training") is mine  # the app's own feature is not unregistered
    finally:
        from praisonaiui.features import _features

        _features.pop("training", None)
        srv.reset_state()
        auto_register_defaults()


def test_auto_register_defaults_works_without_create_app():
    from praisonaiui.features import _features, auto_register_defaults

    get_plugin_registry().reset()
    _features.clear()
    auto_register_defaults()
    assert _feature_names() == DEFAULT_FEATURES
    assert len(get_plugin_registry().builtin_records()) == len(BUILTIN_PLUGINS)


def test_a_broken_builtin_features_hook_does_not_block_the_rest(caplog):
    from praisonaiui.features import auto_register_defaults

    class Broken:
        name = "broken"

        def features(self):
            raise RuntimeError("boom")

    get_plugin_registry().register_builtin(Broken())
    with caplog.at_level(logging.WARNING, logger="praisonaiui.features"):
        auto_register_defaults()
    assert _feature_names() == DEFAULT_FEATURES
    assert any("builtin.broken" in r.getMessage() for r in caplog.records)


def test_plugin_feature_takes_the_name_of_a_disabled_builtin():
    from praisonaiui.features import get_feature
    from praisonaiui.features.training import TrainingFeature

    class PluginTraining(TrainingFeature):
        pass

    class Mine:
        name = "mine"

        def features(self):
            return [PluginTraining()]

    get_plugin_registry().register(Mine())
    _client()
    assert type(get_feature("training")) is TrainingFeature  # built-in wins while enabled

    from praisonaiui.features import _features

    _features.pop("training", None)
    srv.reset_state()
    get_plugin_registry().register(Mine())
    set_extensions(disabled=["builtin.training"])
    _client()
    assert type(get_feature("training")) is PluginTraining
    _features.pop("training", None)


def test_no_builtin_feature_route_is_shadowed():
    """Built-in features register in record order, which is not the order of
    the old hardcoded list. That is only safe while no route of one feature
    can match a path that another feature serves (either way round)."""
    import re

    from starlette.routing import WebSocketRoute

    from praisonaiui.features import auto_register_defaults, get_features

    auto_register_defaults()
    routes = [
        (name, r)
        for name, feat in get_features().items()
        for r in feat.routes()
        if hasattr(r, "path_regex")
    ]
    assert len(routes) > 200  # sanity: the scan really sees the feature routes

    def concrete(path: str) -> str:
        return re.sub(r"\{[^}]+\}", "x", path)

    clashes = []
    for i, (n1, r1) in enumerate(routes):
        for n2, r2 in routes[i + 1 :]:
            if n1 == n2 or isinstance(r1, WebSocketRoute) != isinstance(r2, WebSocketRoute):
                continue
            methods = (getattr(r1, "methods", None) or {"WS"}) & (
                getattr(r2, "methods", None) or {"WS"}
            )
            if methods and (
                r1.path_regex.match(concrete(r2.path)) or r2.path_regex.match(concrete(r1.path))
            ):
                clashes.append((n1, r1.path, n2, r2.path))
    assert clashes == []
