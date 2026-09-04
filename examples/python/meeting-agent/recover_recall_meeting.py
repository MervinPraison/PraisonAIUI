"""Recover a Recall meeting when webhooks missed (stale tunnel URL).

Usage:
    py -3.13 recover_recall_meeting.py <meeting_id> [bot_id]
"""

from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

_EXAMPLE_DIR = Path(__file__).resolve().parent
if str(_EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE_DIR))


def _load_env() -> None:
    import os

    env_path = _EXAMPLE_DIR / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _duration_seconds(started_at: str | None, completed_at: str | None) -> int | None:
    if not started_at or not completed_at:
        return None
    try:
        fmt = "%Y-%m-%dT%H:%M:%S.%f%z"
        start = datetime.strptime(started_at.replace("Z", "+0000"), fmt)
        end = datetime.strptime(completed_at.replace("Z", "+0000"), fmt)
        return int((end - start).total_seconds())
    except (TypeError, ValueError):
        return None


def recover(meeting_id: str, bot_id: str | None = None) -> dict:
    from integrations.recall.client import RecallClient
    from integrations.recall.config import load_recall_settings
    from integrations.recall.transcript import transcript_download_to_text
    from pipeline import merge_meeting_metadata, run_post_transcript_pipeline
    from praisonai_tools.tools.meeting_tools import get_meeting

    _load_env()
    settings = load_recall_settings()
    client = RecallClient(settings)

    record = get_meeting.__wrapped__(meeting_id)
    if "error" in record:
        raise SystemExit(record["error"])

    meta = record.get("metadata") or {}
    bot_id = bot_id or meta.get("recall_bot_id")
    if not bot_id:
        raise SystemExit("No recall_bot_id — pass bot_id as second argument")

    bot = client.get_bot(str(bot_id))
    recordings = bot.get("recordings") or []
    if not recordings:
        raise SystemExit("Bot has no recordings yet")

    rec_wrap = recordings[0].get("recording") or recordings[0]
    recording_id = rec_wrap.get("id")
    if not recording_id:
        raise SystemExit("Missing recording id on bot")

    duration = _duration_seconds(rec_wrap.get("started_at"), rec_wrap.get("completed_at"))
    merge_meeting_metadata(
        meeting_id,
        {
            "recall_bot_id": bot_id,
            "recall_recording_id": recording_id,
            "live_status": "processing",
            "status": "transcribing",
            **({"duration_seconds": duration} if duration else {}),
        },
    )

    transcript_id = None
    for _ in range(30):
        bot = client.get_bot(str(bot_id))
        recs = bot.get("recordings") or []
        if recs:
            rec = recs[0].get("recording") or recs[0]
            shortcuts = rec.get("media_shortcuts") or {}
            tr = shortcuts.get("transcript")
            if isinstance(tr, dict) and tr.get("id"):
                transcript_id = str(tr["id"])
                break
            artifacts = recs[0].get("transcript_artifacts") or rec.get("transcript_artifacts") or []
            if artifacts:
                transcript_id = str(artifacts[0].get("id") or "")
                if transcript_id:
                    break
        if not transcript_id:
            print("Starting async transcript…")
            client.create_async_transcript(str(recording_id))
            time.sleep(10)
        else:
            break

    if not transcript_id:
        raise SystemExit("Timed out waiting for transcript — webhook may still deliver it")

    artifact = client.get_transcript(transcript_id)
    download_url = (artifact.get("data") or {}).get("download_url")
    if not download_url:
        raise SystemExit("Transcript ready but no download_url")

    raw = client.download_json(download_url)
    text = transcript_download_to_text(raw)
    if not text.strip():
        raise SystemExit("Transcript download was empty")

    result = run_post_transcript_pipeline(meeting_id, text)
    print("Recovered:", result)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: recover_recall_meeting.py <meeting_id> [bot_id]")
    recover(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
