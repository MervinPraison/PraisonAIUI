"""Unit tests for rich compound UI component builders and schemas."""

from __future__ import annotations

import pytest

import praisonaiui as aiui


def test_new_rich_builders_exported_and_valid():
    s = aiui.stepper(
        [{"title": "Plan"}, {"title": "Execute", "description": "Running tools"}, {"title": "Verify"}],
        active=1,
        orientation="vertical",
        title="Pipeline",
    )
    assert s["type"] == "stepper"
    assert s["active"] == 1
    assert s["orientation"] == "vertical"
    assert len(s["steps"]) == 3

    tl = aiui.timeline(
        [{"title": "Deployed", "timestamp": "10:00", "status": "success", "badge": "v1.2"}],
        title="Activity",
    )
    assert tl == {
        "type": "timeline",
        "title": "Activity",
        "items": [{"title": "Deployed", "timestamp": "10:00", "status": "success", "badge": "v1.2"}],
    }

    dv = aiui.diff_viewer("a\nb", "a\nc", title="Prompt v2", before_label="v1", after_label="v2")
    assert dv["type"] == "diff_viewer"
    assert dv["before"] == "a\nb"
    assert dv["after"] == "a\nc"

    tv = aiui.tree_view(
        [{"label": "docs", "children": [{"label": "index.md", "badge": "MD"}]}],
        title="Sources",
        default_expanded=True,
    )
    assert tv["type"] == "tree_view"
    assert tv["default_expanded"] is True

    cf = aiui.copy_field("sk-demo-1234", label="API Key", secret=True)
    assert cf == {"type": "copy_field", "value": "sk-demo-1234", "label": "API Key", "secret": True}

    ri = aiui.rating_input("Quality", value=4, max_stars=5, name="rating", auto_submit=True)
    assert ri == {
        "type": "rating_input",
        "label": "Quality",
        "value": 4,
        "max_stars": 5,
        "readonly": False,
        "name": "rating",
        "auto_submit": True,
    }


def test_rich_builders_validation():
    with pytest.raises(ValueError, match="orientation"):
        aiui.stepper([], orientation="diagonal")
    with pytest.raises(ValueError, match="max_stars"):
        aiui.rating_input("Score", max_stars=0)
    with pytest.raises(ValueError, match="max_stars"):
        aiui.rating_input("Score", max_stars=11)
    assert aiui.rating_input("Score", value=99, max_stars=5)["value"] == 5


def test_rich_builders_in_component_schemas():
    schemas = aiui.get_component_schemas()
    for name in ("stepper", "timeline", "diff_viewer", "tree_view", "copy_field", "rating_input"):
        assert name in schemas, f"{name} missing from auto-derived component schemas"
