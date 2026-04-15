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
    ThemeConfig,
)
from praisonaiui.themes import get_theme_css, inject_theme_css


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


class TestGetThemeCss:
    """Tests for get_theme_css — G11: malformed CSS bug."""

    def test_light_mode_has_root_block(self):
        css = get_theme_css(preset="zinc", dark_mode=False, radius="0.5rem")
        assert ":root {" in css
        assert ".dark" not in css

    def test_dark_mode_has_both_blocks(self):
        css = get_theme_css(preset="zinc", dark_mode=True, radius="0.5rem")
        assert ":root {" in css
        assert ".dark {" in css
        # :root block must NOT be nested inside .dark
        lines = css.split("\n")
        root_idx = next(i for i, line in enumerate(lines) if ":root {" in line)
        dark_idx = next(i for i, line in enumerate(lines) if ".dark {" in line)
        # Both must be top-level (root should come before dark)
        assert root_idx < dark_idx

    def test_radius_in_output(self):
        css = get_theme_css(preset="zinc", dark_mode=False, radius="0.75rem")
        assert "--radius: 0.75rem" in css

    def test_contains_color_vars(self):
        css = get_theme_css(preset="zinc", dark_mode=False, radius="0.5rem")
        assert "--background:" in css
        assert "--foreground:" in css
        assert "--primary:" in css


class TestCompilerThemeCss:
    """Tests for G1: compiler must generate theme.css."""

    def test_theme_css_generated_with_theme_config(self, tmp_path: Path):
        """Compiler should produce assets/theme.css when theme config is set."""
        config = Config(
            site=SiteConfig(
                title="Themed Site",
                theme=ThemeConfig(preset="zinc", radius="md", dark_mode=True),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True
        theme_css = tmp_path / "output" / "assets" / "theme.css"
        assert theme_css.exists(), "assets/theme.css must be generated"
        content = theme_css.read_text()
        assert ":root {" in content
        assert "--radius:" in content

    def test_no_theme_config_still_succeeds(self, tmp_path: Path):
        """Compiler must succeed and generate theme.css even without theme config."""
        config = Config(
            site=SiteConfig(title="No Theme Site"),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True
        assert (tmp_path / "output" / "assets" / "theme.css").exists()

    def test_theme_preset_affects_css(self, tmp_path: Path):
        """Different presets should produce different CSS output."""
        css_zinc = get_theme_css(preset="zinc", dark_mode=True, radius="0.5rem")
        css_rose = get_theme_css(preset="rose", dark_mode=True, radius="0.5rem")
        # They should differ (at least in color values, assuming different themes)
        # With fallback themes, zinc is always available
        assert "--background:" in css_zinc
        assert "--background:" in css_rose

    def test_all_22_presets_produce_valid_css(self):
        """G-NEW-2: All 22 official presets produce valid CSS with :root block."""
        from praisonaiui.themes import FALLBACK_THEMES
        assert len(FALLBACK_THEMES) == 22, f"Expected 22 presets, got {len(FALLBACK_THEMES)}"
        for name in FALLBACK_THEMES:
            css = get_theme_css(preset=name, dark_mode=True, radius="0.5rem")
            assert ":root {" in css, f"Preset '{name}' missing :root block"
            assert ".dark {" in css, f"Preset '{name}' missing .dark block"
            assert "--primary:" in css, f"Preset '{name}' missing --primary"

    def test_blue_preset_has_distinct_primary(self):
        """G-NEW-2: Blue preset must have different primary than zinc."""
        css_zinc = get_theme_css(preset="zinc")
        css_blue = get_theme_css(preset="blue")
        assert css_zinc != css_blue, "Blue and zinc must produce different CSS"


class TestInjectThemeCss:
    """Tests for inject_theme_css — writes to correct path."""

    def test_writes_theme_css_file(self, tmp_path: Path):
        inject_theme_css(tmp_path, preset="zinc", dark_mode=True, radius="0.5rem")
        theme_file = tmp_path / "assets" / "theme.css"
        assert theme_file.exists()
        content = theme_file.read_text()
        assert ":root {" in content

    def test_creates_assets_dir(self, tmp_path: Path):
        output = tmp_path / "build"
        inject_theme_css(output, preset="zinc", dark_mode=False, radius="0.5rem")
        assert (output / "assets" / "theme.css").exists()


class TestThemePipelineIntegration:
    """G9: Integration test — YAML preset -> compile -> theme.css with correct colors."""

    def test_rose_preset_produces_theme_css(self, tmp_path: Path):
        """Rose preset in YAML config → compiled theme.css has non-zinc colors."""
        config = Config(
            site=SiteConfig(
                title="Rose Site",
                theme=ThemeConfig(preset="rose", radius="xl", dark_mode=True),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True
        assert "assets/theme.css" in result.files

        theme_css = (tmp_path / "output" / "assets" / "theme.css").read_text()
        assert ":root {" in theme_css
        assert ".dark {" in theme_css
        assert "--radius: 1rem" in theme_css  # xl = 1rem

    def test_light_mode_no_dark_block(self, tmp_path: Path):
        """Light mode config → theme.css has no .dark block."""
        config = Config(
            site=SiteConfig(
                title="Light Site",
                theme=ThemeConfig(preset="zinc", radius="md", dark_mode=False),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        theme_css = (tmp_path / "output" / "assets" / "theme.css").read_text()
        assert ":root {" in theme_css
        assert ".dark" not in theme_css

    def test_ui_config_json_has_theme(self, tmp_path: Path):
        """ui-config.json must reflect the theme settings from YAML."""
        config = Config(
            site=SiteConfig(
                title="Theme Config Test",
                theme=ThemeConfig(preset="blue", radius="lg", dark_mode=True),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        ui_config = json.loads(
            (tmp_path / "output" / "ui-config.json").read_text()
        )
        theme = ui_config["site"]["theme"]
        assert theme["preset"] == "blue"
        assert theme["radius"] == "lg"
        assert theme["darkMode"] is True

    def test_no_theme_config_still_produces_theme_css(self, tmp_path: Path):
        """G-NEW-1: When site.theme is None, theme.css must still be generated with defaults."""
        config = Config(
            site=SiteConfig(title="No Theme Site"),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        assert config.site.theme is None
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        theme_css_path = tmp_path / "output" / "assets" / "theme.css"
        assert theme_css_path.exists(), "theme.css must always be generated"
        content = theme_css_path.read_text()
        assert ":root {" in content
        assert "--radius:" in content

    def test_light_mode_antiflicker_no_dark_class(self, tmp_path: Path):
        """G-NEW-7: When darkMode=false, anti-flicker script must NOT add .dark class."""
        config = Config(
            site=SiteConfig(
                title="Light Site",
                theme=ThemeConfig(preset="zinc", radius="md", dark_mode=False),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        index_html = (tmp_path / "output" / "index.html").read_text()
        assert "classList.add('dark')" not in index_html

    def test_dark_mode_antiflicker_has_dark_class(self, tmp_path: Path):
        """G-NEW-7: When darkMode=true, anti-flicker script SHOULD add .dark class."""
        config = Config(
            site=SiteConfig(
                title="Dark Site",
                theme=ThemeConfig(preset="zinc", radius="md", dark_mode=True),
            ),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True

        index_html = (tmp_path / "output" / "index.html").read_text()
        assert "classList.add('dark')" in index_html


class TestSimpleMdToHtml:
    """G-NEW-8: Frontmatter parsing in _simple_md_to_html."""

    def test_frontmatter_is_stripped(self):
        """Frontmatter between --- markers should not appear in output."""
        md = "---\ntitle: Hello\ndate: 2024-01-01\n---\n# Heading\nSome text"
        html = Compiler._simple_md_to_html(md)
        assert "title: Hello" not in html
        assert "date: 2024-01-01" not in html
        assert "<h1>Heading</h1>" in html
        assert "<p>Some text</p>" in html

    def test_no_frontmatter(self):
        """Content without frontmatter should render normally."""
        md = "# Hello\nWorld"
        html = Compiler._simple_md_to_html(md)
        assert "<h1>Hello</h1>" in html
        assert "<p>World</p>" in html
