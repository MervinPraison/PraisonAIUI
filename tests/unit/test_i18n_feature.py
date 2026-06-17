"""Tests for i18n feature implementation."""

import pytest

from praisonaiui.features.i18n import I18nFeature, JSONLocaleManager, get_i18n_manager


class TestI18nFeature:
    """Tests for I18nFeature class."""

    def test_feature_metadata(self):
        """Test feature metadata properties."""
        feature = I18nFeature()
        assert feature.name == "i18n"
        assert "Internationalization" in feature.description

    def test_feature_routes(self):
        """Test that i18n feature exposes correct routes."""
        feature = I18nFeature()
        routes = feature.routes()

        # Check expected routes exist
        route_paths = [route.path for route in routes]
        assert "/api/i18n/locales" in route_paths
        assert "/api/i18n/strings/{locale}" in route_paths
        assert "/api/i18n/translate" in route_paths
        assert "/api/i18n/locale" in route_paths

    @pytest.mark.asyncio
    async def test_feature_health(self):
        """Test health endpoint."""
        feature = I18nFeature()
        health = await feature.health()

        assert health["status"] == "ok"
        assert health["feature"] == "i18n"
        assert "provider" in health


class TestJSONLocaleManager:
    """Tests for JSONLocaleManager."""

    def test_default_initialization(self):
        """Test default initialization."""
        manager = JSONLocaleManager()
        assert manager.get_locale() == "en"
        assert len(manager.list_locales()) > 0

    def test_translation_lookup(self):
        """Test translation key lookup."""
        manager = JSONLocaleManager()

        # Test English translation
        text = manager.t("app.welcome", locale="en")
        assert "Welcome" in text

        # Test Spanish translation
        text = manager.t("app.welcome", locale="es")
        assert "Bienvenido" in text

        # Test French translation
        text = manager.t("app.welcome", locale="fr")
        assert "Bienvenue" in text

    def test_translation_with_variables(self):
        """Test translation with variable substitution."""
        manager = JSONLocaleManager()
        manager._strings["en"]["greeting"] = "Hello {name}!"

        text = manager.t("greeting", locale="en", name="World")
        assert text == "Hello World!"

    def test_unknown_key_returns_key(self):
        """Test that unknown keys return the key itself."""
        manager = JSONLocaleManager()
        text = manager.t("unknown.key", locale="en")
        assert text == "unknown.key"

    def test_locale_switching(self):
        """Test switching default locale."""
        manager = JSONLocaleManager()

        assert manager.get_locale() == "en"
        manager.set_locale("es")
        assert manager.get_locale() == "es"

        # Test that default locale is used when none specified
        text = manager.t("app.welcome")
        assert "Bienvenido" in text

    def test_get_strings(self):
        """Test getting all strings for a locale."""
        manager = JSONLocaleManager()

        en_strings = manager.get_strings("en")
        assert "app.title" in en_strings
        assert "chat.placeholder" in en_strings

        es_strings = manager.get_strings("es")
        assert "app.title" in es_strings
        assert es_strings["chat.placeholder"] == "Escribe tu mensaje..."

    def test_list_locales(self):
        """Test listing available locales."""
        manager = JSONLocaleManager()
        locales = manager.list_locales()

        # Check structure
        assert isinstance(locales, list)
        assert len(locales) >= 3  # At least en, es, fr

        # Check format
        en_locale = next((loc for loc in locales if loc["code"] == "en"), None)
        assert en_locale is not None
        assert en_locale["name"] == "English"
        assert en_locale["native"] == "English"


class TestI18nIntegration:
    """Integration tests for i18n system."""

    def test_singleton_manager(self):
        """Test that get_i18n_manager returns singleton."""
        mgr1 = get_i18n_manager()
        mgr2 = get_i18n_manager()
        assert mgr1 is mgr2

    def test_manager_health(self):
        """Test manager health check."""
        manager = get_i18n_manager()
        health = manager.health()

        assert health["status"] == "ok"
        assert "provider" in health
        assert "default_locale" in health
