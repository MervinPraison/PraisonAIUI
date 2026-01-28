"""Tests for schema models - TDD: write tests first."""

import pytest

from praisonaiui.schema.models import (
    Config,
    ComponentConfig,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    SlotRef,
    TemplateConfig,
)


class TestSiteConfig:
    """Tests for SiteConfig model."""

    def test_minimal_site_config(self):
        """Test creating a minimal site config with just title."""
        config = SiteConfig(title="Test Site")
        assert config.title == "Test Site"
        assert config.route_base_docs == "/docs"
        assert config.ui == "shadcn"

    def test_site_config_with_all_fields(self):
        """Test creating a site config with all fields."""
        config = SiteConfig(
            title="Full Site",
            description="A test site",
            routeBaseDocs="/documentation",
            ui="mui",
        )
        assert config.title == "Full Site"
        assert config.description == "A test site"
        assert config.route_base_docs == "/documentation"
        assert config.ui == "mui"


class TestContentConfig:
    """Tests for ContentConfig model."""

    def test_content_source_defaults(self):
        """Test default values for content source."""
        source = ContentSourceConfig(dir="./docs")
        assert source.dir == "./docs"
        assert source.include == ["**/*.md", "**/*.mdx"]
        assert source.exclude == []
        assert source.index_files == ["index.md", "README.md"]

    def test_content_config_with_docs(self):
        """Test content config with docs source."""
        content = ContentConfig(docs=ContentSourceConfig(dir="./docs"))
        assert content.docs is not None
        assert content.docs.dir == "./docs"


class TestTemplateConfig:
    """Tests for TemplateConfig model."""

    def test_template_with_slots(self):
        """Test creating a template with slots."""
        template = TemplateConfig(
            layout="ThreeColumnLayout",
            slots={
                "header": SlotRef(ref="header_main"),
                "main": SlotRef(type="DocContent"),
                "right": None,
            },
        )
        assert template.layout == "ThreeColumnLayout"
        assert template.slots["header"].ref == "header_main"
        assert template.slots["main"].type == "DocContent"
        assert template.slots["right"] is None


class TestRouteConfig:
    """Tests for RouteConfig model."""

    def test_simple_route(self):
        """Test creating a simple route."""
        route = RouteConfig(match="/docs/**", template="docs")
        assert route.match == "/docs/**"
        assert route.template == "docs"
        assert route.slots is None

    def test_route_with_slot_override(self):
        """Test route with slot override."""
        route = RouteConfig(
            match="/docs/changelog",
            template="docs",
            slots={"right": None},
        )
        assert route.slots["right"] is None


class TestConfig:
    """Tests for root Config model."""

    def test_minimal_config(self):
        """Test creating minimal valid config."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        assert config.site.title == "Test"
        assert config.schema_version == 1

    def test_full_config(self):
        """Test creating a full config with all sections."""
        config = Config(
            schemaVersion=1,
            site=SiteConfig(title="Full Site"),
            content=ContentConfig(docs=ContentSourceConfig(dir="./docs")),
            components={
                "header": ComponentConfig(type="Header", props={"text": "Hello"})
            },
            templates={
                "docs": TemplateConfig(
                    layout="ThreeColumnLayout",
                    slots={"header": SlotRef(ref="header")},
                )
            },
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )
        assert config.content.docs.dir == "./docs"
        assert config.components["header"].type == "Header"
        assert len(config.routes) == 1

    def test_config_from_dict(self):
        """Test creating config from dictionary (YAML-like)."""
        data = {
            "schemaVersion": 1,
            "site": {"title": "From Dict"},
            "templates": {"docs": {"layout": "Default", "slots": {}}},
            "routes": [{"match": "/docs/**", "template": "docs"}],
        }
        config = Config.model_validate(data)
        assert config.site.title == "From Dict"
