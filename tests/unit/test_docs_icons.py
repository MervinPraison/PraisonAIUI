"""Docs icons: ``aiui validate`` warns (7009) on an icon value that draws nothing,
checked against the lucide names the frontend build ships (``aiui-icons.json``)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app
from praisonaiui.compiler.agent_markdown import to_agent_markdown
from praisonaiui.compiler.content_lint import check_icons, lucide_icons
from praisonaiui.compiler.docs_tags import unknown_tags

PACKAGED = Path(__file__).resolve().parents[2] / "src" / "praisonaiui" / "templates" / "frontend" / "aiui-icons.json"


@pytest.fixture
def icons(tmp_path, monkeypatch):
    build = tmp_path / "build"
    build.mkdir()
    (build / "aiui-icons.json").write_text(json.dumps(["anchor", "flag", "home", "house", "rocket"]))
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(build))


def test_the_bundle_ships_every_lucide_name():
    names = json.loads(PACKAGED.read_text())
    assert len(names) > 1500 and {"flag", "house", "home", "a-arrow-down"} <= set(names)


def test_page_icons_that_draw_nothing(icons):
    page = (
        "---\ntitle: T\nicon: rockt\nlayout: home\nfeatures:\n  - title: F\n    icon: '🚀'\n  - title: G\n    icon: fa-flag x\n---\n"
        "# T\n\n<Card title=\"A\" icon=\"Anchor\">ok</Card> <Icon icon={\"flg\"} size={20} />\n\n"
        "```md\n<Card icon=\"nope\">in code</Card>\n```\n"
        "<Step icon='/img/x.svg'>u</Step> <Badge icon=\"⚡\">e</Badge> `<Icon icon=\"nope\" />`\n"
    )
    issues = check_icons(page, "docs/t.md", {"icon": "rockt", "layout": "home", "features": [{"icon": "🚀"}, {"icon": "fa-flag x"}]})
    assert [(i.code, i.line, i.message.split(" is ")[0]) for i in issues] == [
        (7009, 3, "icon 'rockt'"), (7009, 9, "icon 'fa-flag x'"), (7009, 13, "icon 'flg'"),
    ]
    assert issues[0].hint.startswith("Did you mean 'rocket'?")
    assert "lucide.dev/icons" in issues[1].hint


def test_no_build_means_no_check(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(tmp_path))
    assert lucide_icons() == frozenset()
    assert check_icons("# T\n\n<Icon icon=\"zzz\" />\n", "t.md", {}) == []


def test_validate_checks_navigation_and_page_icons(tmp_path, icons):
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "guide" / "a.md").write_text("---\ntitle: A\nicon: flag\n---\n# A\n\nSee <Icon icon=\"hous\" />.\n")
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text(
        "site:\n  title: T\ncontent:\n  docs:\n    dir: ./docs\n"
        "navigation:\n  groups:\n    - group: Guide\n      icon: rockett\n      pages: [guide/a]\n",
        encoding="utf-8",
    )
    result = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg)])
    assert result.exit_code == 0, result.output
    out = " ".join(result.output.split())
    assert "7009 navigation: icon of 'Guide' 'rockett' is not a lucide icon" in out
    assert "7009 docs/guide/a.md:7: icon 'hous' is not a lucide icon" in out
    assert "Did you mean 'house'?" in out
    assert CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--strict"]).exit_code == 1


def test_icon_is_a_known_docs_tag_and_the_agent_markdown_keeps_only_an_emoji():
    assert unknown_tags("Go <Icon icon=\"flag\" /> now.\n") == []
    md = to_agent_markdown("Go <Icon icon=\"flag\" size={20} /> now <Icon icon=\"🚀\" />.\n", title="T")
    assert "Go  now 🚀." in md and "Icon" not in md
