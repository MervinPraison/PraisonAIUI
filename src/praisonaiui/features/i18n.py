"""i18n feature — protocol-driven internationalization framework.

Architecture:
    I18nProtocol (ABC)
      └── JSONLocaleManager  ← loads translations from JSON-like dicts
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── I18n Protocol ────────────────────────────────────────────────────


class I18nProtocol(ABC):
    """Protocol interface for internationalization backends."""

    @abstractmethod
    def t(self, key: str, locale: str = "en", **variables: Any) -> str:
        """Translate a key. Returns translated string with variable interpolation."""
        ...

    @abstractmethod
    def list_locales(self) -> List[Dict[str, str]]:
        """List available locales."""
        ...

    @abstractmethod
    def get_strings(self, locale: str) -> Dict[str, str]:
        """Get all strings for a locale."""
        ...

    @abstractmethod
    def get_locale(self) -> str:
        """Get the current default locale."""
        ...

    @abstractmethod
    def set_locale(self, locale: str) -> None:
        """Set the current default locale."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── JSON Locale Manager ─────────────────────────────────────────────


class JSONLocaleManager(I18nProtocol):
    """In-memory locale manager with JSON-style string maps."""

    DEFAULT_STRINGS = {
        "en": {
            "app.title": "PraisonAI",
            "app.welcome": "Welcome to PraisonAI",
            "chat.placeholder": "Type your message...",
            "chat.send": "Send",
            "chat.thinking": "Thinking...",
            "nav.dashboard": "Dashboard",
            "nav.agents": "Agents",
            "nav.settings": "Settings",
            "nav.sessions": "Sessions",
            "error.generic": "Something went wrong",
            "error.network": "Network error",
        },
        "es": {
            "app.title": "PraisonAI",
            "app.welcome": "Bienvenido a PraisonAI",
            "chat.placeholder": "Escribe tu mensaje...",
            "chat.send": "Enviar",
            "chat.thinking": "Pensando...",
            "nav.dashboard": "Panel",
            "nav.agents": "Agentes",
            "nav.settings": "Configuración",
            "nav.sessions": "Sesiones",
            "error.generic": "Algo salió mal",
            "error.network": "Error de red",
        },
        "fr": {
            "app.title": "PraisonAI",
            "app.welcome": "Bienvenue sur PraisonAI",
            "chat.placeholder": "Tapez votre message...",
            "chat.send": "Envoyer",
            "chat.thinking": "Réflexion...",
            "nav.dashboard": "Tableau de bord",
            "nav.agents": "Agents",
            "nav.settings": "Paramètres",
            "nav.sessions": "Sessions",
            "error.generic": "Quelque chose a mal tourné",
            "error.network": "Erreur réseau",
        },
    }

    LOCALE_INFO = [
        {"code": "en", "name": "English", "native": "English"},
        {"code": "es", "name": "Spanish", "native": "Español"},
        {"code": "fr", "name": "French", "native": "Français"},
    ]

    def __init__(self, *, default_locale: str = "en") -> None:
        self._default = default_locale
        self._strings: Dict[str, Dict[str, str]] = dict(self.DEFAULT_STRINGS)

    def t(self, key: str, locale: str = "", **variables: Any) -> str:
        loc = locale or self._default
        strings = self._strings.get(loc, self._strings.get("en", {}))
        text = strings.get(key, key)
        if variables:
            for k, v in variables.items():
                text = text.replace(f"{{{k}}}", str(v))
        return text

    def list_locales(self) -> List[Dict[str, str]]:
        return self.LOCALE_INFO

    def get_strings(self, locale: str) -> Dict[str, str]:
        return self._strings.get(locale, {})

    def get_locale(self) -> str:
        return self._default

    def set_locale(self, locale: str) -> None:
        self._default = locale

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "JSONLocaleManager",
            "default_locale": self._default,
            "locales": len(self._strings),
        }


# ── Manager singleton ────────────────────────────────────────────────

_i18n_manager: Optional[I18nProtocol] = None


def get_i18n_manager() -> I18nProtocol:
    global _i18n_manager
    if _i18n_manager is None:
        _i18n_manager = JSONLocaleManager()
    return _i18n_manager


def set_i18n_manager(manager: I18nProtocol) -> None:
    global _i18n_manager
    _i18n_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class I18nFeature(BaseFeatureProtocol):
    """Internationalization — locale loading, translation, switcher."""

    feature_name = "i18n"
    feature_description = "Internationalization framework (multi-language support)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/i18n/locales", self._locales, methods=["GET"]),
            Route("/api/i18n/strings/{locale}", self._strings, methods=["GET"]),
            Route("/api/i18n/translate", self._translate, methods=["POST"]),
            Route("/api/i18n/locale", self._get_locale, methods=["GET"]),
            Route("/api/i18n/locale", self._set_locale, methods=["POST"]),
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_i18n_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _locales(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        locales = mgr.list_locales()
        return JSONResponse({"locales": locales, "count": len(locales)})

    async def _strings(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        locale = request.path_params["locale"]
        strings = mgr.get_strings(locale)
        if not strings:
            return JSONResponse({"error": f"Locale '{locale}' not found"}, status_code=404)
        return JSONResponse({"locale": locale, "strings": strings, "count": len(strings)})

    async def _translate(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        body = await request.json()
        text = mgr.t(
            body.get("key", ""), locale=body.get("locale", ""), **body.get("variables", {})
        )
        return JSONResponse({"key": body.get("key", ""), "text": text})

    async def _get_locale(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        return JSONResponse({"locale": mgr.get_locale()})

    async def _set_locale(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        body = await request.json()
        mgr.set_locale(body.get("locale", "en"))
        return JSONResponse({"locale": mgr.get_locale()})


# Backward-compat alias
PraisonAII18n = I18nFeature
