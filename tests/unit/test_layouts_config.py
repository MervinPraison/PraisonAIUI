"""Selectable layouts: the server's choice (ADR 0003, F2).

Precedence for the default: ``AIUI_LAYOUT`` > ``set_layout()`` > YAML
``layout:`` > the style default (``chat-canvas`` for ``style: app``). Layouts
apply to ``style: app`` only; elsewhere they are ignored with one warning.
"""

from __future__ import annotations

import logging
import subprocess
import sys

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui import layouts
from praisonaiui.builtin.catalog import STYLE_DEFAULT_LAYOUT

BUILTIN_ORDER = ["chat-canvas", "workbench", "command", "guided", "mission"]


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.delenv(layouts.LAYOUT_ENV, raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield data
    srv.reset_state()


def _layouts(style: str = "app", **cfg) -> dict:
    srv.set_style(style)
    client = TestClient(srv.create_app(config=cfg or None))
    return client.get("/api/shell/manifest").json()["layouts"]


def _ids(manifest_layouts: dict) -> list[str]:
    return [s["id"] for s in manifest_layouts["available"]]


# ── defaults ─────────────────────────────────────────────────────────


def test_app_style_defaults_to_chat_canvas_with_every_builtin_layout():
    assert STYLE_DEFAULT_LAYOUT == {"app": "chat-canvas"}
    got = _layouts()
    assert got["default"] == "chat-canvas"
    assert got["userChoice"] is True
    assert _ids(got) == BUILTIN_ORDER
    by_id = {s["id"]: s for s in got["available"]}
    assert by_id["guided"]["home"] == "chat"  # "start" comes with the Guided frame (track G)
    assert by_id["mission"]["home"] == "overview"
    assert by_id["chat-canvas"]["title"] == "Chat and Canvas"
    for spec in got["available"]:
        assert spec["source"] == "builtin"
        assert "module" not in spec  # first-party frames ship in the bundle
        assert 1 <= len(spec["primary"]) <= 7
        assert "options" not in spec


@pytest.mark.parametrize("style", ["dashboard", "chat"])
def test_other_styles_offer_no_layout(style):
    assert _layouts(style) == {"default": "", "userChoice": True, "available": []}


def test_the_inline_boot_manifest_carries_the_same_layouts():
    srv.set_style("app")
    client = TestClient(srv.create_app())
    html = client.get("/").text
    raw = html.split('<script id="aiui-boot" type="application/json">', 1)[1]
    import json

    boot = json.loads(raw.split("</script>", 1)[0])
    assert boot["layouts"] == client.get("/api/shell/manifest").json()["layouts"]


# ── precedence ───────────────────────────────────────────────────────


def test_yaml_string_shorthand_from_the_create_app_config():
    assert _layouts(layout="workbench")["default"] == "workbench"


def test_yaml_from_the_config_store(_isolated):
    (_isolated / "config.yaml").write_text("layout: {default: guided, userChoice: false}\n")
    config_store.init_config_store(_isolated / "config.yaml")
    got = _layouts()
    assert got["default"] == "guided" and got["userChoice"] is False


def test_set_layout_beats_yaml():
    aiui.set_layout("command")
    assert _layouts(layout="workbench")["default"] == "command"


def test_env_beats_set_layout(monkeypatch):
    aiui.set_layout("command")
    monkeypatch.setenv(layouts.LAYOUT_ENV, "mission")
    assert _layouts(layout="workbench")["default"] == "mission"


@pytest.mark.parametrize("how", ["yaml", "code", "env"])
def test_classic_means_the_shells_own_frame(how, monkeypatch):
    cfg = {}
    if how == "yaml":
        cfg["layout"] = "classic"
    elif how == "code":
        aiui.set_layout("classic")
    else:
        monkeypatch.setenv(layouts.LAYOUT_ENV, "classic")
    got = _layouts(**cfg)
    assert got["default"] == ""
    assert _ids(got) == BUILTIN_ORDER  # still offered in the picker


def test_set_layout_merges_only_the_arguments_passed():
    aiui.set_layout("command")
    aiui.set_layout(user_choice=False)
    got = _layouts()
    assert got["default"] == "command" and got["userChoice"] is False


def test_reset_state_forgets_set_layout():
    aiui.set_layout("command", user_choice=False)
    srv.reset_state()
    got = _layouts()
    assert got["default"] == "chat-canvas" and got["userChoice"] is True


# ── available, primary, options ──────────────────────────────────────


def test_available_sets_picker_order_and_default_falls_back_to_the_first():
    aiui.set_layout(available=["command", "workbench"])
    got = _layouts()
    assert _ids(got) == ["command", "workbench"]
    assert got["default"] == "command"  # chat-canvas is not offered


def test_yaml_dict_with_available_and_options():
    got = _layouts(
        layout={
            "default": "mission",
            "available": ["mission", "chat-canvas"],
            "options": {"mission": {"dailyBudget": 10}},
        }
    )
    assert got["default"] == "mission"
    assert _ids(got) == ["mission", "chat-canvas"]
    by_id = {s["id"]: s for s in got["available"]}
    assert by_id["mission"]["options"] == {"dailyBudget": 10}
    assert "options" not in by_id["chat-canvas"]


def test_primary_from_config_wins_for_every_layout():
    aiui.set_layout(primary=["chat", "logs"])
    for spec in _layouts()["available"]:
        assert spec["primary"] == ["chat", "logs"]


def test_existing_chat_position_keys_still_work_beside_layouts():
    got = _layouts(layout={"mode": "sidebar", "width": "400px"})
    assert got["default"] == "chat-canvas"


# ── unknown ids and warnings ─────────────────────────────────────────


def test_unknown_available_id_is_dropped_with_one_warning(caplog):
    aiui.set_layout(available=["nope", "command"])
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        assert _ids(_layouts()) == ["command"]
        TestClient(srv.create_app()).get("/api/shell/manifest")
    msgs = [r.getMessage() for r in caplog.records if "'nope'" in r.getMessage()]
    assert len(msgs) == 1 and "not available" in msgs[0]


def test_unknown_default_falls_back_with_one_warning(caplog):
    aiui.set_layout("nope", available=["workbench", "command"])
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        got = _layouts()
    assert got["default"] == "workbench"
    assert any("default layout 'nope' is not available; using 'workbench'" in r.getMessage()
               for r in caplog.records)


def test_bad_env_value_is_ignored_with_a_warning(monkeypatch, caplog):
    monkeypatch.setenv(layouts.LAYOUT_ENV, "Not A Layout")
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        assert _layouts()["default"] == "chat-canvas"
    assert any(layouts.LAYOUT_ENV in r.getMessage() for r in caplog.records)


def test_bad_yaml_entry_is_dropped_and_the_rest_kept(caplog):
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        got = _layouts(layout={"default": "Bad!", "available": ["command", "workbench"]})
    assert _ids(got) == ["command", "workbench"] and got["default"] == "command"
    assert any("layout.default ignored" in r.getMessage() for r in caplog.records)


def test_layout_outside_style_app_warns_once_and_never_flips_the_style(caplog):
    aiui.set_layout("command")
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        assert _layouts("dashboard")["available"] == []
        TestClient(srv.create_app()).get("/api/shell/manifest")
    warned = [r.getMessage() for r in caplog.records if "layout ignored" in r.getMessage()]
    assert warned == ["layout ignored: style is 'dashboard'; use style: app"]
    assert srv._effective_style == "dashboard"


def test_aiui_shell_legacy_kill_switch_ignores_the_layout(monkeypatch, caplog):
    monkeypatch.setenv("AIUI_SHELL", "legacy")
    aiui.set_layout("command")
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        assert _layouts("app")["available"] == []
    assert srv._effective_style == "dashboard"
    assert any("layout ignored" in r.getMessage() for r in caplog.records)


def test_no_style_set_and_nothing_chosen_logs_nothing(caplog):
    with caplog.at_level(logging.WARNING, logger="praisonaiui.layouts"):
        _layouts("dashboard")
    assert not [r for r in caplog.records if r.name == "praisonaiui.layouts"]


# ── set_layout() API ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "kwargs",
    [
        {"default": "Command"},
        {"default": "x" * 41},
        {"default": "1st"},
        {"available": ["classic"]},
        {"available": "command"},
        {"options": {"mission": 3}},
        {"options": {"Bad": {}}},
        {"primary": "chat"},
    ],
)
def test_set_layout_rejects_bad_values(kwargs):
    with pytest.raises(ValueError):
        aiui.set_layout(**kwargs)


def test_set_layout_is_exported_lazily():
    assert "set_layout" in aiui.__all__ and "LayoutSpec" in aiui.__all__
    assert aiui.set_layout is layouts.set_layout
    out = subprocess.run(
        [sys.executable, "-c", "import sys, praisonaiui; print('praisonaiui.layouts' in sys.modules)"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert out.stdout.strip() == "False"


def test_resolve_reads_the_registry_for_an_explicit_style():
    from praisonaiui.builtin import register_builtin_plugins
    from praisonaiui.plugin_registry import get_plugin_registry

    reg = get_plugin_registry()
    register_builtin_plugins(reg)
    sel = layouts.resolve(reg, "app")
    assert sel.ids == BUILTIN_ORDER and sel.default == "chat-canvas"
    assert layouts.resolve(reg, "dashboard").ids == []
