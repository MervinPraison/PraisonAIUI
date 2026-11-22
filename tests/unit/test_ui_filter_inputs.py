"""Filter inputs and on-change submission (ui.py): the dicts the React blocks read."""

from __future__ import annotations

import praisonaiui as aiui
from praisonaiui import ui


def test_new_helpers_are_exported():
    for name in ("tags_input", "date_range_input", "segmented_input", "filter_bar"):
        assert name in aiui.__all__
        assert getattr(aiui, name) is getattr(ui, name)


def test_select_input_searchable_and_auto_submit_are_additive():
    plain = aiui.select_input("Channel", options=["a"], name="ch")
    assert plain == {"type": "select_input", "label": "Channel", "options": ["a"], "value": "", "name": "ch"}
    s = aiui.select_input("Channel", options=["a"], searchable=True, auto_submit=True)
    assert s["searchable"] is True and s["auto_submit"] is True
    assert aiui.select_input("X", options=[], searchable=False)["searchable"] is False


def test_auto_submit_on_existing_inputs():
    for comp in (
        aiui.text_input("Q", auto_submit=True),
        aiui.number_input("N", auto_submit=True),
        aiui.checkbox_input("C", auto_submit=True),
        aiui.switch_input("S", auto_submit=True),
        aiui.radio_input("R", options=["a"], auto_submit=True),
    ):
        assert comp["auto_submit"] is True
    assert "auto_submit" not in aiui.text_input("Q")


def test_form_submit_on_change_is_opt_in():
    assert "submit_on_change" not in aiui.form("p", children=[])
    assert aiui.form("p", children=[], submit_on_change=True)["submit_on_change"] is True


def test_multiselect_keeps_old_shape_and_takes_name():
    assert aiui.multiselect_input("Tags", options=["A"], value=["A"]) == {
        "type": "multiselect_input",
        "label": "Tags",
        "options": ["A"],
        "value": ["A"],
    }
    m = aiui.multiselect_input("Tags", options=[{"value": "a", "label": "A"}], name="t", placeholder="Pick")
    assert m["name"] == "t" and m["placeholder"] == "Pick"


def test_tags_input():
    t = aiui.tags_input("Tags", value=("ai", "ml"), name="tags")
    assert t == {"type": "tags_input", "label": "Tags", "value": ["ai", "ml"], "placeholder": "Add a tag", "name": "tags"}


def test_date_range_input():
    d = aiui.date_range_input("posted", label="Posted", start="2026-01-01")
    assert d["type"] == "date_range_input"
    assert (d["start"], d["end"]) == ("2026-01-01", "")
    assert d["presets"] == [7, 30, 90, 365]
    custom = aiui.date_range_input("p", presets=[14, {"days": 60, "label": "2 months"}])
    assert custom["presets"] == [14, {"days": 60, "label": "2 months"}]
    assert aiui.date_range_input("p", presets=())["presets"] == []


def test_segmented_input():
    single = aiui.segmented_input("platform", ["all", "yt"], value="yt")
    assert single["value"] == "yt" and single["multi"] is False
    multi = aiui.segmented_input("fmt", [{"value": "v", "label": "Video"}], value="v", multi=True)
    assert multi["value"] == ["v"] and multi["multi"] is True
    assert aiui.segmented_input("fmt", ["a"], multi=True)["value"] == []


def test_filter_bar():
    bar = aiui.filter_bar(
        "explore",
        inputs=[aiui.select_input("Creator", options=["All", "Ann"], name="creator")],
        defaults={"creator": "All"},
    )
    assert bar["type"] == "filter_bar" and bar["action"] == "explore"
    assert bar["children"][0]["name"] == "creator"
    assert bar["chips"] is True and bar["reset_label"] == "Reset"
    assert bar["defaults"] == {"creator": "All"}
    assert "defaults" not in aiui.filter_bar("p", inputs=[], chips=False)
