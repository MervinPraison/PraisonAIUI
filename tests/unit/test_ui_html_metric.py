"""The `html` block, `html_embed` (its older name) and metric captions (praisonaiui.ui)."""

from __future__ import annotations

import inspect

from praisonaiui import ui


def test_html_defaults_are_the_sandboxed_frame():
    assert ui.html("<svg></svg>") == {"type": "html", "content": "<svg></svg>"}


def test_html_options_are_carried_only_when_set():
    h = ui.html("<b>x</b>", height=240, csp="default-src 'none'", trusted=True, title="Chart")
    assert h == {
        "type": "html",
        "content": "<b>x</b>",
        "height": 240,
        "csp": "default-src 'none'",
        "trusted": True,
        "title": "Chart",
    }
    assert "trusted" not in ui.html("x", trusted=False)


def test_html_embed_keeps_its_type_and_old_shape():
    # Backwards compatible: the legacy dashboard keys on the type, old dicts unchanged.
    assert ui.html_embed("<b>X</b>") == {"type": "html_embed", "content": "<b>X</b>"}
    assert ui.html_embed("x", height="20rem")["height"] == "20rem"


def test_html_embed_takes_the_same_parameters_as_html():
    params = lambda f: list(inspect.signature(f).parameters)  # noqa: E731
    assert params(ui.html_embed) == params(ui.html)


def test_metric_caption():
    assert ui.metric("Posts", value=51, caption="last 30 days")["caption"] == "last 30 days"
    m = ui.metric("Lead time", value="4 d", delta="-3 days", delta_color="inverse", caption="median")
    assert m == {
        "type": "metric",
        "label": "Lead time",
        "value": "4 d",
        "delta": "-3 days",
        "delta_color": "inverse",
        "caption": "median",
    }


def test_metric_without_caption_is_unchanged():
    assert ui.metric("Users", value=1, delta="+5%") == {
        "type": "metric",
        "label": "Users",
        "value": 1,
        "delta": "+5%",
    }
