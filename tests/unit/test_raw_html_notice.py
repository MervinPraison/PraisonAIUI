"""7019: raw HTML a docs page shows differently than written (aiui validate and aiui build)."""

from __future__ import annotations

from pathlib import Path

import yaml

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.content_lint import check_raw_html
from praisonaiui.schema.models import Config

PAGE = """---
title: Map
---

# Where we are

<iframe src="https://www.google.com/maps/embed?pb=abc" width="600" height="450"></iframe>

<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tour"></iframe>

<script src="https://cdn.example.com/widget.js"></script>

<form
  action="https://forms.example.com/submit"><input name="q"></form>

<audio src="https://media.example.com/a.mp3" controls></audio>

```html
<iframe src="https://codepen.io/x/embed/y"></iframe>
<script src="https://cdn.example.com/in-a-fence.js"></script>
```

Write `<script>` and `<iframe src="https://example.com">` in inline code.
"""


def _found(text: str) -> list[tuple[int, str]]:
    return [(i.line, i.message) for i in check_raw_html(text, "docs/map.md")]


def test_non_video_iframe_names_its_host():
    found = _found(PAGE)
    assert (7, "<iframe> to www.google.com shows as a link, not an embedded frame") in found


def test_removed_elements_are_named_with_their_line():
    found = dict((msg.split(">")[0] + ">", line) for line, msg in _found(PAGE))
    assert found["<script>"] == 11
    assert found["<form>"] == 13  # a tag written over two lines: its first line
    assert found["<audio>"] == 16


def test_video_players_code_fences_and_inline_code_are_ignored():
    found = _found(PAGE)
    assert len(found) == 4
    assert not any("youtube" in m or "codepen" in m or "in-a-fence" in m for _, m in found)
    assert _found("<iframe src='https://player.vimeo.com/video/1234'></iframe>\n") == []


def test_iframe_without_src_is_removed():
    assert _found("<iframe title='x'></iframe>\n") == [(1, "<iframe> has no src and is removed")]


def _site(tmp_path: Path) -> Compiler:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "index.md").write_text(PAGE, encoding="utf-8")
    raw = {"site": {"title": "T"}, "content": {"docs": {"dir": "docs"}}}
    (tmp_path / "aiui.yaml").write_text(yaml.safe_dump(raw), encoding="utf-8")
    return Compiler(Config.model_validate(raw), base_path=tmp_path)


def test_validate_reports_7019(tmp_path):
    issues = [i for i in _site(tmp_path).lint_content() if i.code == 7019]
    assert [(i.file, i.line) for i in issues] == [("docs/index.md", n) for n in (7, 11, 13, 16)]
    assert all(i.hint for i in issues)


def test_build_warns_7019(tmp_path):
    result = _site(tmp_path).compile(tmp_path / "out")
    assert result.success
    found = [w for w in result.warnings if w.startswith("7019: ")]
    assert found[0] == "7019: docs/index.md:7: <iframe> to www.google.com shows as a link, not an embedded frame"
    assert len(found) == 4
