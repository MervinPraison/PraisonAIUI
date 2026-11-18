"""Broken link check (compiler/links.py, ``aiui docs check-links``)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app
from praisonaiui.compiler.links import (
    check_links,
    check_site_links,
    heading_ids,
    link_targets,
    page_route,
)
from praisonaiui.compiler.search_index import slugify
from praisonaiui.schema.models import Config

SLUG_TS = Path(__file__).resolve().parents[2] / "src/frontend/src/markdown/slug.ts"
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

# Heading text -> the id slug.ts gives (pinned; the node test below re-derives them).
TRICKY = {
    "Hello World": "hello-world",
    "  Leading and trailing  ": "leading-and-trailing",
    "C++ & C# -- notes": "c-c-notes",
    "snake_case_name()": "snake_case_name",
    "Émigré café: naïve": "migr-caf-nave",
    "Emoji 🚀 launch": "emoji-launch",
    "a\u00a0non-breaking\u2003space": "a-non-breaking-space",
    "byte\ufefforder": "byte-order",
    "tab\there": "tab-here",
    "x\x1fy\x85z": "xyz",
    "日本語": "",
    "--dashes--": "dashes",
    "v1.2.3 (beta)": "v123-beta",
}


def _write(root: Path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


SITE = {
    "docs/index.md": "# Home\n\nSee [the guide](guide/setup.md#install-it).\n",
    "docs/guide/index.md": "# Guide\n\n[Setup](setup.md) is next to me.\n",
    "docs/guide/setup.md": (
        "---\ntitle: Setup\n---\n"
        "# Setup\n\n"
        "## Install it\n\n"
        "## The `aiui` **CLI**\n\n"
        "Good: [cli](#the-aiui-cli), [home](../index.md), [route](/docs/guide), ![logo](../img/logo.png)\n"
        "Broken page: [nope](instal.md)\n"
        "Broken anchor: [anchor](../index.md#nowhere)\n"
        "Broken image: ![shot](../img/logoo.png)\n"
        '<Card title="Next" href="../guide/setpu.md">Card</Card>\n'
        "```markdown\n[in code](missing.md)\n```\n"
        "Inline `[code](missing.md)` too.\n"
    ),
    "docs/guide/install.md": "# Install\n",
    "docs/img/logo.png": "png",
}


def _by_target(report):
    return {b.target: b for b in report.broken}


def test_every_kind_of_broken_link_is_found_with_file_line_and_a_suggestion(tmp_path):
    root = _write(tmp_path, SITE)
    report = check_links(root / "docs", root=root)
    broken = _by_target(report)
    assert set(broken) == {"instal.md", "../index.md#nowhere", "../img/logoo.png", "../guide/setpu.md"}

    page = broken["instal.md"]
    assert (page.file, page.line, page.reason) == ("docs/guide/setup.md", 11, "page not found")
    assert page.suggestion == "install.md"
    assert broken["../index.md#nowhere"].reason.startswith("anchor #nowhere not found")
    assert broken["../img/logoo.png"].reason == "file not found"
    assert broken["../img/logoo.png"].suggestion == "../img/logo.png"
    assert broken["../guide/setpu.md"].suggestion == "setup.md"  # a <Card href>
    assert report.pages == 4


def test_redirect_sources_count_as_valid_targets(tmp_path):
    root = _write(tmp_path, {"docs/index.md": "[old](/docs/old-page) [old md](old-page.md)\n"})
    assert len(check_links(root / "docs").broken) == 2
    assert check_links(root / "docs", redirects=["/docs/old-page/"]).ok


def test_heading_ids_match_the_renderer():
    ids = heading_ids(
        [
            "# Title",
            "## The `aiui` **CLI** [link](x.md)",
            "### Closing hashes ###",
            "##### Too deep for an id",
            "Setext heading",
            "--------------",
            '<a id="raw-id"></a>',
            "```",
            "## not a heading",
            "```",
        ]
    )
    assert ids == {"title", "the-aiui-cli-link", "closing-hashes", "setext-heading", "raw-id"}


def test_page_routes_follow_doc_source():
    assert page_route("/docs/adr/0003-selectable-layouts.md") == "/docs/adr/selectable-layouts"
    assert page_route("/docs/protocols/adp/README.md") == "/docs/protocols/adp"
    assert page_route("/docs/typescript/index.md") == "/docs/typescript"
    assert page_route("/docs/img/01-chat.png") == "/docs/img/01-chat.png"


def test_link_targets_cover_references_autolinks_and_attributes():
    lines = ["[ref]: other.md", "<https://example.com/a>", "<img src='a.png'> [x](<b c.md> \"t\")", "<!-- [no](x.md) -->"]
    assert link_targets(lines) == [(1, "other.md"), (2, "https://example.com/a"), (3, "<b c.md>"), (3, "a.png")]


def test_python_slugify_pins_the_expected_ids():
    assert {text: slugify(text) for text in TRICKY} == TRICKY


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_python_slugify_agrees_with_slug_ts():
    """Runs the renderer's slug.ts (type annotations stripped) on the same headings."""
    js = re.sub(r"export\s+", "", SLUG_TS.read_text(encoding="utf-8")).replace("(text: string): string", "(text)")
    script = js + "\nconst input = JSON.parse(require('fs').readFileSync(0, 'utf8'));\n"
    script += "process.stdout.write(JSON.stringify(input.map(slugify)))"
    out = subprocess.run(["node", "-e", script], input=json.dumps(list(TRICKY)), capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == [slugify(t) for t in TRICKY]


class _Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):  # noqa: N802 - a HEAD refusal falls back to GET
        self.send_response({"/gone": 404, "/head-refused": 405}.get(self.path, 200))
        self.end_headers()

    def do_GET(self):  # noqa: N802
        self.send_response(404 if self.path == "/gone" else 200)
        self.end_headers()

    log_message = lambda *a: None  # noqa: E731


def test_external_urls_are_checked_only_when_asked(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        root = _write(tmp_path, {"docs/index.md": f"[ok]({base}/ok) [head]({base}/head-refused) [gone]({base}/gone)\n"})
        assert check_links(root / "docs").ok
        report = check_links(root / "docs", external=True, timeout=5)
        assert [(b.target, b.reason) for b in report.broken] == [(f"{base}/gone", "HTTP 404")]
    finally:
        server.shutdown()


CONFIG = """\
site:
  title: Links
content:
  docs:
    dir: ./docs
navigation:
  tabs:
    - tab: Docs
      groups:
        - group: Guide
          pages: [index, guide/setup, guide/instal]
navbar:
  links:
    - label: Missing
      href: /docs/nowhere
"""


def test_site_check_covers_nav_entries_and_navbar_links(tmp_path):
    root = _write(tmp_path, {**SITE, "aiui.yaml": CONFIG})
    import yaml

    cfg = Config.model_validate(yaml.safe_load(CONFIG))
    broken = _by_target(check_site_links(cfg, root / "aiui.yaml"))
    assert broken["guide/instal"].reason == "nav page not found"
    assert broken["guide/instal"].suggestion == "guide/install"
    assert (broken["guide/instal"].file, broken["guide/instal"].line) == ("aiui.yaml", 11)
    assert broken["/docs/nowhere"].line == 15


def test_cli_check_links_validate_and_build_strict(tmp_path):
    root = _write(tmp_path, {**SITE, "aiui.yaml": CONFIG})
    runner = CliRunner()
    cfg = str(root / "aiui.yaml")

    result = runner.invoke(app, ["docs", "check-links", "--config", cfg])
    out = _ANSI.sub("", result.output)
    assert result.exit_code == 1
    assert "docs/guide/setup.md:11: instal.md: page not found (did you mean install.md?)" in out

    result = runner.invoke(app, ["docs", "check-links", "--config", cfg, "--json"])
    assert len(json.loads(result.output)["broken"]) == 6

    assert runner.invoke(app, ["validate", "--config", cfg]).exit_code == 0
    assert runner.invoke(app, ["validate", "--config", cfg, "--strict"]).exit_code == 1
    assert runner.invoke(app, ["build", "--config", cfg, "-o", str(root / "out"), "--strict"]).exit_code == 1
    assert not (root / "out").exists()

    (root / "docs/guide/setup.md").write_text("# Setup\n\n## Install it\n\n[home](../index.md)\n", encoding="utf-8")
    (root / "aiui.yaml").write_text(CONFIG.replace(", guide/instal", "").replace("/docs/nowhere", "/docs/guide"))
    result = runner.invoke(app, ["docs", "check-links", "--config", cfg])
    assert result.exit_code == 0, result.output
    assert "none broken" in result.output
