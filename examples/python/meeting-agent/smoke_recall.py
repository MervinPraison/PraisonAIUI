"""Non-binding smoke checks for Recall integration boundaries."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

_EXAMPLE_DIR = Path(__file__).resolve().parent
_REPO_SRC = _EXAMPLE_DIR.parents[2] / "src"
for _p in (_EXAMPLE_DIR, str(_REPO_SRC)):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))


def _sign_payload(secret: str, body: str) -> dict[str, str]:
    key = base64.b64decode(secret.removeprefix("whsec_"))
    msg_id = "msg_smoke_test"
    timestamp = "1700000000"
    to_sign = f"{msg_id}.{timestamp}.{body}"
    signature = base64.b64encode(
        hmac.new(key, to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii")
    return {
        "webhook-id": msg_id,
        "webhook-timestamp": timestamp,
        "webhook-signature": f"v1,{signature}",
    }


def run_smoke() -> None:
    os.environ.setdefault("RECALL_REGION", "eu-central-1")
    os.environ.setdefault("RECALL_API_KEY", "smoke-test-key")
    os.environ.setdefault("RECALL_WEBHOOK_VERIFICATION_SECRET", "whsec_" + base64.b64encode(b"smoke-secret-key-32-bytes-long!!").decode())
    os.environ.setdefault("RECALL_WORKSPACE_ID", "33a035c7-03c1-4ec9-b752-18cdfbbefc42")
    os.environ.setdefault("PUBLIC_API_BASE_URL", "https://smoke.example.test")

    import app as meeting_app  # noqa: WPS433
    from integrations.recall.config import load_recall_settings
    from integrations.recall.verify import verify_request_from_recall

    settings = load_recall_settings()
    assert settings.api_key == "smoke-test-key"

    body = json.dumps({"event": "bot.joining_call", "data": {"bot": {"id": "b1", "metadata": {"meeting_id": "m1"}}}})
    headers = _sign_payload(settings.webhook_verification_secret, body)
    verify_request_from_recall(
        secret=settings.webhook_verification_secret,
        headers=headers,
        payload=body,
    )

    client = TestClient(meeting_app.app)
    assert client.get("/health").status_code == 200

    bad = client.post("/webhooks/recall", content=body, headers={"webhook-id": "x"})
    assert bad.status_code == 401

    ok = client.post("/webhooks/recall", content=body, headers=headers)
    assert ok.status_code == 200

    with patch(
        "recall_routes.schedule_recall_bot",
        return_value={
            "meeting_id": "m-smoke",
            "recall_bot_id": "bot-smoke",
            "status": "scheduled",
        },
    ):
        schedule = client.post(
            "/api/recall/bots",
            json={"meeting_url": "https://zoom.us/j/123", "title": "Smoke"},
        )
    assert schedule.status_code == 201

    print("Recall smoke checks passed")


if __name__ == "__main__":
    run_smoke()
