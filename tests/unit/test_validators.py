"""Tests for validators."""

from pathlib import Path

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
from praisonaiui.schema.validators import ValidationError, ValidationResult, validate_config


class TestValidationResult:
    """Tests for ValidationResult."""

    def test_success(self):
        """Test successful validation result."""
        result = ValidationResult.success()
        assert result.valid is True
        assert result.errors == []

    def test_failure(self):
        """Test failed validation result."""
        errors = [
            ValidationError(code=2001, category="validation", message="Test error")
        ]
        result = ValidationResult.failure(errors)
        assert result.valid is False
        assert len(result.errors) == 1


class TestValidateConfig:
    """Tests for validate_config function."""

    def test_valid_config(self, tmp_path):
        """Test validation of a valid config."""
        # Create docs directory
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()

        config = Config(
            site=SiteConfig(title="Test"),
            content=ContentConfig(docs=ContentSourceConfig(dir="./docs")),
            components={"header": ComponentConfig(type="Header", props={})},
            templates={
                "docs": TemplateConfig(
                    layout="Default",
                    slots={"header": SlotRef(ref="header")},
                )
            },
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )

        result = validate_config(config, tmp_path)
        assert result.valid is True

    def test_invalid_component_ref(self):
        """Test validation catches invalid component reference."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={
                "docs": TemplateConfig(
                    layout="Default",
                    slots={"header": SlotRef(ref="nonexistent")},
                )
            },
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )

        result = validate_config(config)
        assert result.valid is False
        assert any(e.code == 2001 for e in result.errors)

    def test_invalid_template_ref(self):
        """Test validation catches invalid template reference in routes."""
        config = Config(
            site=SiteConfig(title="Test"),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="nonexistent")],
        )

        result = validate_config(config)
        assert result.valid is False
        assert any(e.code == 2002 for e in result.errors)

    def test_missing_docs_dir(self, tmp_path):
        """Test validation catches missing docs directory."""
        config = Config(
            site=SiteConfig(title="Test"),
            content=ContentConfig(docs=ContentSourceConfig(dir="./missing")),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )

        result = validate_config(config, tmp_path)
        assert result.valid is False
        assert any(e.code == 3001 for e in result.errors)
