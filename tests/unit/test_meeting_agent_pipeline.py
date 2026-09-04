"""Tests for meeting-agent ingest pipeline (mocked OpenAI / Chroma)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_PIPELINE = (
    Path(__file__).resolve().parents[2]
    / "examples"
    / "python"
    / "meeting-agent"
    / "pipeline.py"
)
_spec = importlib.util.spec_from_file_location("meeting_pipeline", _PIPELINE)
_pipeline = importlib.util.module_from_spec(_spec)
sys.modules["meeting_pipeline"] = _pipeline
_spec.loader.exec_module(_pipeline)

merge_meeting_metadata = _pipeline.merge_meeting_metadata
run_ingest_pipeline = _pipeline.run_ingest_pipeline
retry_pipeline = _pipeline.retry_pipeline


@pytest.fixture(autouse=True)
def _isolated_meetings(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_MEETINGS_DIR", str(tmp_path))
    monkeypatch.setenv("PRAISONAI_MEETINGS_DB", str(tmp_path / "meetings.db"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")


def test_pipeline_happy_path(tmp_path):
    audio = tmp_path / "standup.mp3"
    audio.write_bytes(b"fake-audio")

    transcript = {
        "text": "Alice: ship billing fix. Bob: will audit retries.",
        "segments": [{"start": 0.0, "end": 3.0, "text": "Alice: ship billing fix."}],
        "duration_seconds": 3.0,
        "language": "en",
    }
    summary = {
        "summary": "Team agreed to fix billing.",
        "decisions": ["Fix billing"],
        "topics": ["billing"],
        "key_quotes": [],
    }
    actions = {
        "action_items": [
            {
                "description": "Audit retries",
                "owner": "Bob",
                "due_date": "2026-09-10",
                "priority": "high",
            }
        ]
    }

    with patch(
        "praisonai_tools.tools.meeting_tools.transcribe_file.__wrapped__",
        return_value=transcript,
    ), patch(
        "praisonai_tools.tools.meeting_tools.summarize_transcript.__wrapped__",
        return_value=summary,
    ), patch(
        "praisonai_tools.tools.meeting_tools.extract_action_items.__wrapped__",
        return_value=actions,
    ), patch(
        "praisonai_tools.tools.meeting_tools.index_meeting.__wrapped__",
        return_value={"chunks_indexed": 2},
    ):
        result = run_ingest_pipeline(str(audio), title="Standup")

    assert result["status"] == "ready"
    assert result["title"] == "Standup"
    assert result["chunks_indexed"] == 2

    from praisonai_tools.tools import meeting_tools as mt

    record = mt.get_meeting.__wrapped__(result["meeting_id"])
    assert record["metadata"]["status"] == "ready"
    assert "billing" in record["metadata"]["summary"]


def test_pipeline_transcribe_failure(tmp_path):
    audio = tmp_path / "bad.mp3"
    audio.write_bytes(b"x")

    with patch(
        "praisonai_tools.tools.meeting_tools.transcribe_file.__wrapped__",
        return_value={"error": "No speech detected in recording"},
    ):
        result = run_ingest_pipeline(str(audio))

    assert "error" in result
    assert "meeting_id" in result

    from praisonai_tools.tools import meeting_tools as mt

    record = mt.get_meeting.__wrapped__(result["meeting_id"])
    assert record["metadata"]["status"] == "failed"


def test_merge_meeting_metadata_missing():
    assert "error" in merge_meeting_metadata("missing-id", {"status": "ready"})


def test_retry_pipeline_reuses_meeting(tmp_path):
    audio = tmp_path / "retry.mp3"
    audio.write_bytes(b"fake-audio")

    from praisonai_tools.tools.meeting_tools import save_meeting

    saved = save_meeting.__wrapped__(
        title="Retry me",
        source=str(audio),
        metadata={"status": "failed", "file_path": str(audio), "error": "timeout"},
    )
    meeting_id = saved["meeting_id"]

    transcript = {"text": "hello", "segments": [], "duration_seconds": 1.0, "language": "en"}
    summary = {"summary": "Hi", "decisions": [], "topics": [], "key_quotes": []}
    actions = {"action_items": []}

    with patch(
        "praisonai_tools.tools.meeting_tools.transcribe_file.__wrapped__",
        return_value=transcript,
    ), patch(
        "praisonai_tools.tools.meeting_tools.summarize_transcript.__wrapped__",
        return_value=summary,
    ), patch(
        "praisonai_tools.tools.meeting_tools.extract_action_items.__wrapped__",
        return_value=actions,
    ), patch(
        "praisonai_tools.tools.meeting_tools.index_meeting.__wrapped__",
        return_value={"chunks_indexed": 1},
    ):
        result = retry_pipeline(meeting_id)

    assert result["status"] == "ready"
    assert result["meeting_id"] == meeting_id
