"""The page actions menu above each docs page: site list, per-page front matter, links of your own."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.content_lint import FRONTMATTER_TYPES, check_frontmatter
from praisonaiui.schema.models import (
    DEFAULT_PAGE_ACTIONS,
    PAGE_ACTIONS,
    Config,
    ContentSourceConfig,
    page_action_list,
)

PAGES = {
    "index.md": "# Home\n\nWelcome.\n",
    "plain.md": "# Plain\n\nThe site's menu.\n",
    "none.md": "---\npageActions: false\n---\n# None\n\nNo menu.\n",
    "own.md": (
        "---\npageActions:\n  - perplexity\n  - copy\n  - label: Ask support\n"
        "    href: https://support.acme.dev/new?page={url}\n    icon: life-buoy\n---\n# Own\n\nIts own menu.\n"
    ),
}


def _build(tmp_path: Path, **docs) -> tuple[dict, dict]:
    for name, text in PAGES.items():
        path = tmp_path / "docs" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme Docs"},
        "content": {"docs": {"dir": "docs", **docs}},
        "templates": {"docs": {"layout": "ThreeColumnLayout", "slots": {}}},
        "routes": [{"match": "/docs/**", "template": "docs"}],
    })
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path).compile(output_dir=out)
    assert result.success, result.error
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    items = {i["path"]: i for i in nav["items"] if i.get("path")}
    return ui, items


def test_default_menu_writes_nothing(tmp_path: Path) -> None:
    ui, items = _build(tmp_path)
    assert "pageActions" not in ui
    assert "pageActions" not in items["/docs/plain"]
    assert set(DEFAULT_PAGE_ACTIONS) <= set(PAGE_ACTIONS)


def test_site_list_and_links_reach_the_browser_in_order(tmp_path: Path) -> None:
    ui, _ = _build(tmp_path, pageActions=[
        "copy", "grok", "mistral", {"label": "Ask Acme", "href": "https://ai.acme.dev/?q={prompt}", "icon": "sparkles"},
    ])
    assert ui["pageActions"] == [
        "copy", "grok", "mistral", {"label": "Ask Acme", "href": "https://ai.acme.dev/?q={prompt}", "icon": "sparkles"},
    ]


def test_site_false_turns_the_menu_off(tmp_path: Path) -> None:
    ui, _ = _build(tmp_path, pageActions=False)
    assert ui["pageActions"] is False


def test_front_matter_sets_or_hides_a_pages_menu(tmp_path: Path) -> None:
    _, items = _build(tmp_path)
    assert items["/docs/none"]["pageActions"] is False
    assert items["/docs/own"]["pageActions"] == [
        "perplexity", "copy",
        {"label": "Ask support", "href": "https://support.acme.dev/new?page={url}", "icon": "life-buoy"},
    ]
    assert "pageActions" not in items["/docs/own"].get("meta", {})


@pytest.mark.parametrize("value", [
    ["nope"],
    [{"label": "x", "href": "javascript:alert(1)"}],
    [{"label": "x", "href": "data:text/html,hi"}],
    [{"label": "x", "href": "relative/path"}],
    [{"label": "", "href": "/x"}],
    "copy",
])
def test_config_refuses_unknown_actions_and_unsafe_links(value) -> None:
    with pytest.raises(ValidationError):
        ContentSourceConfig.model_validate({"dir": "docs", "pageActions": value})


def test_page_action_list_drops_repeats_and_refuses_bad_entries() -> None:
    assert page_action_list(["copy", "copy", "claude"]) == ["copy", "claude"]
    assert page_action_list(False) is False
    assert page_action_list("copy") is None
    assert page_action_list(["copy", "nope"]) is None
    assert page_action_list([{"label": "x", "href": " JavaScript:alert(1)"}]) is None
    assert page_action_list([{"label": "x", "href": "vscode:open"}]) == [{"label": "x", "href": "vscode:open"}]


def test_lint_names_the_actions_on_a_bad_front_matter_value() -> None:
    assert "pageActions" in FRONTMATTER_TYPES
    assert check_frontmatter("---\npageActions: false\n---\n", "p.md") == []
    assert check_frontmatter("---\npageActions: [copy, grok]\n---\n", "p.md") == []
    issues = check_frontmatter("---\npageActions: [copy, nope]\n---\n", "p.md")
    assert [i.code for i in issues] == [7001]
    assert "perplexity" in issues[0].hint and issues[0].line == 2
