"""Filter inputs and on-change submission (ui.py): the dicts the React blocks read."""

from __future__ import annotations

import praisonaiui as aiui
from praisonaiui import ui


def test_new_helpers_are_exported():
    for name in ("tags_input", "date_range_input", "segmented_input", "filter_bar", "list_detail"):
        assert name in aiui.__all__
        assert getattr(aiui, name) is getattr(ui, name)


def test_select_input_searchable_and_auto_submit_are_additive():
    plain = aiui.select_input("Channel", options=["a"], name="ch")
    assert plain == {"type": "select_input", "label": "Channel", "options": ["a"], "value": "", "name": "ch"}
    s = aiui.select_input("Channel", options=["a"], searchable=True, auto_submit=True)
    assert s["searchable"] is True and s["auto_submit"] is True
    assert aiui.select_input("X", options=[], searchable=False)["searchable"] is False
    remote = aiui.select_input(
        "Creator",
        options_url="/api/creators/search",
        value="ch_1",
        selected_label="Ada Lovelace",
        placeholder="Search creators...",
        name="creator",
    )
    assert remote == {
        "type": "select_input",
        "label": "Creator",
        "options": [],
        "value": "ch_1",
        "name": "creator",
        "options_url": "/api/creators/search",
        "placeholder": "Search creators...",
        "selected_label": "Ada Lovelace",
    }


def test_auto_submit_on_existing_inputs():
    for comp in (
        aiui.text_input("Q", auto_submit=True),
        aiui.number_input("N", auto_submit=True),
        aiui.slider_input("V", auto_submit=True),
        aiui.textarea_input("T", auto_submit=True),
        aiui.checkbox_input("C", auto_submit=True),
        aiui.switch_input("S", auto_submit=True),
        aiui.radio_input("R", options=["a"], auto_submit=True),
        aiui.date_input("D", name="d", auto_submit=True),
        aiui.time_input("Tm", name="tm", auto_submit=True),
        aiui.color_picker_input("Color", name="color", auto_submit=True),
    ):
        assert comp["auto_submit"] is True
    assert "auto_submit" not in aiui.text_input("Q")
    assert aiui.date_input("D", name="d")["name"] == "d"
    assert aiui.time_input("Tm", name="tm")["name"] == "tm"
    assert aiui.color_picker_input("Color", name="color")["name"] == "color"


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
    m = aiui.multiselect_input(
        "Tags",
        options=[{"value": "a", "label": "A"}],
        name="t",
        placeholder="Pick",
        options_url="/api/tags/search",
        selected_labels={"a": "Alpha"},
    )
    assert m["name"] == "t" and m["placeholder"] == "Pick"
    assert m["options_url"] == "/api/tags/search"
    assert m["selected_labels"] == {"a": "Alpha"}


def test_pagination_action_and_list_detail_helper():
    plain_p = aiui.pagination(total=100, page=2, per_page=25)
    assert "action" not in plain_p
    act_p = aiui.pagination(total=100, page=2, per_page=25, id="list", action="explore")
    assert act_p["action"] == "explore" and act_p["id"] == "list"

    ld = aiui.list_detail(
        rows=[{"id": "r1", "title": "Alpha", "detail": {"Owner": "Ada"}}],
        columns=["title"],
        title="Sessions",
        page_size=10,
        search=True,
        empty="None",
    )
    assert ld == {
        "type": "list_detail",
        "rows": [{"id": "r1", "title": "Alpha", "detail": {"Owner": "Ada"}}],
        "title": "Sessions",
        "columns": ["title"],
        "page_size": 10,
        "search": True,
        "empty": "None",
    }


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
