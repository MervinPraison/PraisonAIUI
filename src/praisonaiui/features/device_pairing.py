"""Device Pairing feature — protocol-driven device pairing with session sync.

Architecture:
    PairingProtocol (ABC)
      └── DefaultPairingManager  ← short codes, session linking, device registry
"""

from __future__ import annotations

import logging
import secrets
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Pairing Protocol ─────────────────────────────────────────────────


class PairingProtocol(ABC):
    """Protocol interface for device pairing backends."""

    @abstractmethod
    def create_code(self, *, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate a pairing code. Returns code + expiry info."""
        ...

    @abstractmethod
    def validate_code(self, code: str) -> Dict[str, Any]:
        """Validate and consume a pairing code. Returns session info."""
        ...

    @abstractmethod
    def list_devices(self, session_id: str) -> List[Dict[str, Any]]:
        """List paired devices for a session."""
        ...

    @abstractmethod
    def remove_device(self, device_id: str) -> bool:
        """Remove a paired device."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Default Pairing Manager ─────────────────────────────────────────


class DefaultPairingManager(PairingProtocol):
    """In-memory pairing with short codes and session linking."""

    def __init__(self, *, code_ttl: int = 300, max_devices: int = 5) -> None:
        self._code_ttl = code_ttl
        self._max_devices = max_devices
        self._codes: Dict[str, Dict[str, Any]] = {}
        self._devices: Dict[str, Dict[str, Any]] = {}

    def create_code(self, *, session_id: Optional[str] = None) -> Dict[str, Any]:
        code = secrets.token_hex(3).upper()  # 6-char hex code
        entry = {
            "code": code,
            "session_id": session_id or "default",
            "created_at": time.time(),
            "expires_at": time.time() + self._code_ttl,
            "used": False,
        }
        self._codes[code] = entry
        return entry

    def validate_code(self, code: str) -> Dict[str, Any]:
        entry = self._codes.get(code)
        if not entry:
            return {"valid": False, "error": "Code not found"}
        if entry["used"]:
            return {"valid": False, "error": "Code already used"}
        if time.time() > entry["expires_at"]:
            del self._codes[code]
            return {"valid": False, "error": "Code expired"}

        # Mark as used and create device entry
        entry["used"] = True
        device_id = secrets.token_hex(8)
        device = {
            "device_id": device_id,
            "session_id": entry["session_id"],
            "paired_at": time.time(),
            "user_agent": "unknown",
        }
        self._devices[device_id] = device
        return {"valid": True, "device_id": device_id, "session_id": entry["session_id"]}

    def list_devices(self, session_id: str) -> List[Dict[str, Any]]:
        return [d for d in self._devices.values() if d.get("session_id") == session_id]

    def remove_device(self, device_id: str) -> bool:
        if device_id in self._devices:
            del self._devices[device_id]
            return True
        return False

    def health(self) -> Dict[str, Any]:
        active_codes = sum(1 for c in self._codes.values()
                          if not c["used"] and time.time() < c["expires_at"])
        return {
            "status": "ok",
            "provider": "DefaultPairingManager",
            "active_codes": active_codes,
            "paired_devices": len(self._devices),
        }


# ── Manager singleton ────────────────────────────────────────────────

_pairing_manager: Optional[PairingProtocol] = None


def get_pairing_manager() -> PairingProtocol:
    global _pairing_manager
    if _pairing_manager is None:
        _pairing_manager = DefaultPairingManager()
    return _pairing_manager


def set_pairing_manager(manager: PairingProtocol) -> None:
    global _pairing_manager
    _pairing_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class DevicePairingFeature(BaseFeatureProtocol):
    """Device pairing — short codes, session sync, device management."""

    feature_name = "device_pairing"
    feature_description = "Device pairing via short codes and session synchronization"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/pairing/create", self._create, methods=["POST"]),
            Route("/api/pairing/validate", self._validate, methods=["POST"]),
            Route("/api/pairing/devices", self._list_devices, methods=["GET"]),
            Route("/api/pairing/devices/{device_id}", self._remove_device, methods=["DELETE"]),
        ]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        mgr = get_pairing_manager()
        h = mgr.health()
        h["feature"] = self.name
        h.update(gateway_health())
        return h

    async def _create(self, request: Request) -> JSONResponse:
        mgr = get_pairing_manager()
        body = await request.json()
        result = mgr.create_code(session_id=body.get("session_id"))
        return JSONResponse(result, status_code=201)

    async def _validate(self, request: Request) -> JSONResponse:
        mgr = get_pairing_manager()
        body = await request.json()
        result = mgr.validate_code(body.get("code", ""))
        status = 200 if result.get("valid") else 400
        return JSONResponse(result, status_code=status)

    async def _list_devices(self, request: Request) -> JSONResponse:
        mgr = get_pairing_manager()
        session_id = request.query_params.get("session_id", "default")
        devices = mgr.list_devices(session_id)
        return JSONResponse({"devices": devices, "count": len(devices)})

    async def _remove_device(self, request: Request) -> JSONResponse:
        mgr = get_pairing_manager()
        device_id = request.path_params["device_id"]
        if not mgr.remove_device(device_id):
            return JSONResponse({"error": "Device not found"}, status_code=404)
        return JSONResponse({"deleted": device_id})


# Backward-compat alias
PraisonAIDevicePairing = DevicePairingFeature
