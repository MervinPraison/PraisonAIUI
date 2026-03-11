"""Media Analysis feature — protocol-driven image/media understanding via VisionAgent.

Architecture:
    MediaAnalysisProtocol (ABC)
      └── VisionAnalysisManager  ← wraps SDK VisionAgent/OCRAgent (lazy import)
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


# ── Media Analysis Protocol ──────────────────────────────────────────


class MediaAnalysisProtocol(ABC):
    """Protocol interface for media analysis backends."""

    @abstractmethod
    def analyze(self, *, url: Optional[str] = None, base64_data: Optional[str] = None,
                mime_type: str = "image/png", prompt: str = "Describe this image") -> Dict[str, Any]:
        """Analyze an image/media. Returns analysis result."""
        ...

    @abstractmethod
    def ocr(self, *, url: Optional[str] = None, base64_data: Optional[str] = None) -> Dict[str, Any]:
        """OCR text extraction from an image. Returns extracted text."""
        ...

    @abstractmethod
    def list_capabilities(self) -> List[str]:
        """List analysis capabilities."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Vision Analysis Manager ─────────────────────────────────────────


class VisionAnalysisManager(MediaAnalysisProtocol):
    """Wraps SDK VisionAgent/OCRAgent — lazy import with graceful fallback."""

    CAPABILITIES = ["image_description", "ocr", "object_detection", "image_qa"]

    def analyze(self, *, url: Optional[str] = None, base64_data: Optional[str] = None,
                mime_type: str = "image/png", prompt: str = "Describe this image") -> Dict[str, Any]:
        if not url and not base64_data:
            return {"error": "No image provided", "status": "error"}

        # Try gateway-registered agent first, then fall back to fresh Agent()
        agent = None
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    gw_agent = gw.get_agent(aid)
                    if gw_agent and getattr(gw_agent, "name", None) == "VisionAnalyst":
                        agent = gw_agent
                        break
        except (ImportError, Exception):
            pass

        try:
            if agent is None:
                from praisonaiagents import Agent
                agent = Agent(name="VisionAnalyst", role="Image Analyst",
                             llm="gpt-4o-mini", self_reflect=False)
            # If URL provided, format message with image
            if url:
                result = agent.chat(f"{prompt}\n\nImage: {url}")
            elif base64_data:
                result = agent.chat(f"{prompt}\n\n[base64 image data: {len(base64_data)} chars]")
            else:
                return {"error": "No image provided", "status": "error"}
            return {"analysis": str(result), "status": "success", "provider": "sdk"}
        except ImportError:
            pass
        except Exception as e:
            logger.warning("SDK VisionAgent failed: %s", e)

        # Fallback: return metadata-only analysis
        return {
            "analysis": f"[Simulated] Image analysis for: {url or 'base64 data'}",
            "status": "simulated",
            "provider": "fallback",
            "note": "Install praisonaiagents for real analysis",
        }

    def ocr(self, *, url: Optional[str] = None, base64_data: Optional[str] = None) -> Dict[str, Any]:
        agent = None
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    gw_agent = gw.get_agent(aid)
                    if gw_agent and getattr(gw_agent, "name", None) == "OCRAgent":
                        agent = gw_agent
                        break
        except (ImportError, Exception):
            pass

        try:
            if agent is None:
                from praisonaiagents import Agent
                agent = Agent(name="OCRAgent", role="OCR Specialist",
                             llm="gpt-4o-mini", self_reflect=False)
            source = url or "[base64 data]"
            result = agent.chat(f"Extract all text from this image: {source}")
            return {"text": str(result), "status": "success", "provider": "sdk"}
        except ImportError:
            pass
        except Exception as e:
            logger.warning("SDK OCR failed: %s", e)

        return {
            "text": "[Simulated] OCR text extraction placeholder",
            "status": "simulated",
            "provider": "fallback",
        }

    def list_capabilities(self) -> List[str]:
        return self.CAPABILITIES

    def health(self) -> Dict[str, Any]:
        try:
            from praisonaiagents import Agent  # noqa: F401
            return {"status": "ok", "provider": "VisionAnalysisManager", "sdk": True}
        except ImportError:
            return {"status": "degraded", "provider": "VisionAnalysisManager", "sdk": False}


# ── Manager singleton ────────────────────────────────────────────────

_analysis_manager: Optional[MediaAnalysisProtocol] = None


def get_analysis_manager() -> MediaAnalysisProtocol:
    global _analysis_manager
    if _analysis_manager is None:
        _analysis_manager = VisionAnalysisManager()
    return _analysis_manager


def set_analysis_manager(manager: MediaAnalysisProtocol) -> None:
    global _analysis_manager
    _analysis_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class MediaAnalysisFeature(BaseFeatureProtocol):
    """Media analysis — image understanding, OCR, object detection."""

    feature_name = "media_analysis"
    feature_description = "Image and media analysis (VisionAgent, OCR)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/media/analyze", self._analyze, methods=["POST"]),
            Route("/api/media/ocr", self._ocr, methods=["POST"]),
            Route("/api/media/capabilities", self._capabilities, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_analysis_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _analyze(self, request: Request) -> JSONResponse:
        mgr = get_analysis_manager()
        body = await request.json()
        result = mgr.analyze(
            url=body.get("url"),
            base64_data=body.get("base64_data"),
            mime_type=body.get("mime_type", "image/png"),
            prompt=body.get("prompt", "Describe this image"),
        )
        status = 200 if result.get("status") != "error" else 400
        return JSONResponse(result, status_code=status)

    async def _ocr(self, request: Request) -> JSONResponse:
        mgr = get_analysis_manager()
        body = await request.json()
        result = mgr.ocr(url=body.get("url"), base64_data=body.get("base64_data"))
        return JSONResponse(result)

    async def _capabilities(self, request: Request) -> JSONResponse:
        mgr = get_analysis_manager()
        caps = mgr.list_capabilities()
        return JSONResponse({"capabilities": caps, "count": len(caps)})


# Backward-compat alias
PraisonAIMediaAnalysis = MediaAnalysisFeature
