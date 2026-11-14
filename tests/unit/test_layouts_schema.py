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
    with pytest.raises(ValidationError):
        LayoutConfig.model_validate({"available": ["classic"]})


@pytest.mark.parametrize(
    "raw",
    ["Command", "1st", "a" * 41, {"available": ["ok", "Not OK"]}, {"options": {"BAD": {}}}],
)
def test_bad_ids_are_rejected(raw):
    with pytest.raises(ValidationError):
        LayoutConfig.model_validate(raw)


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
