"""YAML ``layout:`` (``LayoutConfig``) and ``aiui validate`` warnings (ADR 0003, F2).

``LayoutConfig`` is extended additively: the chat position keys (``mode``,
``width``, ``height``) keep working, and a bare string is shorthand for
``{default: <id>}``.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from praisonaiui.schema.models import Config, LayoutConfig
from praisonaiui.schema.validators import builtin_layout_ids, find_unknown_keys, validate_config

SITE = {"title": "T"}


def test_string_is_shorthand_for_default():
    cfg = Config.model_validate({"site": SITE, "style": "app", "layout": "command"})
    assert cfg.layout is not None
    assert cfg.layout.default == "command"
    assert cfg.layout.mode == "fullscreen"  # chat position default unchanged
    assert cfg.layout.user_choice is True and cfg.layout.available is None


def test_full_form_with_alias_and_options():
    lc = LayoutConfig.model_validate(
        {
            "default": "mission",
            "available": ["mission", "chat-canvas"],
            "userChoice": False,
            "primary": ["overview", "agents"],
            "options": {"mission": {"dailyBudget": 10}},
        }
    )
    assert lc.user_choice is False
    assert lc.options == {"mission": {"dailyBudget": 10}}
    assert LayoutConfig.model_validate({"user_choice": False}).user_choice is False


def test_existing_chat_position_config_is_unchanged():
    lc = LayoutConfig.model_validate({"mode": "sidebar", "width": "400px"})
    assert (lc.mode, lc.width, lc.height, lc.default) == ("sidebar", "400px", None, None)
    assert find_unknown_keys(Config, {"site": SITE, "layout": {"mode": "sidebar", "userChoice": True}}) == []


def test_classic_is_a_valid_default_but_not_a_layout():
    assert LayoutConfig.model_validate("classic").default == "classic"
    lc = LayoutConfig.model_validate({"available": ["classic"]})
    assert lc.available is None and "reserved" in lc.rejected["available"]


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("Command", "default"),
        ("1st", "default"),
        ("a" * 41, "default"),
        ({"default": "Bad_Id"}, "default"),
        ({"available": ["ok", "Not OK"]}, "available"),
        ({"available": "command"}, "available"),
        ({"options": {"BAD": {}}}, "options"),
        ({"options": {"mission": 3}}, "options"),
        ({"primary": "chat"}, "primary"),
    ],
)
def test_a_malformed_entry_is_dropped_and_never_fails_the_config(raw, key):
    # Before layouts, these keys were ignored; a config that loaded must still load.
    lc = LayoutConfig.model_validate(raw)
    assert getattr(lc, key) in (None, {}) and key in lc.rejected
    cfg = Config.model_validate({"site": SITE, "style": "app", "layout": raw})
    result = validate_config(cfg)
    warns = [w for w in result.warnings if w.code == 5103]
    assert len(warns) == 1 and f"layout.{key} ignored" in warns[0].message
    assert result.valid


def test_a_malformed_entry_keeps_the_rest_of_the_section():
    lc = LayoutConfig.model_validate(
        {"mode": "sidebar", "default": "Bad!", "available": ["command", "workbench"], "userChoice": False}
    )
    assert (lc.mode, lc.default, lc.available, lc.user_choice) == ("sidebar", None, ["command", "workbench"], False)
    assert list(lc.rejected) == ["default"]


def test_the_server_and_validate_drop_the_same_entries():
    from praisonaiui.layouts import split_selection

    raw = {"default": "Bad!", "available": ["command"], "primary": "chat"}
    assert set(split_selection(raw)[1]) == set(LayoutConfig.model_validate(raw).rejected) == {"default", "primary"}


def test_a_wrong_chat_position_still_fails_as_before():
    with pytest.raises(ValidationError):
        LayoutConfig.model_validate({"mode": "nowhere"})


def _codes(cfg: dict) -> list[int]:
    result = validate_config(Config.model_validate({"site": SITE, **cfg}))
    return [w.code for w in result.warnings]


def test_builtin_layout_ids_come_from_the_catalog():
    assert builtin_layout_ids() == ["chat-canvas", "workbench", "command", "guided", "mission"]


def test_validate_warns_5101_on_an_unknown_layout_id():
    result = validate_config(
        Config.model_validate({"site": SITE, "style": "app", "layout": {"default": "deck", "available": ["deck", "command"]}})
    )
    warns = [w for w in result.warnings if w.code == 5101]
    assert len(warns) == 1 and "'deck'" in warns[0].message
    assert result.valid  # a plugin may still provide it


@pytest.mark.parametrize("layout", ["command", "classic", {"available": ["guided", "mission"]}, {"mode": "sidebar"}])
def test_validate_is_quiet_for_builtin_layouts_under_style_app(layout):
    assert _codes({"style": "app", "layout": layout}) == []


def test_validate_warns_5102_when_the_style_is_not_app():
    assert _codes({"style": "dashboard", "layout": "command"}) == [5102]
    assert _codes({"style": "dashboard", "layout": {"mode": "sidebar"}}) == []
