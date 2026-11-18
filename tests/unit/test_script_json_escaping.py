"""Inline JSON in HTML has one escaper (ARCHITECTURE R9).

``praisonaiui.utils.json_for_html`` is the only code that escapes JSON for a
``<script>`` element. The app shell HTML (``server._json_for_html``), the
standalone replay page and the built docs site (the inlined markdown and the
JSON-LD block) all go through it, so a value can never close the element.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from praisonaiui.utils import json_for_html

SRC = Path(__file__).resolve().parents[2] / "src" / "praisonaiui"
HOSTILE = "a</script><!--b&c> d e"


def _assert_inert(raw: str) -> None:
    for ch in ("<", ">", "&", " ", " "):
        assert ch not in raw, f"{ch!r} reached the <script> body"


def test_helper_escapes_and_round_trips():
    raw = json_for_html({"k": HOSTILE})
    _assert_inert(raw)
    assert json.loads(raw) == {"k": HOSTILE}


def test_helper_passes_dumps_options_through():
    assert json_for_html({"a": 1}) == '{"a":1}'
    assert json_for_html({"a": 1}, separators=None) == '{"a": 1}'
    assert json_for_html("é", ensure_ascii=True) == '"\\u00e9"'
    assert json_for_html({"p": Path("x")}, default=str) == '{"p":"x"}'


def test_server_uses_the_shared_helper():
    from praisonaiui import server

    assert server._json_for_html({"k": HOSTILE}) == json_for_html({"k": HOSTILE})


def test_replay_standalone_page_uses_the_shared_helper():
    from praisonaiui.features.replay import _json_for_script, standalone_html

    raw = _json_for_script({"k": HOSTILE})
    _assert_inert(raw)
    assert raw == json_for_html({"k": HOSTILE}, default=str, ensure_ascii=True)
    page = standalone_html([{"type": "message", "text": HOSTILE}])
    assert HOSTILE not in page and "</script><!--b" not in page


def _build_docs(tmp_path: Path) -> str:
    from praisonaiui.compiler import Compiler
    from praisonaiui.schema.models import (
        Config,
        ContentConfig,
        ContentSourceConfig,
        RouteConfig,
        SEOConfig,
        SiteConfig,
        TemplateConfig,
    )

    docs = tmp_path / "docs"
    docs.mkdir()
    front = json.dumps(HOSTILE)  # a YAML double-quoted scalar
    (docs / "guide.md").write_text(
        f"---\ntitle: {front}\ndescription: {front}\n---\n\n# Guide\n\n{HOSTILE}\n",
        encoding="utf-8",
    )
    config = Config(
        site=SiteConfig(title="T"),
        seo=SEOConfig(site_url="https://example.test"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(docs))),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(out).success
    return (out / "docs" / "guide.html").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "script_re",
    [
        r'<script type="application/json" id="aiui-initial-doc">(.*?)</script>',
        r'<script type="application/ld\+json"[^>]*>(.*?)</script>',
    ],
    ids=["inline-doc", "json-ld"],
)
def test_built_docs_scripts_are_inert(tmp_path, script_re):
    html = _build_docs(tmp_path)
    found = re.findall(script_re, html, re.S)
    assert len(found) == 1, "script missing or split by the hostile value"
    _assert_inert(found[0])
    assert HOSTILE in json.dumps(json.loads(found[0]), ensure_ascii=False)


def test_no_other_module_hand_escapes_script_json():
    """A fix to the escaper must reach every call site: no second copy."""
    copies = [
        p.relative_to(SRC).as_posix()
        for p in SRC.rglob("*.py")
        if '"\\\\u003c"' in p.read_text(encoding="utf-8")
    ]
    assert copies == ["utils.py"]
