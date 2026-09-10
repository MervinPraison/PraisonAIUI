"""Voice agent stack diagnostics (OpenClaw-style doctor)."""

from __future__ import annotations

import os
import socket
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _tcp_open(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _http_status(url: str, timeout: float = 5.0) -> tuple[str, str]:
    try:
        req = Request(url, headers={"User-Agent": "praisonai-voice-doctor"})
        with urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            if 200 <= code < 500:
                return "pass", f"HTTP {code}"
            return "warn", f"HTTP {code}"
    except HTTPError as exc:
        if 200 <= exc.code < 500:
            return "pass", f"HTTP {exc.code}"
        return "fail", f"HTTP {exc.code}"
    except URLError as exc:
        return "fail", str(exc.reason)
    except Exception as exc:  # noqa: BLE001
        return "fail", str(exc)


def _env_check(name: str, *, required: bool = False) -> dict[str, Any]:
    value = os.getenv(name, "").strip()
    if value:
        masked = value[:4] + "…" if len(value) > 8 else "set"
        return {"name": name, "status": "pass", "detail": masked}
    if required:
        return {"name": name, "status": "fail", "detail": "missing"}
    return {"name": name, "status": "warn", "detail": "not set"}


def run_voice_doctor(*, app_port: int = 8001, sidecar_port: int = 8002) -> dict[str, Any]:
    """Run local voice-agent health checks."""
    checks: list[dict[str, Any]] = []

    checks.append(_env_check("OPENAI_API_KEY", required=True))
    checks.append(_env_check("ELEVENLABS_API_KEY"))
    checks.append(_env_check("SPEECH_ENGINE_ID"))
    checks.append(_env_check("SPEECH_ENGINE_PUBLIC_URL"))
    checks.append(_env_check("PUBLIC_API_BASE_URL"))
    checks.append(_env_check("VOICE_PRIVATE_API_KEY"))

    if _tcp_open("127.0.0.1", app_port):
        checks.append({"name": f"App port {app_port}", "status": "pass", "detail": "listening"})
        status, detail = _http_status(f"http://127.0.0.1:{app_port}/api/voice/config")
        checks.append({"name": "Voice config API", "status": status, "detail": detail})
        status, detail = _http_status(f"http://127.0.0.1:{app_port}/api/voice/speech-engine/config")
        checks.append({"name": "Speech Engine config", "status": status, "detail": detail})
        status, detail = _http_status(f"http://127.0.0.1:{app_port}/api/voice/realtime/config")
        checks.append({"name": "GPT Realtime config", "status": status, "detail": detail})
        status, detail = _http_status(f"http://127.0.0.1:{app_port}/api/mcp/servers")
        checks.append({"name": "MCP servers API", "status": status, "detail": detail})
    else:
        checks.append(
            {
                "name": f"App port {app_port}",
                "status": "fail",
                "detail": "not listening — run .\\start_dev.ps1",
            }
        )

    if _tcp_open("127.0.0.1", sidecar_port):
        checks.append({"name": f"Speech sidecar {sidecar_port}", "status": "pass", "detail": "listening"})
    else:
        checks.append(
            {
                "name": f"Speech sidecar {sidecar_port}",
                "status": "warn",
                "detail": "not listening (ElevenLabs path needs sidecar)",
            }
        )

    speech_url = os.getenv("SPEECH_ENGINE_PUBLIC_URL", "").strip().rstrip("/")
    if speech_url:
        status, detail = _http_status(speech_url)
        checks.append({"name": "Speech Engine tunnel", "status": status, "detail": detail})

    passed = sum(1 for c in checks if c["status"] == "pass")
    warnings = sum(1 for c in checks if c["status"] == "warn")
    failed = sum(1 for c in checks if c["status"] == "fail")
    return {
        "checks": checks,
        "summary": {"passed": passed, "warnings": warnings, "failed": failed},
    }
