"""TTS feature — protocol-driven text-to-speech with swappable backends.

Architecture:
    TTSProtocol (ABC)
      ├── OpenAITTSManager     ← wraps OpenAI TTS API (lazy import)
      └── BrowserTTSManager    ← returns SpeechSynthesis instruction for client-side
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


# ── TTS Protocol ─────────────────────────────────────────────────────


class TTSProtocol(ABC):
    """Protocol interface for text-to-speech backends."""

    @abstractmethod
    def synthesize(
        self, text: str, *, voice: str = "alloy", model: str = "tts-1"
    ) -> Dict[str, Any]:
        """Synthesize speech. Returns dict with audio info."""
        ...

    @abstractmethod
    def list_voices(self) -> List[Dict[str, str]]:
        """List available voices."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Browser TTS Manager ─────────────────────────────────────────────


class BrowserTTSManager(TTSProtocol):
    """Client-side TTS via Web Speech API — zero cost, no API key needed."""

    VOICES = [
        {"id": "default", "name": "Default", "lang": "en-US"},
        {"id": "google-us", "name": "Google US English", "lang": "en-US"},
        {"id": "google-uk", "name": "Google UK English", "lang": "en-GB"},
    ]

    def synthesize(
        self, text: str, *, voice: str = "default", model: str = "browser"
    ) -> Dict[str, Any]:
        return {
            "type": "browser_speech",
            "text": text,
            "voice": voice,
            "instruction": "Use window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))",
        }

    def list_voices(self) -> List[Dict[str, str]]:
        return self.VOICES

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": "BrowserTTSManager", "type": "client-side"}


# ── OpenAI TTS Manager ──────────────────────────────────────────────


class OpenAITTSManager(TTSProtocol):
    """Server-side TTS via OpenAI TTS API — lazy import, requires API key."""

    VOICES = [
        {"id": "alloy", "name": "Alloy"},
        {"id": "echo", "name": "Echo"},
        {"id": "fable", "name": "Fable"},
        {"id": "onyx", "name": "Onyx"},
        {"id": "nova", "name": "Nova"},
        {"id": "shimmer", "name": "Shimmer"},
    ]

    def synthesize(
        self, text: str, *, voice: str = "alloy", model: str = "tts-1"
    ) -> Dict[str, Any]:
        try:
            import openai

            client = openai.OpenAI()
            response = client.audio.speech.create(model=model, voice=voice, input=text)
            return {
                "type": "audio",
                "format": "mp3",
                "model": model,
                "voice": voice,
                "size_bytes": len(response.content) if hasattr(response, "content") else 0,
                "status": "generated",
            }
        except ImportError:
            return {"type": "error", "error": "openai package not installed"}
        except Exception as e:
            return {"type": "error", "error": str(e)}

    def list_voices(self) -> List[Dict[str, str]]:
        return self.VOICES

    def health(self) -> Dict[str, Any]:
        try:
            import openai  # noqa: F401

            return {"status": "ok", "provider": "OpenAITTSManager"}
        except ImportError:
            return {
                "status": "degraded",
                "provider": "OpenAITTSManager",
                "reason": "openai not installed",
            }


# ── Manager singleton ────────────────────────────────────────────────

_tts_manager: Optional[TTSProtocol] = None


def get_tts_manager() -> TTSProtocol:
    global _tts_manager
    if _tts_manager is None:
        _tts_manager = BrowserTTSManager()
    return _tts_manager


def set_tts_manager(manager: TTSProtocol) -> None:
    global _tts_manager
    _tts_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class TTSFeature(BaseFeatureProtocol):
    """Text-to-speech — delegates to TTSProtocol backend."""

    feature_name = "tts"
    feature_description = "Text-to-speech synthesis (browser or OpenAI)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/tts/synthesize", self._synthesize, methods=["POST"]),
            Route("/api/tts/voices", self._voices, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "tts",
                "help": "Text-to-speech operations",
                "commands": {
                    "voices": {"help": "List available voices", "handler": self._cli_voices},
                    "speak": {"help": "Synthesize text", "handler": self._cli_speak},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_tts_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _synthesize(self, request: Request) -> JSONResponse:
        mgr = get_tts_manager()
        body = await request.json()
        result = mgr.synthesize(
            text=body.get("text", ""),
            voice=body.get("voice", "alloy"),
            model=body.get("model", "tts-1"),
        )
        return JSONResponse(result)

    async def _voices(self, request: Request) -> JSONResponse:
        mgr = get_tts_manager()
        voices = mgr.list_voices()
        return JSONResponse({"voices": voices, "count": len(voices)})

    def _cli_voices(self) -> str:
        mgr = get_tts_manager()
        voices = mgr.list_voices()
        return "\n".join(f"  {v['id']} — {v['name']}" for v in voices)

    def _cli_speak(self, text: str, voice: str = "alloy") -> str:
        mgr = get_tts_manager()
        result = mgr.synthesize(text=text, voice=voice)
        return f"TTS result: {result.get('type', 'unknown')}"


# Backward-compat alias
PraisonAITTS = TTSFeature
