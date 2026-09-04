"""Unit tests for Recall.ai integration in the meeting-agent example."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

_ROOT = Path(__file__).resolve().parents[2] / "examples" / "python" / "meeting-agent"
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_SECRET = "whsec_" + base64.b64encode(b"test-secret-key-for-recall-verify!").decode()


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def recall_env(monkeypatch, tmp_path):
    monkeypatch.setenv("RECALL_REGION", "eu-central-1")
    monkeypatch.setenv("RECALL_API_KEY", "test-recall-key")
    monkeypatch.setenv("RECALL_WEBHOOK_VERIFICATION_SECRET", _SECRET)
    monkeypatch.setenv("RECALL_WORKSPACE_ID", "33a035c7-03c1-4ec9-b752-18cdfbbefc42")
    monkeypatch.setenv("PUBLIC_API_BASE_URL", "https://dev.example.test")
    monkeypatch.setenv("PRAISONAI_MEETINGS_DIR", str(tmp_path))
    monkeypatch.setenv("PRAISONAI_MEETINGS_DB", str(tmp_path / "meetings.db"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")


def test_verify_request_accepts_valid_signature():
    verify_mod = _load("recall_verify", _ROOT / "integrations" / "recall" / "verify.py")
    import hmac
    import hashlib

    body = '{"event":"bot.done"}'
    msg_id = "msg_test"
    ts = "1700000001"
    key = base64.b64decode(_SECRET.removeprefix("whsec_"))
    sig = base64.b64encode(
        hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256).digest()
    ).decode()
    verify_mod.verify_request_from_recall(
        secret=_SECRET,
        headers={
            "webhook-id": msg_id,
            "webhook-timestamp": ts,
            "webhook-signature": f"v1,{sig}",
        },
        payload=body,
    )


def test_verify_request_rejects_bad_signature():
    verify_mod = _load("recall_verify", _ROOT / "integrations" / "recall" / "verify.py")
    with pytest.raises(verify_mod.VerificationError):
        verify_mod.verify_request_from_recall(
            secret=_SECRET,
            headers={
                "webhook-id": "x",
                "webhook-timestamp": "1",
                "webhook-signature": "v1,bad",
            },
            payload="{}",
        )


def test_schedule_bot_persists_intent_before_api():
    service = _load("recall_service", _ROOT / "integrations" / "recall" / "service.py")
    client = MagicMock()
    client.create_bot.return_value = {"id": "bot-abc"}

    with patch.object(service, "RecallClient", return_value=client):
        result = service.schedule_recall_bot(
            "https://zoom.us/j/999",
            "Demo",
            settings=service.load_recall_settings(),
            client=client,
        )

    assert result["recall_bot_id"] == "bot-abc"
    assert result["meeting_id"]
    client.create_bot.assert_called_once()


def test_webhook_rejects_invalid_signature():
    example = _load("meeting_agent_recall_app", _ROOT / "app.py")
    client = TestClient(example.app)
    resp = client.post("/webhooks/recall", content="{}", headers={"webhook-id": "x"})
    assert resp.status_code == 401


def test_webhook_accepts_valid_signature_and_queues():
    example = _load("meeting_agent_recall_app2", _ROOT / "app.py")
    verify_mod = _load("recall_verify2", _ROOT / "integrations" / "recall" / "verify.py")
    import hmac
    import hashlib

    body = json.dumps(
        {
            "event": "bot.in_call_recording",
            "data": {"bot": {"id": "b1", "metadata": {"meeting_id": "m1"}}},
        }
    )
    msg_id = "msg_q"
    ts = "1700000002"
    key = base64.b64decode(_SECRET.removeprefix("whsec_"))
    sig = base64.b64encode(
        hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256).digest()
    ).decode()

    client = TestClient(example.app)
    with patch("recall_routes.process_recall_webhook") as proc:
        resp = client.post(
            "/webhooks/recall",
            content=body,
            headers={
                "webhook-id": msg_id,
                "webhook-timestamp": ts,
                "webhook-signature": f"v1,{sig}",
            },
        )
    assert resp.status_code == 200


def test_transcript_download_to_text():
    tx = _load("recall_transcript", _ROOT / "integrations" / "recall" / "transcript.py")
    data = [
        {"speaker": "Alice", "words": [{"text": "Hello"}, {"text": "team"}]},
        {"speaker": "Bob", "text": "Hi there"},
    ]
    text = tx.transcript_download_to_text(data)
    assert "Alice: Hello team" in text
    assert "Bob: Hi there" in text
