"""Tests for the Compiler — TDD: tests prove compilation pipeline correctness."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from praisonaiui.compiler.compiler import Compiler, CompileResult
from praisonaiui.schema.models import (
    ComponentConfig,
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    SlotRef,
    TemplateConfig,
)


@pytest.fixture
def minimal_config() -> Config:
    """Minimal valid configuration."""
    return Config(
        site=SiteConfig(title="Test Site"),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )


@pytest.fixture
def full_config(tmp_path: Path) -> Config:
    """Full configuration with components, content, and templates."""
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "index.md").write_text("# Welcome\n\nHello!")
    (docs_dir / "guide.md").write_text("# Guide\n\nA guide.")

    return Config(
        site=SiteConfig(title="Full Site", description="A full test site"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(docs_dir))),
        components={
            "header_main": ComponentConfig(type="Header", props={"logoText": "MySite"}),
            "footer_main": ComponentConfig(
                type="Footer", props={"text": "© 2026 MySite"}
            ),
        },
        templates={
            "docs": TemplateConfig(
                layout="ThreeColumnLayout",
                slots={
                    "header": SlotRef(ref="header_main"),
                    "footer": SlotRef(ref="footer_main"),
                    "main": SlotRef(type="DocContent"),
                },
            )
        },
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )


class TestCompileResult:
    """Tests for CompileResult dataclass."""

    def test_success_result(self):
        result = CompileResult(success=True, files=["ui-config.json"])
        assert result.success is True
        assert result.error is None

    def test_failure_result(self):
        result = CompileResult(success=False, files=[], error="Validation failed")
        assert result.success is False
        assert result.error == "Validation failed"


class TestCompilerUiConfig:
    """Tests for ui-config.json generation."""

    def test_minimal_ui_config(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        ui_config = json.loads((tmp_path / "output" / "ui-config.json").read_text())
        assert ui_config["site"]["title"] == "Test Site"
        assert "templates" in ui_config
        assert "docs" in ui_config["templates"]

    def test_full_ui_config_components(self, full_config: Config, tmp_path: Path):
        compiler = Compiler(full_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        ui_config = json.loads((tmp_path / "output" / "ui-config.json").read_text())
        assert "header_main" in ui_config["components"]
        assert ui_config["components"]["header_main"]["props"]["logoText"] == "MySite"
        assert "footer_main" in ui_config["components"]
        assert "© 2026" in ui_config["components"]["footer_main"]["props"]["text"]

    def test_template_slot_refs_serialized(self, full_config: Config, tmp_path: Path):
        compiler = Compiler(full_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        ui_config = json.loads((tmp_path / "output" / "ui-config.json").read_text())
        docs_template = ui_config["templates"]["docs"]
        assert docs_template["slots"]["header"]["ref"] == "header_main"
        assert docs_template["slots"]["footer"]["ref"] == "footer_main"
        assert docs_template["slots"]["main"]["type"] == "DocContent"


class TestCompilerRouteManifest:
    """Tests for route-manifest.json generation."""

    def test_route_manifest_generated(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert "route-manifest.json" in result.files

        manifest = json.loads(
            (tmp_path / "output" / "route-manifest.json").read_text()
        )
        assert len(manifest["routes"]) == 1
        assert manifest["routes"][0]["pattern"] == "/docs/**"
        assert manifest["routes"][0]["template"] == "docs"

    def test_route_priority_ordering(self, tmp_path: Path):
        """First route should have highest priority."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={
                "docs": TemplateConfig(layout="Default", slots={}),
                "home": TemplateConfig(layout="Default", slots={}),
            },
            routes=[
                RouteConfig(match="/docs/**", template="docs"),
                RouteConfig(match="/", template="home"),
            ],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        manifest = json.loads(
            (tmp_path / "output" / "route-manifest.json").read_text()
        )
        # First route in list gets highest priority
        assert manifest["routes"][0]["priority"] > manifest["routes"][1]["priority"]


class TestCompilerValidation:
    """Tests that compilation fails correctly on invalid configs."""

    def test_broken_component_ref(self, tmp_path: Path):
        """Template references a component that doesn't exist."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={
                "docs": TemplateConfig(
                    layout="Default",
                    slots={"header": SlotRef(ref="nonexistent_header")},
                )
            },
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is False
        assert "nonexistent_header" in (result.error or "")

    def test_broken_template_ref_in_route(self, tmp_path: Path):
        """Route references a template that doesn't exist."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/", template="nonexistent")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is False
        assert "nonexistent" in (result.error or "")


class TestCompilerOutputFiles:
    """Tests for output file generation."""

    def test_output_directory_created(self, minimal_config: Config, tmp_path: Path):
        output = tmp_path / "build" / "nested"
        compiler = Compiler(minimal_config, base_path=tmp_path)
        result = compiler.compile(output)
        assert result.success is True
        assert output.exists()

    def test_minified_json(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        compiler.compile(tmp_path / "output", minify=True)

        content = (tmp_path / "output" / "ui-config.json").read_text()
        # Minified JSON should not have newlines
        assert "\n" not in content

    def test_non_minified_json_has_indent(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        compiler.compile(tmp_path / "output", minify=False)

        content = (tmp_path / "output" / "ui-config.json").read_text()
        # Non-minified JSON should have newlines
        assert "\n" in content

    def test_required_files_generated(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert "ui-config.json" in result.files
        assert "route-manifest.json" in result.files
        assert "index.html" in result.files


class TestCompilerDocsContent:
    """Tests for docs content handling."""

    def test_docs_nav_generated(self, full_config: Config, tmp_path: Path):
        compiler = Compiler(full_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert "docs-nav.json" in result.files

        nav = json.loads((tmp_path / "output" / "docs-nav.json").read_text())
        assert "items" in nav

    def test_no_docs_nav_without_content(self, minimal_config: Config, tmp_path: Path):
        compiler = Compiler(minimal_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert "docs-nav.json" not in result.files

    def test_docs_directory_copied(self, full_config: Config, tmp_path: Path):
        compiler = Compiler(full_config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert "docs/" in result.files
        assert (tmp_path / "output" / "docs").exists()
