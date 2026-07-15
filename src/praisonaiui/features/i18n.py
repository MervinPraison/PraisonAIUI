"""i18n feature — protocol-driven internationalization framework.

Architecture:
    I18nProtocol (ABC)
      └── JSONLocaleManager  ← loads translations from JSON-like dicts
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Compile regex patterns once for performance
LOCALE_PATTERN = re.compile(r'^[a-z]{2}(-[A-Z]{2})?$')
KEY_PATTERN = re.compile(r'^[a-zA-Z0-9._-]+$')


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
            "chat.context.healthy": "Context healthy",
            "chat.context.warning": "Approaching context limit",
            "chat.context.critical": "Context nearly full",
            "chat.context.estimate": "Estimate",
            "chat.compaction.banner": "Context nearly full \u2014 older messages may be summarized on next send",
            "chat.compaction.compacted": "Context compacted",
            "chat.memory.chip": "{count} memories",
            "chat.memory.empty_turn": "No memories for this turn",
            "skills.title": "Skills Studio",
            "skills.subtitle": "Review self_improve proposals",
            "skills.tab.pending": "Pending",
            "skills.tab.installed": "Installed",
            "skills.tab.history": "History",
            "skills.diff.current": "Current",
            "skills.diff.proposed": "Proposed",
            "skills.diff.no_existing": "No existing skill",
            "skills.action.approve": "Approve",
            "skills.action.reject": "Reject",
            "skills.pending.empty": "No pending skill writes",
            "finops.strip.title": "Cost FinOps",
            "finops.strip.today": "Today: {tokens} tokens",
            "finops.strip.view_usage": "View usage",
            "finops.banner.warn": "Daily token budget at {pct}% \u2014 consider lighter models",
            "finops.banner.critical": "Daily token budget at {pct}% \u2014 review usage",
            "finops.chip.label": "{tokens} \u00b7 {model}",
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
            "chat.context.healthy": "Contexto saludable",
            "chat.context.warning": "Acercándose al límite de contexto",
            "chat.context.critical": "Contexto casi lleno",
            "chat.context.estimate": "Estimación",
            "chat.compaction.banner": "Contexto casi lleno \u2014 los mensajes antiguos pueden resumirse al enviar",
            "chat.compaction.compacted": "Contexto compactado",
            "chat.memory.chip": "{count} recuerdos",
            "chat.memory.empty_turn": "Sin recuerdos para este turno",
            "skills.title": "Estudio de habilidades",
            "skills.subtitle": "Revisar propuestas de self_improve",
            "skills.tab.pending": "Pendientes",
            "skills.tab.installed": "Instaladas",
            "skills.tab.history": "Historial",
            "skills.diff.current": "Actual",
            "skills.diff.proposed": "Propuesto",
            "skills.diff.no_existing": "No existe la habilidad",
            "skills.action.approve": "Aprobar",
            "skills.action.reject": "Rechazar",
            "skills.pending.empty": "No hay escrituras de habilidades pendientes",
            "finops.strip.title": "FinOps de costos",
            "finops.strip.today": "Hoy: {tokens} tokens",
            "finops.strip.view_usage": "Ver uso",
            "finops.banner.warn": "Presupuesto diario de tokens al {pct}% \u2014 considere modelos más ligeros",
            "finops.banner.critical": "Presupuesto diario de tokens al {pct}% \u2014 revise el uso",
            "finops.chip.label": "{tokens} \u00b7 {model}",
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
            "chat.context.healthy": "Contexte sain",
            "chat.context.warning": "Approche de la limite de contexte",
            "chat.context.critical": "Contexte presque plein",
            "chat.context.estimate": "Estimation",
            "chat.compaction.banner": "Contexte presque plein \u2014 les anciens messages peuvent être résumés au prochain envoi",
            "chat.compaction.compacted": "Contexte compacté",
            "chat.memory.chip": "{count} souvenirs",
            "chat.memory.empty_turn": "Aucun souvenir pour ce tour",
            "skills.title": "Studio de comp\u00e9tences",
            "skills.subtitle": "Examiner les propositions de self_improve",
            "skills.tab.pending": "En attente",
            "skills.tab.installed": "Install\u00e9es",
            "skills.tab.history": "Historique",
            "skills.diff.current": "Actuel",
            "skills.diff.proposed": "Propos\u00e9",
            "skills.diff.no_existing": "Aucune comp\u00e9tence existante",
            "skills.action.approve": "Approuver",
            "skills.action.reject": "Rejeter",
            "skills.pending.empty": "Aucune \u00e9criture de comp\u00e9tence en attente",
            "finops.strip.title": "FinOps des coûts",
            "finops.strip.today": "Aujourd'hui : {tokens} tokens",
            "finops.strip.view_usage": "Voir l'utilisation",
            "finops.banner.warn": "Budget quotidien de tokens à {pct}% \u2014 envisagez des modèles plus légers",
            "finops.banner.critical": "Budget quotidien de tokens à {pct}% \u2014 vérifiez l'utilisation",
            "finops.chip.label": "{tokens} \u00b7 {model}",
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

        # Validate locale format to prevent injection
        if not LOCALE_PATTERN.match(locale):
            return JSONResponse({"error": f"Invalid locale format: '{locale}'"}, status_code=400)

        strings = mgr.get_strings(locale)
        if not strings:
            return JSONResponse({"error": f"Locale '{locale}' not found"}, status_code=404)
        return JSONResponse({"locale": locale, "strings": strings, "count": len(strings)})

    async def _translate(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        body = await request.json()

        # Validate locale if provided
        locale = body.get("locale", "")
        if locale:
            if not LOCALE_PATTERN.match(locale):
                return JSONResponse({"error": f"Invalid locale format: '{locale}'"}, status_code=400)

        # Validate key format (alphanumeric with dots)
        key = body.get("key", "")
        if key:
            if not KEY_PATTERN.match(key):
                return JSONResponse({"error": f"Invalid key format: '{key}'"}, status_code=400)

        text = mgr.t(key, locale=locale, **body.get("variables", {}))
        return JSONResponse({"key": key, "text": text})

    async def _get_locale(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        return JSONResponse({"locale": mgr.get_locale()})

    async def _set_locale(self, request: Request) -> JSONResponse:
        mgr = get_i18n_manager()
        body = await request.json()
        locale = body.get("locale", "en")

        # Validate locale format to prevent injection
        if not LOCALE_PATTERN.match(locale):
            return JSONResponse({"error": f"Invalid locale format: '{locale}'"}, status_code=400)

        mgr.set_locale(locale)
        return JSONResponse({"locale": mgr.get_locale()})


# Backward-compat alias
PraisonAII18n = I18nFeature
