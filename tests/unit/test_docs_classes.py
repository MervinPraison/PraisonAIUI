"""7022: utility classes on docs pages (className / class) and style attributes (aiui validate and aiui build)."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.content_lint import check_classes
from praisonaiui.compiler.docs_classes import CLASS_PATTERNS, DOCS_CLASSES, expand
from praisonaiui.schema.models import Config

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "src" / "frontend" / "src" / "docs"

PAGE = """---
title: Layout
---

# Two columns

<div className="grid md:grid-cols-2 gap-4 fixed">

<Card title="A" className={"mt-8 shadow-xl"}>One</Card>

</div>

<p class="text-sm text-muted-foreground" style="color: red">Small print</p>

<Widget className="their-own" />

Write `<div class="nope">` in code.

```html
<div class="in-a-fence"></div>
```

<span
  className="dark:hidden flx">mode</span>
"""


def test_patterns_mirror_the_browser_and_the_stylesheet():
    ts = (FRONTEND / "docsClasses.ts").read_text(encoding="utf-8")
    table = ts[ts.index("export const CLASS_PATTERNS") : ts.index("\n]\n", ts.index("export const CLASS_PATTERNS"))]
    assert tuple(re.findall(r"^    '([^']+)',$", table, re.M)) == CLASS_PATTERNS
    css = (FRONTEND / "utilities.css").read_text(encoding="utf-8")
    assert tuple(re.findall(r'^@source inline\("aiui:(.*)"\);$', css, re.M)) == CLASS_PATTERNS


def test_allowlist_is_token_utilities_only():
    assert expand("a{b,c}-{1,2}") == ["ab-1", "ab-2", "ac-1", "ac-2"]
    assert {"flex", "md:grid-cols-2", "dark:hidden", "text-muted-foreground", "bg-muted", "mx-auto", "rounded-lg"} <= DOCS_CLASSES
    for bad in ("fixed", "absolute", "z-50", "inset-0", "text-red-500", "bg-[url(x)]", "style"):
        assert bad not in DOCS_CLASSES


def test_unknown_classes_and_styles_are_named_with_their_line():
    found = [(i.line, i.message) for i in check_classes(PAGE, "docs/index.md")]
    assert found == [
        (7, "class 'fixed' on <div> is dropped: it is not a docs utility class"),
        (9, "class 'shadow-xl' on <Card> is dropped: it is not a docs utility class"),
        (13, "style on <p> is removed: docs pages keep no inline styles"),
        (24, "class 'flx' on <span> is dropped: it is not a docs utility class"),
    ]
    hints = [i.hint for i in check_classes(PAGE, "docs/index.md")]
    assert hints[-1] == "Did you mean 'flex'?"
    assert all(hints)


def _site(tmp_path: Path) -> Compiler:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "index.md").write_text(PAGE, encoding="utf-8")
    raw = {"site": {"title": "T"}, "content": {"docs": {"dir": "docs"}}}
    (tmp_path / "aiui.yaml").write_text(yaml.safe_dump(raw), encoding="utf-8")
    return Compiler(Config.model_validate(raw), base_path=tmp_path)


def test_validate_reports_7022(tmp_path):
    issues = [i for i in _site(tmp_path).lint_content() if i.code == 7022]
    assert [(i.file, i.line) for i in issues] == [("docs/index.md", n) for n in (7, 9, 13, 24)]


def test_build_warns_7022(tmp_path):
    result = _site(tmp_path).compile(tmp_path / "out")
    assert result.success
    found = [w for w in result.warnings if w.startswith("7022: ")]
    assert found[0] == "7022: docs/index.md:7: class 'fixed' on <div> is dropped: it is not a docs utility class"
    assert len(found) == 4
