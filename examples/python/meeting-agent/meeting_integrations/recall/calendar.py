"""Calendar V2 OAuth callback forwarding for Recall-hosted setup."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

FORWARD_PARAMS = ("state", "code", "error", "recall_calendar_setup_probe")


def forward_calendar_callback(
    *,
    regional_callback_uri: str,
    query_params: dict[str, str],
) -> tuple[int, str]:
    """Forward allowed query params to Recall's regional callback URI."""
    filtered = {k: v for k, v in query_params.items() if k in FORWARD_PARAMS and v}
    if not filtered.get("state") and "recall_calendar_setup_probe" not in filtered:
        return 400, "missing state"

    url = regional_callback_uri
    if filtered:
        url = f"{url}?{urlencode(filtered)}"

    logger.info("Forwarding calendar callback to Recall (state redacted)")
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        response = client.get(url)
    return response.status_code, response.text[:500]
