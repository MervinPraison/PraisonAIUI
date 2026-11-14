"""Behaviour of the default dashboard's chat view (``plugins/views/chat.js``).

The view's internals are not exported, so the Node harness copies the module
into a temp folder (next to a stub ``toast.js``), appends an export list for
the functions under test and imports that copy with a small fake DOM.

Regressions covered:

* GFM tables in a reply rendered as raw ``| … |`` text; headings, lists and
  code are checked alongside, and untrusted text stays escaped (R9).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CHAT_JS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views" / "chat.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

EXPORTS = ["renderMarkdown", "escapeHtml"]

_HARNESS = r"""
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const [, , modPath, inputPath] = process.argv;
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const mod = await import(pathToFileURL(modPath).href);
const out = {};
if (input.markdown) {
  out.markdown = Object.fromEntries(Object.entries(input.markdown).map(([k, v]) => [k, mod.renderMarkdown(v)]));
}
console.log(JSON.stringify(out));
"""


def _run(tmp_path: Path, payload: dict) -> dict:
    views = tmp_path / "views"
    views.mkdir(exist_ok=True)
    (tmp_path / "toast.js").write_text("export function showToast() {}\n", encoding="utf-8")
    source = CHAT_JS.read_text(encoding="utf-8")
    (views / "chat.js").write_text(source + f"\nexport {{ {', '.join(EXPORTS)} }};\n", encoding="utf-8")
    (tmp_path / "harness.mjs").write_text(_HARNESS, encoding="utf-8")
    (tmp_path / "input.json").write_text(json.dumps(payload), encoding="utf-8")
    proc = subprocess.run(
        [NODE, str(tmp_path / "harness.mjs"), str(views / "chat.js"), str(tmp_path / "input.json")],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp_path,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


class _Tree(HTMLParser):
    """Element names in document order, plus text per element path."""

    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict]] = []
        self.stack: list[str] = []
        self.cells: list[tuple[str, str]] = []
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        if tag not in ("br", "hr"):
            self.stack.append(tag)
        if tag in ("th", "td"):
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self._cell is not None:
            self.cells.append((tag, "".join(self._cell).strip()))
            self._cell = None
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _tree(html: str) -> _Tree:
    t = _Tree()
    t.feed(html)
    return t


def _names(html: str) -> list[str]:
    return [t for t, _ in _tree(html).tags]


TABLE = """Compare:

| Algorithm | Best | Worst |
|:----------|:----:|------:|
| Merge sort | O(n log n) | **O(n log n)** |
| Quick sort | `O(n log n)` | O(n²) |

Done."""

SAMPLES = {
    "table": TABLE,
    "no_outer_pipes": "a | b\n--- | ---\n1 | 2",
    "escaped_pipe": "| expr | meaning |\n|---|---|\n| a \\| b | or |",
    "mismatch": "| a | b |\n|---|\nnot a table",
    "pipe_text": "use a | b in a shell",
    "headings": "# One\n## Two\n### Three\n#### Four\n##### Five",
    "lists": "- a\n* b\n+ c\n\n1. x\n1. y",
    "code": "```python\nprint('<b>')\n| a | b |\n|---|---|\n```",
    "code_lang_symbols": "```c++\nint x;\n```",
    "open_fence": "Here:\n```js\nconst a = 1;",
    "xss_text": "<img src=x onerror=alert(1)> **<script>x</script>**",
    "xss_cell": "| h |\n|---|\n| <img src=x onerror=alert(1)> |",
    "js_link": "[click](javascript:alert(1))",
    "quote_link": '[x](https://a.test/"onmouseover="alert(1))',
    "ok_link": "[docs](https://example.com/docs?a=1&b=2)",
    "nul": "a\x00CB0\x00b",
}


@pytest.fixture(scope="module")
def md(tmp_path_factory) -> dict[str, str]:
    return _run(tmp_path_factory.mktemp("md"), {"markdown": SAMPLES})["markdown"]


class TestTables:
    def test_table_renders_as_table(self, md):
        html = md["table"]
        assert "|" not in html.replace("&#124;", "")
        names = _names(html)
        assert names.count("table") == 1
        assert names.count("th") == 3 and names.count("td") == 6
        assert "thead" in names and "tbody" in names

    def test_cells_keep_inline_markdown_and_alignment(self, md):
        tree = _tree(md["table"])
        assert [c for t, c in tree.cells if t == "th"] == ["Algorithm", "Best", "Worst"]
        assert [c for t, c in tree.cells if t == "td"][:3] == ["Merge sort", "O(n log n)", "O(n log n)"]
        aligns = [a.get("style") for t, a in tree.tags if t == "th"]
        assert aligns == ["text-align:left", "text-align:center", "text-align:right"]
        assert "<strong>O(n log n)</strong>" in md["table"]
        assert '<code class="chat-inline-code">O(n log n)</code>' in md["table"]

    def test_text_around_the_table_stays(self, md):
        html = md["table"]
        assert html.startswith("Compare:")
        assert html.rstrip().endswith("Done.")

    def test_table_without_outer_pipes(self, md):
        assert [c for _, c in _tree(md["no_outer_pipes"]).cells] == ["a", "b", "1", "2"]

    def test_escaped_pipe_stays_in_its_cell(self, md):
        assert [c for t, c in _tree(md["escaped_pipe"]).cells if t == "td"] == ["a | b", "or"]

    def test_delimiter_with_other_cell_count_is_not_a_table(self, md):
        assert "<table" not in md["mismatch"]

    def test_plain_pipe_text_is_not_a_table(self, md):
        assert "<table" not in md["pipe_text"]
        assert "use a | b in a shell" in md["pipe_text"]

    def test_table_inside_code_is_code(self, md):
        html = md["code"]
        assert "<table" not in html
        assert "| a | b |" in html


class TestBlocks:
    def test_headings(self, md):
        assert _names(md["headings"]) == ["h1", "h2", "h3", "h4", "h6"]

    def test_bullets_and_numbers(self, md):
        names = _names(md["lists"])
        assert names.count("ul") == 1 and names.count("ol") == 1
        assert names.count("li") == 5
        assert 'value="2"' in md["lists"]

    def test_code_block_escaped(self, md):
        html = md["code"]
        assert 'class="language-python"' in html
        assert "print(&#39;&lt;b&gt;&#39;)" in html

    def test_language_with_symbols(self, md):
        assert 'class="language-c++"' in md["code_lang_symbols"]

    def test_open_fence_while_streaming_is_code(self, md):
        html = md["open_fence"]
        assert "```" not in html
        assert 'class="language-js"' in html and "const a = 1;" in html


class TestEscaping:
    def test_html_in_text_is_escaped(self, md):
        html = md["xss_text"]
        assert "<img" not in html and "<script" not in html
        assert "&lt;img src=x onerror=alert(1)&gt;" in html
        assert "<strong>&lt;script&gt;x&lt;/script&gt;</strong>" in html

    def test_html_in_a_cell_is_escaped(self, md):
        html = md["xss_cell"]
        assert "<img" not in html
        assert "&lt;img" in html

    def test_javascript_link_is_text(self, md):
        html = md["js_link"]
        assert "<a" not in html and "javascript:" not in html.split(">")[0]

    def test_quote_cannot_leave_the_href(self, md):
        tags = [a for t, a in _tree(md["quote_link"]).tags if t == "a"]
        for attrs in tags:
            assert set(attrs) <= {"href", "target", "rel"}, attrs

    def test_safe_link(self, md):
        (attrs,) = [a for t, a in _tree(md["ok_link"]).tags if t == "a"]
        assert attrs["href"] == "https://example.com/docs?a=1&b=2"
        assert attrs["rel"] == "noopener noreferrer nofollow"
        assert attrs["target"] == "_blank"

    def test_nul_cannot_forge_a_placeholder(self, md):
        assert md["nul"] == "aCB0b"
