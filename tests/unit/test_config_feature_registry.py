"""Tests for the config feature registry."""

from praisonaiui.schema.features import ConfigFeatureRegistry, FeatureStatus
from praisonaiui.schema.models import Config, I18nConfig, SEOConfig, SiteConfig


def test_feature_registry_basic():
    """Test basic feature registry functionality."""
    registry = ConfigFeatureRegistry()

    # Test implemented features
    assert registry.is_implemented("site")
    assert registry.is_implemented("seo")
    assert registry.is_implemented("a11y")

    # Test experimental features
    assert registry.is_experimental("i18n")

    # Test non-existent features
    assert not registry.is_implemented("nonexistent")
    assert not registry.is_experimental("nonexistent")


def test_feature_registry_with_config():
    """Test feature registry with actual config objects."""
    registry = ConfigFeatureRegistry()

    # Config with only implemented features
    config = Config(
        site=SiteConfig(title="Test"),
        seo=SEOConfig(title_template="%s | Test")
    )

    experimental = registry.get_experimental_fields(config)
    assert experimental == []

    # Config with experimental features
    config_with_experimental = Config(
        site=SiteConfig(title="Test"),
        i18n=I18nConfig(locales=["en", "es"])
    )

    experimental = registry.get_experimental_fields(config_with_experimental)
    assert "i18n" in experimental


def test_feature_info():
    """Test FeatureInfo structure."""
    registry = ConfigFeatureRegistry()

    seo_info = registry.get_feature("seo")
    assert seo_info is not None
    assert seo_info.status == FeatureStatus.IMPLEMENTED
    assert seo_info.since == "0.5.0"

    i18n_info = registry.get_feature("i18n")
    assert i18n_info is not None
    assert i18n_info.status == FeatureStatus.EXPERIMENTAL
    assert i18n_info.since is None
