"""Recall.ai runtime configuration — credentials stay server-side only."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


class RecallConfigError(ValueError):
    """Raised when required Recall settings are missing or invalid."""


@dataclass(frozen=True)
class RecallSettings:
    """Validated Recall workspace settings injected into the API client."""

    region: str
    api_key: str
    webhook_verification_secret: str
    public_api_base_url: str
    workspace_id: str
    bot_name: str
    calendar_auto_record: bool

    @property
    def api_base(self) -> str:
        return f"https://{self.region}.recall.ai"

    @property
    def webhook_url(self) -> str:
        return f"{self.public_api_base_url.rstrip('/')}/webhooks/recall"

    @property
    def calendar_callback_url(self) -> str:
        return f"{self.public_api_base_url.rstrip('/')}/api/recall/calendar/callback"


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RecallConfigError(f"{name} is required for Recall integration")
    return value


def load_recall_settings(*, require_public_url: bool = False) -> RecallSettings:
    """Load Recall settings from the process environment."""
    region = os.getenv("RECALL_REGION", "eu-central-1").strip() or "eu-central-1"
    public_url = os.getenv("PUBLIC_API_BASE_URL", "").strip()
    if require_public_url and not public_url:
        raise RecallConfigError(
            "PUBLIC_API_BASE_URL is required (stable HTTPS backend URL for webhooks "
            "and calendar OAuth callback forwarding)"
        )
    if public_url:
        parsed = urlparse(public_url)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc:
            raise RecallConfigError("PUBLIC_API_BASE_URL must be an absolute http(s) URL")
        if parsed.hostname in {"localhost", "127.0.0.1"}:
            raise RecallConfigError(
                "PUBLIC_API_BASE_URL must not be localhost; use a reserved tunnel domain"
            )

    auto_record = os.getenv("CALENDAR_AUTO_RECORD", "true").strip().lower()
    return RecallSettings(
        region=region,
        api_key=_require("RECALL_API_KEY"),
        webhook_verification_secret=_require("RECALL_WEBHOOK_VERIFICATION_SECRET"),
        public_api_base_url=public_url,
        workspace_id=os.getenv(
            "RECALL_WORKSPACE_ID", "33a035c7-03c1-4ec9-b752-18cdfbbefc42"
        ).strip(),
        bot_name=os.getenv("RECALL_BOT_NAME", "Praison Meeting Agent").strip()
        or "Praison Meeting Agent",
        calendar_auto_record=auto_record not in {"0", "false", "no", "off"},
    )
