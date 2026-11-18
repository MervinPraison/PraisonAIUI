"""``aiui validate`` content checks (compiler/content_lint.py, codes 7000-7006, 7101)."""

from __future__ import annotations

import json

from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app
from praisonaiui.compiler.content_lint import accent_contrast, check_body, check_frontmatter


def _codes(issues) -> list[tuple[int, int]]:
    return [(i.code, i.line) for i in issues]


def test_frontmatter_types_with_line_and_hint():
    text = "---\ntitle: 2024\nhidden: \"yes\"\norder: \"3\"\nkeywords: [a, 1]\nnoindex: true\n---\n# X\n\nBody.\n"
    issues = check_frontmatter(text, "a.md")
    assert sorted(_codes(issues)) == [(7001, 2), (7001, 3), (7001, 4), (7001, 5)]
    by_line = {i.line: i for i in issues}
    assert "'hidden' should be true or false" in by_line[3].message
    assert by_line[3].hint == "Write hidden: true or hidden: false, without quotes"
    assert by_line[4].hint == "Write order: 3 without quotes"
    assert by_line[2].hint == 'Quote it: title: "2024"'


def test_keywords_may_be_a_comma_separated_string():
    assert check_frontmatter("---\nkeywords: install, setup\n---\n", "a.md") == []


def test_invalid_frontmatter_yaml_is_reported():
    issues = check_frontmatter("---\ntitle: Setup: the CLI\n---\n# X\n", "a.md")
    assert _codes(issues) == [(7000, 2)]


def test_images_need_alt_text():
    text = "# T\n\n![](a.png) and ![Chart](b.png)\n<img src=c.png>\n<img src=d.png alt=\"\">\n"
    assert _codes(check_body(text, "a.md", {})) == [(7002, 3), (7002, 4)]


def test_heading_skips_are_reported_outside_code():
    text = "---\ntitle: T\n---\n## A\n\nText.\n\n#### B\n\n```\n###### code\n```\n"
    issues = check_body(text, "a.md", {})
    assert _codes(issues) == [(7005, 8)]
    assert "h2 to h4" in issues[0].message


def test_empty_page_and_home_pages():
    assert _codes(check_body("---\ntitle: T\n---\n# Only a title\n", "a.md", {})) == [(7006, 4)]
    assert check_body("---\nlayout: home\n---\n", "a.md", {"layout": "home"}) == []
    assert check_body("# T\n\n```\ncode\n```\n", "a.md", {}) == []


def test_accent_contrast():
    light = accent_contrast("#fde047")  # yellow-300 on white
    assert [i.code for i in light] == [7101] and "light background" in light[0].message
    assert light[0].hint.startswith("Try #")
    assert "dark background" in accent_contrast("#1e3a8a")[0].message
    assert accent_contrast("#2563eb") == []
    assert accent_contrast("oklch(0.6 0.2 250)") == []


def _site(tmp_path, pages: dict[str, str], extra: str = ""):
    for name, text in pages.items():
        path = tmp_path / "docs" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text(f"site:\n  title: T\n{extra}content:\n  docs:\n    dir: ./docs\n", encoding="utf-8")
    return cfg


def test_validate_reports_content_with_file_line_and_strict_fails(tmp_path):
    cfg = _site(tmp_path, {
        "intro.md": "---\ntitle: Intro\n---\n# Intro\n\nHello.\n",
        "01-intro.md": "---\ntitle: Intro again\n---\n# Intro\n\nHi.\n",
        "guide/a.md": "---\ntitle: Setup\n---\n# Setup\n\nA.\n",
        "guide/b.md": "---\ntitle: Setup\n---\n# Setup\n\n![](x.png)\n",
    }, extra="  theme:\n    accent: \"#fde047\"\n")
    (tmp_path / "docs" / "guide" / "x.png").write_bytes(b"")
    result = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg)])
    assert result.exit_code == 0, result.output
    out = " ".join(result.output.split())
    assert "7003 docs/01-intro.md:1: publishes the same page 'intro' as docs/intro.md" in out
    assert "7004 docs/guide/b.md:1: sidebar title 'Setup'" in out
    assert "7002 docs/guide/b.md:6: image has no alt text" in out
    assert "7101 site.theme.accent: accent #fde047" in out

    strict = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--strict"])
    assert strict.exit_code == 1

    as_json = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--format", "json"])
    report = json.loads(as_json.output)
    assert report["valid"] is True
    codes = {(w["code"], w["file"], w["line"]) for w in report["warnings"]}
    assert (7002, "docs/guide/b.md", 6) in codes


def test_string_order_no_longer_breaks_the_scan(tmp_path):
    cfg = _site(tmp_path, {
        "a.md": "---\ntitle: A\norder: \"2\"\n---\n# A\n\nText.\n",
        "b.md": "---\ntitle: B\norder: 1\n---\n# B\n\nText.\n",
    })
    result = CliRunner().invoke(cli_app, ["validate", "-c", str(cfg)])
    assert result.exit_code == 0, result.output
    assert "7001" in result.output and "'order' should be a number" in result.output
