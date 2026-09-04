"""Meeting ingest pipeline — upload → transcribe → summarize → index.

Uses PraisonAI-Tools meeting tools with lazy imports so the UI app stays
lightweight at import time. Updates meeting metadata in SQLite between steps.
Status lives in meeting metadata (tools layer), not in UI state.
"""

from __future__ import annotations

import json
import logging
import re
from contextlib import closing
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

AUDIO_SUFFIXES = {".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".mpeg", ".mpga"}
_MEETING_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def merge_meeting_metadata(meeting_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge keys into a meeting's metadata blob."""
    from praisonai_tools.tools import meeting_tools as mt

    record = mt.get_meeting.__wrapped__(meeting_id)
    if "error" in record:
        return record
    meta = {**(record.get("metadata") or {}), **patch}
    try:
        with closing(mt._connect()) as conn, conn:
            conn.execute(
                "UPDATE meetings SET metadata = ? WHERE meeting_id = ?",
                (json.dumps(meta, sort_keys=True), meeting_id),
            )
    except Exception as exc:  # noqa: BLE001
        logger.error("merge_meeting_metadata failed: %s", exc)
        return {"error": str(exc)}
    return {"meeting_id": meeting_id, "metadata": meta}


def _pipeline_from_transcribe(
    meeting_id: str,
    file_path: str,
    meeting_title: str,
) -> dict[str, Any]:
    """Shared tail: transcribe → summarize → index for a known meeting_id."""
    from praisonai_tools.tools.meeting_tools import (
        extract_action_items,
        index_meeting,
        summarize_transcript,
        transcribe_file,
    )

    path = Path(file_path)
    if not path.exists():
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": f"File not found: {file_path}"},
        )
        return {"meeting_id": meeting_id, "error": f"File not found: {file_path}"}

    merge_meeting_metadata(
        meeting_id,
        {"status": "transcribing", "file_path": str(path), "error": None},
    )

    transcript_result = transcribe_file.__wrapped__(str(path))
    if "error" in transcript_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": transcript_result["error"]},
        )
        return {"meeting_id": meeting_id, **transcript_result}

    transcript = transcript_result.get("text", "")
    segments = transcript_result.get("segments") or []
    merge_meeting_metadata(
        meeting_id,
        {
            "status": "summarizing",
            "transcript": transcript,
            "segments": segments,
            "duration_seconds": transcript_result.get("duration_seconds"),
            "language": transcript_result.get("language"),
        },
    )

    summary_result = summarize_transcript.__wrapped__(transcript)
    if "error" in summary_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": summary_result["error"]},
        )
        return {"meeting_id": meeting_id, **summary_result}

    actions_result = extract_action_items.__wrapped__(transcript)
    if "error" in actions_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": actions_result["error"]},
        )
        return {"meeting_id": meeting_id, **actions_result}

    merge_meeting_metadata(
        meeting_id,
        {
            "status": "indexing",
            "summary": summary_result.get("summary", ""),
            "decisions": summary_result.get("decisions", []),
            "topics": summary_result.get("topics", []),
            "key_quotes": summary_result.get("key_quotes", []),
            "action_items": actions_result.get("action_items", []),
        },
    )

    index_result = index_meeting.__wrapped__(
        meeting_id,
        transcript=transcript,
        segments=segments,
    )
    if "error" in index_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": index_result["error"]},
        )
        return {"meeting_id": meeting_id, **index_result}

    merge_meeting_metadata(meeting_id, {"status": "ready", "error": None})

    return {
        "meeting_id": meeting_id,
        "status": "ready",
        "title": meeting_title,
        "summary": summary_result.get("summary", ""),
        "action_items": actions_result.get("action_items", []),
        "chunks_indexed": index_result.get("chunks_indexed", 0),
    }


def run_ingest_pipeline(
    file_path: str,
    title: str | None = None,
    *,
    meeting_id: str | None = None,
) -> dict[str, Any]:
    """Run the full Phase 1 pipeline for an audio/video upload."""
    from praisonai_tools.tools.meeting_tools import get_meeting, save_meeting

    path = Path(file_path)
    if not path.exists():
        return {"error": f"File not found: {file_path}"}

    meeting_title = (title or path.stem).strip() or "Untitled meeting"

    if meeting_id:
        record = get_meeting.__wrapped__(meeting_id)
        if "error" in record:
            return record
        if title:
            meeting_title = title
        elif record.get("title"):
            meeting_title = record["title"]
    else:
        saved = save_meeting.__wrapped__(
            title=meeting_title,
            source=str(path),
            metadata={"status": "transcribing", "file_path": str(path)},
        )
        if "error" in saved:
            return saved
        meeting_id = saved["meeting_id"]

    return _pipeline_from_transcribe(meeting_id, str(path), meeting_title)


def run_post_transcript_pipeline(
    meeting_id: str,
    transcript: str,
    *,
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run summarize → index for a Recall (or other) transcript without transcribe step."""
    from praisonai_tools.tools.meeting_tools import (
        extract_action_items,
        get_meeting,
        index_meeting,
        summarize_transcript,
    )

    record = get_meeting.__wrapped__(meeting_id)
    if "error" in record:
        return record

    meeting_title = record.get("title") or "Untitled meeting"
    merge_meeting_metadata(
        meeting_id,
        {
            "status": "summarizing",
            "transcript": transcript,
            "segments": segments or [],
            "source": "recall",
            "live_status": "ready",
            "error": None,
        },
    )

    summary_result = summarize_transcript.__wrapped__(transcript)
    if "error" in summary_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": summary_result["error"]},
        )
        return {"meeting_id": meeting_id, **summary_result}

    actions_result = extract_action_items.__wrapped__(transcript)
    if "error" in actions_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": actions_result["error"]},
        )
        return {"meeting_id": meeting_id, **actions_result}

    merge_meeting_metadata(
        meeting_id,
        {
            "status": "indexing",
            "summary": summary_result.get("summary", ""),
            "decisions": summary_result.get("decisions", []),
            "topics": summary_result.get("topics", []),
            "key_quotes": summary_result.get("key_quotes", []),
            "action_items": actions_result.get("action_items", []),
        },
    )

    index_result = index_meeting.__wrapped__(
        meeting_id,
        transcript=transcript,
        segments=segments or [],
    )
    if "error" in index_result:
        merge_meeting_metadata(
            meeting_id,
            {"status": "failed", "error": index_result["error"]},
        )
        return {"meeting_id": meeting_id, **index_result}

    merge_meeting_metadata(meeting_id, {"status": "ready", "error": None})

    return {
        "meeting_id": meeting_id,
        "status": "ready",
        "title": meeting_title,
        "summary": summary_result.get("summary", ""),
        "action_items": actions_result.get("action_items", []),
        "chunks_indexed": index_result.get("chunks_indexed", 0),
    }


def retry_pipeline(meeting_id: str) -> dict[str, Any]:
    """Re-run ingest for a failed meeting using its stored file path."""
    if not meeting_id or not _MEETING_ID_RE.match(meeting_id):
        return {"error": "invalid meeting_id", "meeting_id": meeting_id}

    from praisonai_tools.tools.meeting_tools import get_meeting

    record = get_meeting.__wrapped__(meeting_id)
    if "error" in record:
        return record

    meta = record.get("metadata") or {}
    file_path = meta.get("file_path") or record.get("source")
    if not file_path:
        return {
            "meeting_id": meeting_id,
            "error": "No uploaded file stored for this meeting",
        }

    return run_ingest_pipeline(
        str(file_path),
        title=record.get("title"),
        meeting_id=meeting_id,
    )
