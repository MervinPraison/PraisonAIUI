"""Convert Recall transcript download payloads to plain text."""

from __future__ import annotations

from typing import Any


def transcript_data_to_line(payload: dict[str, Any]) -> str:
    """Flatten a verified ``transcript.data`` webhook payload to one line."""
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return ""

    inner = data.get("data") or data
    if not isinstance(inner, dict):
        return ""

    words = inner.get("words")
    if isinstance(words, list) and words:
        text = " ".join(
            w.get("text", "") for w in words if isinstance(w, dict)
        ).strip()
    else:
        text = str(inner.get("text") or "").strip()

    if not text:
        return ""

    speaker = inner.get("speaker") or inner.get("speaker_name")
    participant = inner.get("participant")
    if not speaker and isinstance(participant, dict):
        speaker = participant.get("name")
    return f"{speaker}: {text}" if speaker else text


def transcript_download_to_text(data: Any) -> str:
    """Flatten Recall transcript JSON into a readable multi-line string."""
    if isinstance(data, str):
        return data.strip()
    if not isinstance(data, list):
        return str(data)

    lines: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        speaker = item.get("speaker") or item.get("speaker_name")
        participant = item.get("participant")
        if not speaker and isinstance(participant, dict):
            speaker = participant.get("name")
        words = item.get("words")
        if isinstance(words, list) and words:
            text = " ".join(
                w.get("text", "") for w in words if isinstance(w, dict)
            ).strip()
        else:
            text = str(item.get("text") or "").strip()
        if not text:
            continue
        prefix = f"{speaker}: " if speaker else ""
        lines.append(f"{prefix}{text}")
    return "\n".join(lines)
