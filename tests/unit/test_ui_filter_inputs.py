"""Filter inputs and on-change submission (ui.py): the dicts the React blocks read."""

from __future__ import annotations

import praisonaiui as aiui
from praisonaiui import ui


def test_filter_bar_is_exported():
    assert "filter_bar" in aiui.__all__
    assert aiui.filter_bar is ui.filter_bar


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
