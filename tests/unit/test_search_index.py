"""Docs search index (compiler/search_index.py) and its place in ``aiui build``."""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.search_index import SECTION_TEXT_LIMIT, page_entry, plain_text, slugify
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SearchConfig,
    SiteConfig,
    TemplateConfig,
)

PAGE = """# Quick Start

Run a **chat** app, see [the guide](guide.md).

## 1. A chat app

Call `aiui.stream_token()` with `AIUI_LAYOUT` set.

```python
## not a heading
secret_code_line = 1
```

### Code blocks: `copy` and *wrap*

| Key | Value |
|---|---|
| mode | system |

!!! tip "Good to know"
    Callouts carry an icon.
"""


def test_slugify_matches_the_renderer_heading_ids():
    # markdown/slug.ts: lower case, drop non-word characters, spaces to dashes.
    assert slugify("1. A chat app") == "1-a-chat-app"
    assert slugify("Code blocks: copy and wrap") == "code-blocks-copy-and-wrap"
    assert slugify("What's new -- v2") == "whats-new-v2"
    assert slugify("Café") == "caf"


def test_sections_carry_heading_anchor_level_and_plain_text():
    sections = page_entry("/docs/q", "Quick Start", "Run it.", PAGE)["s"]
    assert [(s["h"], s["a"], s["l"]) for s in sections] == [
        ("", "", 1),
        ("1. A chat app", "1-a-chat-app", 2),
        ("Code blocks: copy and wrap", "code-blocks-copy-and-wrap", 3),
    ]
    assert sections[0]["x"] == "Run a chat app, see the guide."
    assert sections[1]["x"] == "Call aiui.stream_token() with AIUI_LAYOUT set."
    assert "secret_code_line" not in json.dumps(sections)
    assert sections[2]["x"] == "Key Value mode system Good to know Callouts carry an icon."


def test_plain_text_strips_marks_but_keeps_snake_case():
    assert plain_text("- **Bold** and _em_ in [a link](x.md)") == "Bold and em in a link"
    assert plain_text("> quoted `snake_case_name`") == "quoted snake_case_name"
    assert plain_text('<img src="x.png"> text') == "text"
    assert plain_text("`aiui.code_block(code, *, language)` and *em*") == "aiui.code_block(code, *, language) and em"


def test_section_text_is_capped_at_a_word_edge():
    body = "## Long\n\n" + "word " * 2000
    text = page_entry("/p", "P", "", body)["s"][0]["x"]
    assert len(text) <= SECTION_TEXT_LIMIT
    assert text.endswith("word")


def test_words_deep_in_a_long_section_are_indexed():
    # The old 600-character cap dropped everything after the first paragraph or two.
    body = "## Long\n\n" + "filler " * 400 + "zebracorn appears late.\n"
    assert "zebracorn" in page_entry("/p", "P", "", body)["s"][0]["x"]


def test_keywords_and_boost_come_from_front_matter():
    entry = page_entry("/p", "P", "", "Text.", {"keywords": ["setup", " install "], "boost": 3})
    assert entry["k"] == ["setup", "install"] and entry["b"] == 3.0
    assert page_entry("/p", "P", "", "", {"keywords": "a, b,,"})["k"] == ["a", "b"]
    # Clamped to 0.1-10; 1, junk and non-positive values leave no field.
    assert page_entry("/p", "P", "", "", {"boost": 99})["b"] == 10.0
    assert page_entry("/p", "P", "", "", {"boost": "0.01"})["b"] == 0.1
    for junk in (1, 0, -2, "x", True, None, [2]):
        assert "b" not in page_entry("/p", "P", "", "", {"boost": junk})
    assert "k" not in page_entry("/p", "P", "", "")


def _site(tmp_path: Path, search: SearchConfig | None = None) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True, exist_ok=True)
    (docs / "index.md").write_text("---\ntitle: Home\n---\n# Home\n\nWelcome.\n", encoding="utf-8")
    (docs / "guide" / "first.md").write_text(
        "---\ntitle: First page\ndescription: The first guide page.\n---\n# First page\n\n## Usage\n\nSome usage text.\n",
        encoding="utf-8",
    )
    config = Config(
        site=SiteConfig(title="Docs"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(docs))),
        templates={"docs": TemplateConfig(layout="ThreeColumnLayout", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
        search=search,
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(out).success
    return out


def test_build_writes_the_index_for_every_nav_page(tmp_path: Path):
    out = _site(tmp_path)
    data = json.loads((out / "search-index.json").read_text(encoding="utf-8"))
    assert data["version"] == 1
    first = next(p for p in data["pages"] if p["p"].endswith("/guide/first"))
    assert first["t"] == "First page"
    assert first["d"] == "The first guide page."
    assert {"h": "Usage", "a": "usage", "l": 2, "x": "Some usage text."} in first["s"]


def test_search_disabled_writes_no_index(tmp_path: Path):
    out = _site(tmp_path, SearchConfig(enabled=False))
    assert not (out / "search-index.json").exists()


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_build_honours_searchable_keywords_and_boost(tmp_path: Path):
    docs = tmp_path / "docs"
    _write(docs / "guide" / "first.md", "---\ntitle: First page\n---\n# First page\n\nText.\n")
    _write(docs / "guide" / "setup.md", "---\ntitle: Setup\nkeywords: [onboarding, install]\nboost: 2.5\n---\nText.\n")
    _write(docs / "guide" / "internal.md", "---\ntitle: Internal\nsearchable: false\n---\nSecret words.\n")
    out = _site(tmp_path)
    data = json.loads((out / "search-index.json").read_text(encoding="utf-8"))
    by_path = {p["p"]: p for p in data["pages"]}
    assert not any(p.endswith("/internal") for p in by_path)
    setup = next(v for k, v in by_path.items() if k.endswith("/guide/setup"))
    assert setup["k"] == ["onboarding", "install"] and setup["b"] == 2.5
    # The nav keeps the page routable but tells the dialog's title search to skip it.
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    flat = json.dumps(nav)
    assert '"searchable": false' in flat and flat.count('"searchable"') == 1


def test_search_prompt_max_results_and_group_boost_reach_ui_config(tmp_path: Path):
    from praisonaiui.schema.models import NavGroupConfig, NavigationConfig, NavTabConfig

    search = SearchConfig.model_validate({"prompt": "Ask the docs", "maxResults": 8})
    assert search.prompt == "Ask the docs" and search.max_results == 8
    out = _site(tmp_path, search)
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    assert ui["search"]["prompt"] == "Ask the docs" and ui["search"]["maxResults"] == 8

    group = NavGroupConfig(group="Guides", prefix="guide", boost=2)
    nav = NavigationConfig(tabs=[NavTabConfig(tab="Guides", groups=[group])])
    compiled = Compiler(Config(site=SiteConfig(title="D"), navigation=nav), base_path=tmp_path)._generate_ui_config()
    assert compiled["navigation"]["tabs"][0]["groups"][0]["boost"] == 2


def test_search_provider_is_reported_as_ignored():
    from praisonaiui.schema.validators import validate_config

    def codes(search: dict) -> list[int]:
        config = Config(site=SiteConfig(title="D"), search=SearchConfig.model_validate(search))
        return [w.code for w in validate_config(config).warnings]

    assert 5201 in codes({"provider": "pagefind"})
    assert 5201 not in codes({"enabled": True})
