"""Reusable snippets and ``{{variables}}`` (compiler/snippets.py) and their place in ``aiui build``."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app
from praisonaiui.compiler.snippets import Snippets


def _files(root: Path, files: dict[str, str]) -> None:
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def _expand(tmp_path: Path, page: str, snippets: dict[str, str] | None = None, variables=None) -> tuple[str, Snippets]:
    _files(tmp_path, {"docs/page.md": page, **{f"docs/snippets/{k}": v for k, v in (snippets or {}).items()}})
    s = Snippets(tmp_path, tmp_path / "docs", variables)
    return s.read(tmp_path / "docs/page.md"), s


def test_snippet_tag_with_props_nested_and_indented(tmp_path):
    text, s = _expand(tmp_path, "1. Step\n   <Snippet file=\"install.md\" pkg=\"aiui\" />\n", {
        "install.md": "```bash\npip install {pkg}\n```\n\n<Snippet file=\"more.md\" />\n",
        "more.md": "More for {pkg}.\n",  # props belong to the snippet they are passed to
    })
    assert text == "1. Step\n   ```bash\n   pip install aiui\n   ```\n\n   More for {pkg}.\n"
    assert s.issues == []


def test_mintlify_import_form_and_mkdocs_form(tmp_path):
    page = "import Hi from '/snippets/hi.mdx'\n\n# P\n\n<Hi word=\"bananas\" />\n\n- Item\n    --8<-- \"note.md\"\n"
    text, _ = _expand(tmp_path, page, {"hi.mdx": "Keyword: {word}.\n", "note.md": "> Note.\n> More.\n"})
    assert text == "\n\n# P\n\nKeyword: bananas.\n\n- Item\n    > Note.\n    > More.\n"  # the import line stays blank


def test_references_in_code_are_left_alone(tmp_path):
    page = "```md\n<Snippet file=\"x.md\" />\n--8<-- \"x.md\"\n```\n"
    assert _expand(tmp_path, page, {"x.md": "X"})[0] == page


def test_variables_everywhere_escape_and_unknown_warning(tmp_path):
    page = ("---\ntitle: {{name}} guide\n---\nUse {{name}} {{version}}; \\{{name}} is literal; {{nope}}.\n"
            "`{{inline}}`\n```\npip install x=={{version}} {{jinja}}\n```\n")
    text, s = _expand(tmp_path, page, variables={"name": "Acme", "version": 2.1})
    assert text == ("---\ntitle: Acme guide\n---\nUse Acme 2.1; {{name}} is literal; {{nope}}.\n"
                    "`{{inline}}`\n```\npip install x==2.1 {{jinja}}\n```\n")
    assert [(i.code, i.file, i.line) for i in s.issues] == [(7007, "docs/page.md", 4)]


def test_missing_outside_and_cycle_are_7008(tmp_path):
    (tmp_path / "secret.txt").parent.mkdir(exist_ok=True)
    page = "<Snippet file=\"a.md\" />\n<Snippet file=\"../../etc/passwd\" />\n--8<-- \"gone.md\"\n"
    text, s = _expand(tmp_path, page, {"a.md": "<Snippet file=\"b.md\" />", "b.md": "<Snippet file=\"a.md\" />"})
    found = sorted((i.file, i.line, i.message) for i in s.issues)
    assert [f[:2] for f in found] == [("docs/page.md", 2), ("docs/page.md", 3), ("docs/snippets/b.md", 1)]
    assert "outside the project folder" in found[0][2] and "not found" in found[1][2]
    assert "includes itself (a.md -> b.md -> a.md)" in found[2][2]
    assert "../../etc/passwd" in text  # left as written; the build fails on 7008
    assert len(s.errors()) == 3


def _site(tmp_path: Path) -> Path:
    _files(tmp_path, {
        "aiui.yaml": "site:\n  title: T\nseo:\n  site_url: https://example.com\n"
                     "variables:\n  productName: Acme\ncontent:\n  docs:\n    dir: ./docs\n",
        "docs/index.md": "---\ntitle: \"{{productName}} home\"\n---\n# Home\n\n<Snippet file=\"hi.md\" word=\"bananas\" />\n",
        "docs/snippets/hi.md": "The {{productName}} keyword is {word}.\n",
    })
    return tmp_path / "aiui.yaml"


def test_build_publishes_expanded_text_everywhere_and_no_snippet_pages(tmp_path):
    cfg, out = _site(tmp_path), tmp_path / "out"
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(out)])
    assert result.exit_code == 0, result.output
    expanded = "The Acme keyword is bananas."
    assert expanded in (out / "docs/index.source.md").read_text()  # what the browser renders
    assert expanded in (out / "docs/index.md").read_text()  # agent-ready Markdown
    assert expanded in (out / "llms-full.txt").read_text()
    assert "bananas" in (out / "search-index.json").read_text()
    nav = json.loads((out / "docs-nav.json").read_text())
    assert [i["title"] for i in nav["items"]] == ["Acme home"]
    assert not (out / "docs/snippets").exists()
    report = json.loads(CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--format", "json"]).output)
    assert report["warnings"] == []  # <Snippet> is not an unknown component (1004)


def test_build_fails_on_a_missing_snippet_and_validate_reports_it(tmp_path):
    cfg = _site(tmp_path)
    (tmp_path / "docs/index.md").write_text("# Home\n\n<Snippet file=\"gone.md\" /> {{nope}}\n", encoding="utf-8")
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(tmp_path / "out")])
    assert result.exit_code != 0 and "snippet 'gone.md' not found" in " ".join(result.output.split())
    report = json.loads(CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--format", "json"]).output)
    codes = {(w["code"], w["file"], w["line"]) for w in report["warnings"]}
    assert {(7007, "docs/index.md", 3), (7008, "docs/index.md", 3)} <= codes
