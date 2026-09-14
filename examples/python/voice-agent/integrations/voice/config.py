"""Voice provider configuration loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class VoiceConfigError(ValueError):
    """Missing or invalid voice provider configuration."""


@dataclass(frozen=True)
class VoiceSettings:
    api_key: str
    server_url_secret: str | None
    public_api_base_url: str | None
    default_assistant_id: str | None
    default_phone_number_id: str | None
    public_api_key: str | None
    api_base: str

    @property
    def webhook_url(self) -> str | None:
        if not self.public_api_base_url:
            return None
        return f"{self.public_api_base_url.rstrip('/')}/webhooks/voice"

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_base)


def _read_dotenv(name: str) -> str | None:
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env"
    if not env_path.is_file():
        return None
    prefix = f"{name}="
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith(prefix):
            return line[len(prefix) :].strip() or None
    return None


def _env(name: str) -> str:
    return os.getenv(name, "").strip() or (_read_dotenv(name) or "")


def load_voice_settings(*, require_key: bool = True) -> VoiceSettings:
    api_key = _env("VOICE_PRIVATE_API_KEY") or _env("VOICE_API_KEY")
    api_base = _env("VOICE_API_BASE")
    if require_key and not api_key:
        raise VoiceConfigError("VOICE_PRIVATE_API_KEY (or VOICE_API_KEY) is required")
    if require_key and not api_base:
        raise VoiceConfigError("VOICE_API_BASE is required")
    return VoiceSettings(
        api_key=api_key,
        server_url_secret=_env("VOICE_SERVER_URL_SECRET") or None,
        public_api_base_url=_env("PUBLIC_API_BASE_URL") or None,
        default_assistant_id=_env("VOICE_ASSISTANT_ID") or None,
        default_phone_number_id=_env("VOICE_PHONE_NUMBER_ID") or None,
        public_api_key=_env("VOICE_PUBLIC_API_KEY") or None,
        api_base=api_base.rstrip("/"),
    )


def get_web_sdk_settings() -> tuple[str, str]:
    """Browser SDK URL + legacy global name (global unused for ESM imports)."""
    url = _env("VOICE_WEB_SDK_URL") or "https://esm.sh/@vapi-ai/web@2.7.0"
    global_name = _env("VOICE_WEB_SDK_GLOBAL") or "Vapi"
    return url, global_name
