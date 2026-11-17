"""Each built docs page carries its own markdown (a JSON script that
docs/docLoader.ts adoptInlinedDoc reads), so the first render needs no request."""

from __future__ import annotations

import json
import re
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)

TRICKY = "# Guide\n\n```html\n</script><script>alert(1)</script>\n```\n\n<!-- a & b > c -->\n"
SCRIPT_RE = re.compile(r'<script type="application/json" id="aiui-initial-doc">(.*?)</script>', re.S)


def _build(tmp_path: Path) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n\nWelcome.\n")
    (docs / "guide" / "tricky.md").write_text(TRICKY)
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _inlined(html: str) -> dict:
    found = SCRIPT_RE.findall(html)
    assert len(found) == 1
    return json.loads(found[0])


def test_a_page_carries_its_published_markdown(tmp_path: Path) -> None:
    out = _build(tmp_path)
    data = _inlined((out / "docs/guide/tricky.html").read_text())
    assert data["url"] == "/docs/guide/tricky.md"
    assert data["text"] == (out / "docs/guide/tricky.md").read_text()


def test_the_text_can_never_close_the_script(tmp_path: Path) -> None:
    html = (_build(tmp_path) / "docs/guide/tricky.html").read_text()
    raw = SCRIPT_RE.search(html).group(1)
    assert "<" not in raw and ">" not in raw and "&" not in raw
    assert "</script><script>alert(1)" in json.loads(raw)["text"]


def test_the_home_page_carries_the_docs_home_markdown(tmp_path: Path) -> None:
    data = _inlined((_build(tmp_path) / "index.html").read_text())
    assert data["url"] == "/docs/index.md"
    assert data["text"].startswith("# Home")
