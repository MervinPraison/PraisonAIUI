"""The `chart` block dict (praisonaiui.ui.chart): kinds, options and compatibility."""

from __future__ import annotations

import json

import pytest

from praisonaiui.ui import CHART_KINDS, chart


def test_plain_chart_keeps_the_original_dict_shape():
    rows = [{"name": "Researcher", "value": 15}]
    assert chart("Tasks", data=rows) == {"type": "chart", "title": "Tasks", "data": rows, "chart_type": "bar"}


@pytest.mark.parametrize("kind", CHART_KINDS)
def test_every_kind_is_accepted(kind):
    assert chart("c", data=[{"a": "x", "b": 1}], chart_type=kind)["chart_type"] == kind


@pytest.mark.parametrize(("kwargs", "match"), [({"chart_type": "sankey"}, "chart_type"), ({"y_format": "eur"}, "y_format")])
def test_unknown_kind_and_format_are_rejected(kwargs, match):
    with pytest.raises(ValueError, match=match):
        chart("c", **kwargs)


def test_options_are_added_only_when_given():
    c = chart(
        "Views", data=[{"month": "Jan", "views": 1200, "posts": 3}], chart_type="line", x="month", y="views",
        y2="posts", labels={"views": "Usual views"}, y_format="compact", y_domain=(0, 2000), height=300,
        caption="Posts behind the line", legend=False,
    )
    assert {k: c[k] for k in ("x", "y", "y2", "labels", "y_format", "y_domain", "height", "caption", "legend")} == {
        "x": "month", "y": ["views"], "y2": "posts", "labels": {"views": "Usual views"}, "y_format": "compact",
        "y_domain": [0, 2000], "height": 300, "caption": "Posts behind the line", "legend": False,
    }
    for absent in ("stacked", "reference", "color_by_reference", "bins", "label", "x_format"):
        assert absent not in c
    assert json.loads(json.dumps(c)) == c
    c = chart("Mix", data=[], x="q", y=["a", "b"], stacked=True)
    assert c["y"] == ["a", "b"] and c["stacked"] is True


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        (1, [{"value": 1}]),
        ([1, 2.5], [{"value": 1}, {"value": 2.5}]),
        ({"value": 1, "label": "usual"}, [{"value": 1, "label": "usual"}]),
        ([{"value": 1, "label": "usual", "extra": True}], [{"value": 1, "label": "usual"}]),
    ],
)
def test_reference_forms(reference, expected):
    c = chart("Lift", chart_type="barh", reference=reference, color_by_reference=True)
    assert c["reference"] == expected and c["color_by_reference"] is True


@pytest.mark.parametrize("bad", ["one", [], [None], [{"label": "no value"}], True])
def test_bad_reference_is_rejected(bad):
    with pytest.raises(ValueError, match="reference"):
        chart("c", reference=bad)


def test_histogram_takes_plain_numbers_or_rows():
    c = chart("Spread", data=[0.5, 1.2, 3], chart_type="histogram", bins=4)
    assert c["data"] == [{"value": 0.5}, {"value": 1.2}, {"value": 3}] and c["x"] == "value" and c["bins"] == 4
    c = chart("Spread", data=[{"lift": 1.0}], chart_type="histogram", x="lift")
    assert c["data"] == [{"lift": 1.0}] and c["x"] == "lift"


def test_scatter_point_label_and_optional_title():
    c = chart(data=[{"channel": "A", "subs": 10, "ratio": 2}], chart_type="scatter", label="channel")
    assert c["title"] == "" and c["label"] == "channel"


def test_heatmap_sparkline_facet_and_kind_alias():
    rows = [{"day": "Mon", "hour": 9, "n": 3}]
    h = chart("When", data=rows, kind="heatmap", x="hour", y="day", value="n", y_format="compact")
    assert {k: h[k] for k in ("chart_type", "x", "y", "value")} == {"chart_type": "heatmap", "x": "hour", "y": ["day"], "value": "n"}
    s = chart("Trend", data=[1, 2, 3], chart_type="sparkline")
    assert s["data"] == [{"value": 1}, {"value": 2}, {"value": 3}]
    f = chart("Views", data=[{"platform": "A", "m": "Jan", "v": 1}], chart_type="line", facet="platform")
    assert f["facet"] == "platform" and "value" not in f and "facet_scales" not in f
    f_free = chart("Views", data=[{"platform": "A", "m": "Jan", "v": 1}], chart_type="line", facet="platform", facet_scales="free")
    assert f_free["facet_scales"] == "free"
    with pytest.raises(ValueError, match="chart_type"):
        chart("c", kind="sankey")


def test_domains_scales_tooltip_clip_and_validation():
    c = chart(
        "Reach",
        chart_type="scatter",
        data=[{"subs": 1000, "lift": 1.5, "posts": 12}],
        x="subs",
        y="lift",
        x_domain=[1e3, 1e7],
        y_domain=[0.1, 10],
        x_scale="log",
        y_scale="log",
        tooltip=["posts", {"key": "subs", "label": "Subscribers", "format": "compact"}],
        clip=5,
    )
    assert c["x_domain"] == [1000.0, 10000000.0]
    assert c["y_domain"] == [0.1, 10]
    assert c["x_scale"] == "log" and c["y_scale"] == "log"
    assert c["tooltip"] == [{"key": "posts"}, {"key": "subs", "label": "Subscribers", "format": "compact"}]
    assert c["clip"] == [None, 5]
    assert chart("Clip bool", clip=True)["clip"] is True
    assert chart("Clip range", clip=(0, 5))["clip"] == [0, 5]
    assert "x_scale" not in chart("Lin", x_scale="linear")
    for bad in (
        {"x_scale": "sqrt"},
        {"y_scale": "exp"},
        {"facet_scales": "auto"},
        {"x_domain": [1]},
        {"tooltip": [{}]},
        {"tooltip": [{"key": "a", "format": "eur"}]},
        {"clip": "5"},
    ):
        with pytest.raises(ValueError):
            chart("Bad", **bad)
