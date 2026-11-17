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
    body = "## Long\n\n" + "word " * 1000
    text = page_entry("/p", "P", "", body)["s"][0]["x"]
    assert len(text) <= SECTION_TEXT_LIMIT
    assert text.endswith("word")


def _site(tmp_path: Path, search: SearchConfig | None = None) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
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
