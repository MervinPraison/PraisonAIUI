"""Unit tests for Meeting Agent Phase 2 Part B (live transcript + calendar)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_ROOT = Path(__file__).resolve().parents[2] / "examples" / "python" / "meeting-agent"
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def part_b_env(monkeypatch, tmp_path):
    monkeypatch.setenv("RECALL_REGION", "eu-central-1")
    monkeypatch.setenv("RECALL_API_KEY", "test-recall-key")
    monkeypatch.setenv("RECALL_WEBHOOK_VERIFICATION_SECRET", "whsec_test")
    monkeypatch.setenv("RECALL_WORKSPACE_ID", "33a035c7-03c1-4ec9-b752-18cdfbbefc42")
    monkeypatch.setenv("PUBLIC_API_BASE_URL", "https://dev.example.test")
    monkeypatch.setenv("PRAISONAI_MEETINGS_DIR", str(tmp_path))
    monkeypatch.setenv("PRAISONAI_MEETINGS_DB", str(tmp_path / "meetings.db"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")


def test_transcript_data_to_line():
    tx = _load("part_b_transcript", _ROOT / "integrations" / "recall" / "transcript.py")
    payload = {
        "data": {
            "data": {
                "speaker": "Alice",
                "words": [{"text": "Hello"}, {"text": "team"}],
            }
        }
    }
    assert tx.transcript_data_to_line(payload) == "Alice: Hello team"


def test_live_hub_publish_and_snapshot():
    live = _load("part_b_live", _ROOT / "integrations" / "recall" / "live.py")
    live.publish_live_chunk("m-live", line="Alice: Hi", full_text="Alice: Hi", live_status="live")
    snap = live.snapshot_for_api("m-live", {"metadata": {}})
    assert snap["transcript"] == "Alice: Hi"
    assert snap["live_status"] == "live"


def test_create_bot_includes_realtime_config():
    client_mod = _load("part_b_client", _ROOT / "integrations" / "recall" / "client.py")
    config_mod = _load("part_b_config", _ROOT / "integrations" / "recall" / "config.py")
    settings = config_mod.load_recall_settings()
    client = client_mod.RecallClient(settings)
    client._request = MagicMock(return_value={"id": "bot-1"})  # noqa: SLF001

    client.create_bot(
        meeting_url="https://meet.google.com/abc-defg-hij",
        meeting_id="m1",
        title="Standup",
    )
    body = client._request.call_args.kwargs["json_body"]  # noqa: SLF001
    assert "recording_config" in body
    assert body["recording_config"]["realtime_endpoints"][0]["events"] == [
        "transcript.data",
        "transcript.partial_data",
    ]


def test_calendar_eligibility():
    cal = _load("part_b_calendar", _ROOT / "integrations" / "recall" / "calendar_service.py")
    assert cal.is_eligible_for_auto_record(
        {
            "is_deleted": False,
            "meeting_url": "https://zoom.us/j/1",
            "end_time": "2099-01-01T00:00:00+00:00",
        }
    )
    assert not cal.is_eligible_for_auto_record({"is_deleted": True, "meeting_url": "https://zoom.us/j/1"})


def test_transcript_webhook_keys_are_unique_per_utterance():
    store = _load("part_b_store", _ROOT / "integrations" / "recall" / "store.py")
    bot = "bot-1"
    p1 = {
        "data": {
            "bot": {"id": bot},
            "data": {"speaker": "Alice", "words": [{"text": "hello", "start": 1.0, "end": 1.5}]},
        }
    }
    p2 = {
        "data": {
            "bot": {"id": bot},
            "data": {"speaker": "Alice", "words": [{"text": "world", "start": 2.0, "end": 2.5}]},
        }
    }
    k1 = store.webhook_event_key("transcript.data", p1)
    k2 = store.webhook_event_key("transcript.data", p2)
    assert k1 != k2


def test_upsert_live_transcript_replaces_partial():
    processor = _load("part_b_processor2", _ROOT / "integrations" / "recall" / "processor.py")
    with patch("integrations.recall.live.publish_live_chunk") as publish:
        with patch("praisonai_tools.tools.meeting_tools.get_meeting") as get_m:
            get_m.__wrapped__ = MagicMock(
                return_value={"metadata": {"transcript": "Alice: hel"}}
            )
            with patch.object(processor, "_merge_metadata"):
                processor._upsert_live_transcript("m1", "Alice: hello", partial=True)
                assert publish.call_args.kwargs["full_text"] == "Alice: hello"


def test_process_transcript_data_webhook():
    processor = _load("part_b_processor", _ROOT / "integrations" / "recall" / "processor.py")
    config_mod = _load("part_b_config2", _ROOT / "integrations" / "recall" / "config.py")
    settings = config_mod.load_recall_settings()

    with patch.object(processor, "_append_live_transcript") as append:
        processor.process_recall_webhook(
            "transcript.data",
            {
                "data": {
                    "bot": {"id": "b1", "metadata": {"meeting_id": "m1"}},
                    "data": {"speaker": "Bob", "text": "Testing live"},
                }
            },
            settings=settings,
            client=MagicMock(),
        )
    append.assert_called_once()
    assert append.call_args[0][1] == "Bob: Testing live"
