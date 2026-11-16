"""`aiui build` output works on a static host (GitHub Pages): every docs page's
markdown is at the URL the client fetches (`<route>.md`), and slugs only drop a
number prefix at the start of a path segment."""

from __future__ import annotations

from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.docs_scanner import DocsScanner
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)


def _slugs(docs: Path) -> set[str]:
    return {p.slug for p in DocsScanner(docs).scan()}


def test_number_prefix_dropped_only_at_segment_start(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    (docs / "adr").mkdir(parents=True)
    (docs / "02-guides").mkdir()
    (docs / "adr" / "0001-replay-view.md").write_text("# ADR 1\n")
    (docs / "02-guides" / "01-intro.md").write_text("# Intro\n")
    (docs / "ui-reset-2026-11.md").write_text("# Report\n")

    assert _slugs(docs) == {"adr/replay-view", "guides/intro", "ui-reset-2026-11"}


def _build(tmp_path: Path) -> Path:
    docs = tmp_path / "docs"
    (docs / "adr").mkdir(parents=True)
    (docs / "guide").mkdir()
    (docs / "index.md").write_text("# Home\n")
    (docs / "adr" / "0003-layouts.md").write_text("# Layouts ADR\n")
    (docs / "guide" / "index.md").write_text("# Guide overview\n")
    (docs / "guide" / "setup.md").write_text("# Setup\n")
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def test_markdown_served_at_each_route(tmp_path: Path) -> None:
    out = _build(tmp_path)
    # The client fetches `${route}.md` for each nav page.
    assert (out / "docs" / "index.md").read_text() == "# Home\n"
    assert (out / "docs" / "guide" / "setup.md").exists()
    assert (out / "docs" / "guide.md").read_text() == "# Guide overview\n"
    assert (out / "docs" / "adr" / "layouts.md").read_text() == "# Layouts ADR\n"
    # The source files stay where they were, for links that name the file.
    assert (out / "docs" / "adr" / "0003-layouts.md").exists()


def test_route_html_for_every_page(tmp_path: Path) -> None:
    out = _build(tmp_path)
    for route in ("docs/index", "docs/guide", "docs/guide/setup", "docs/adr/layouts"):
        assert (out / f"{route}.html").exists(), route
        # Hosts with no /x -> x.html mapping redirect /x to /x/ and serve this.
        assert (out / route / "index.html").read_text() == (out / f"{route}.html").read_text()
