"""Create or update ElevenLabs Speech Engine with the public WebSocket URL.

Usage:
    cd examples/python/voice-agent
    .\\start_dev.ps1          # sets PUBLIC_API_BASE_URL first
    py -3.13 setup_speech_engine.py
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
ENV_PATH = _ROOT / ".env"


def _load_env() -> None:
    if not ENV_PATH.is_file():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key:
            os.environ[key] = value


def _write_env_value(key: str, value: str) -> None:
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.is_file() else []
    updated = False
    new_lines: list[str] = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}")
            updated = True
        else:
            new_lines.append(line)
    if not updated:
        new_lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    os.environ[key] = value


def _http_to_ws(base: str) -> str:
    base = base.strip().rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :] + "/ws"
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :] + "/ws"
    raise RuntimeError(f"Unsupported URL: {base}")


def _public_ws_url() -> str:
    # Prefer dedicated Speech Engine tunnel (sidecar on 8002).
    speech_base = os.getenv("SPEECH_ENGINE_PUBLIC_URL", "").strip().rstrip("/")
    if speech_base:
        return _http_to_ws(speech_base)
    base = os.getenv("PUBLIC_API_BASE_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError(
            "Set SPEECH_ENGINE_PUBLIC_URL or PUBLIC_API_BASE_URL in .env "
            "(run .\\start_dev.ps1 first)"
        )
    return _http_to_ws(base)


async def _patch_overrides(client: object, engine_id: str) -> None:
    """Enable client first-message override (not exposed on speech_engine.update yet)."""
    wrapper = getattr(client, "_client_wrapper", None)
    if wrapper is None:
        return
    try:
        await wrapper.httpx_client.request(
            f"v1/speech-engine/{engine_id}",
            method="PATCH",
            json={"overrides": {"first_message": True}},
            headers={"content-type": "application/json"},
        )
        print("Enabled first_message client override")
    except Exception as exc:  # noqa: BLE001
        print(f"Note: could not enable first_message override ({exc})")


async def _ensure_engine() -> str:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Set ELEVENLABS_API_KEY in .env")

    try:
        from elevenlabs import AsyncElevenLabs
    except ImportError as exc:
        raise RuntimeError(
            "Install Speech Engine SDK: pip install 'elevenlabs>=2.47.0'"
        ) from exc

    if not hasattr(AsyncElevenLabs(api_key="check"), "speech_engine"):
        raise RuntimeError(
            "elevenlabs package is too old for Speech Engine. Run: "
            "pip install -U 'elevenlabs>=2.47.0'"
        )

    ws_url = _public_ws_url()
    engine_id = os.getenv("SPEECH_ENGINE_ID", "").strip()
    client = AsyncElevenLabs(api_key=api_key)

    turn_config = {"turn_eagerness": "eager", "turn_timeout": 5.0}
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip() or "cjVigY5qzO86Huf0OWal"
    tts_config = {"model_id": "eleven_flash_v2", "voice_id": voice_id}

    if engine_id:
        updated = await client.speech_engine.update(
            speech_engine_id=engine_id,
            speech_engine={"ws_url": ws_url},
            turn=turn_config,
            tts=tts_config,
        )
        resolved = getattr(updated, "speech_engine_id", None) or getattr(updated, "engine_id", None) or engine_id
        print(f"Updated Speech Engine: {resolved}")
        print(f"WebSocket URL: {ws_url}")
        print(f"TTS voice_id: {voice_id}")
        await _patch_overrides(client, str(resolved))
        return str(resolved)

    created = await client.speech_engine.create(
        name="PraisonAI Voice",
        speech_engine={"ws_url": ws_url},
        turn=turn_config,
        tts=tts_config,
        overrides={"first_message": True},
    )
    resolved = getattr(created, "engine_id", None) or getattr(created, "id", None)
    if not resolved:
        raise RuntimeError("Speech Engine create did not return an engine_id")
    print(f"Created Speech Engine: {resolved}")
    print(f"WebSocket URL: {ws_url}")
    print(f"TTS voice_id: {voice_id}")
    return str(resolved)


async def main_async() -> int:
    _load_env()
    try:
        engine_id = await _ensure_engine()
    except RuntimeError as exc:
        print(f"Setup failed: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "convai_write" in message or "missing_permissions" in message:
            print("Setup failed: ElevenLabs API key lacks convai_write permission.")
            print(
                "In ElevenLabs dashboard: API Keys -> edit key -> ElevenAgents: enable Write."
            )
        else:
            print(f"Setup failed: {exc}")
        return 1

    _write_env_value("SPEECH_ENGINE_ID", engine_id)
    print("Speech Engine auto-setup complete.")
    return 0


def main() -> int:
    return asyncio.run(main_async())


if __name__ == "__main__":
    raise SystemExit(main())
