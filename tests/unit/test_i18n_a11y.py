"""Tests for i18n and accessibility configuration."""


from praisonaiui.schema.features import get_feature_registry
from praisonaiui.schema.models import (
    A11yConfig,
    Config,
    I18nConfig,
    SiteConfig,
)
from praisonaiui.schema.validators import validate_config


class TestI18nConfig:
    """Tests for I18nConfig model."""

    def test_default_values(self):
        """Test i18n defaults."""
        i18n = I18nConfig()

        assert i18n.default_locale == "en"
        assert i18n.locales == ["en"]
        assert i18n.rtl_locales == []
        assert i18n.fallback_locale is None
        assert i18n.translations_dir == "./translations"

    def test_with_rtl_locales(self):
        """Test RTL locale configuration."""
        i18n = I18nConfig(
            defaultLocale="en",
            locales=["en", "ar", "he"],
            rtlLocales=["ar", "he"],
        )

        assert i18n.rtl_locales == ["ar", "he"]

    def test_with_fallback(self):
        """Test fallback locale."""
        i18n = I18nConfig(
            defaultLocale="fr",
            locales=["fr", "en", "de"],
            fallbackLocale="en",
        )

        assert i18n.fallback_locale == "en"


class TestA11yConfig:
    """Tests for A11yConfig model."""

    def test_default_values(self):
        """Test accessibility defaults."""
        a11y = A11yConfig()

        assert a11y.skip_to_content is True
        assert a11y.focus_visible is True
        assert a11y.reduce_motion is False
        assert a11y.aria_labels == {}

    def test_with_custom_aria_labels(self):
        """Test custom ARIA labels."""
        a11y = A11yConfig(
            ariaLabels={
                "navigation": "Main navigation",
                "search": "Search documentation",
            }
        )

        assert a11y.aria_labels["navigation"] == "Main navigation"

    def test_reduce_motion_enabled(self):
        """Test reduce motion preference."""
        a11y = A11yConfig(reduceMotion=True)

        assert a11y.reduce_motion is True


class TestConfigWithI18nA11y:
    """Test Config with i18n and a11y."""

    def test_config_with_i18n(self):
        """Test Config with i18n field."""
        config = Config(
            site=SiteConfig(title="Test"),
            i18n=I18nConfig(
                defaultLocale="en",
                locales=["en", "es", "fr"],
            ),
        )

        assert config.i18n is not None
        assert config.i18n.locales == ["en", "es", "fr"]

    def test_config_with_a11y(self):
        """Test Config with a11y field."""
        config = Config(
            site=SiteConfig(title="Test"),
            a11y=A11yConfig(
                skipToContent=True,
                focusVisible=True,
            ),
        )

        assert config.a11y is not None
        assert config.a11y.skip_to_content is True

    def test_config_with_both(self):
        """Test Config with both i18n and a11y."""
        config = Config(
            site=SiteConfig(title="Full Featured"),
            i18n=I18nConfig(locales=["en", "ja"]),
            a11y=A11yConfig(reduceMotion=True),
        )

        assert config.i18n.locales == ["en", "ja"]
        assert config.a11y.reduce_motion is True


class TestI18nImplementation:
    """Test i18n feature implementation status."""

    def test_i18n_is_implemented(self):
        """Test that i18n is marked as IMPLEMENTED in feature registry."""
        registry = get_feature_registry()
        assert registry.is_implemented("i18n") is True
        assert registry.is_experimental("i18n") is False

    def test_strict_validate_i18n_no_error(self):
        """Test that strict validation passes with valid i18n config."""
        config = Config(
            site=SiteConfig(title="I18n Test"),
            i18n=I18nConfig(
                defaultLocale="en",
                locales=["en", "es", "ar"],
                rtlLocales=["ar"],
            ),
        )

        result = validate_config(config, strict=True)

        assert result.valid is True
        # Verify no 4001 errors for i18n
        experimental_errors = [e for e in result.errors if e.code == 4001]
        i18n_errors = [e for e in experimental_errors if "i18n" in e.message]
        assert len(i18n_errors) == 0
