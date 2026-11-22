"""Run history: one JSON object per line, one file per month (``runs-YYYY-MM.jsonl``).

A run record (one per target per tracker run)::

    {"ts": "2026-11-22T10:00:00Z", "run_id": "...", "target": "prod",
     "base": "https://ui.praison.ai", "sha": "4472f5c3...", "status": "PASS",
     "metrics": {...}, "breaches": [...], "pages": {...}, "issues": {...}}
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append(history_dir: str | Path, record: dict) -> Path:
    """Append ``record`` to this month's file (atomic per line on POSIX appends)."""
    d = Path(history_dir)
    d.mkdir(parents=True, exist_ok=True)
    ts = record.get("ts") or utc_now()
    record["ts"] = ts
    path = d / f"runs-{ts[:7]}.jsonl"
    line = json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, line.encode("utf-8"))
    finally:
        os.close(fd)
    return path


def iter_runs(history_dir: str | Path, errors: list | None = None) -> Iterator[dict]:
    """Every run, oldest file first. Bad lines are skipped (and listed in ``errors``)."""
    d = Path(history_dir)
    if not d.is_dir():
        return
    for path in sorted(d.glob("runs-*.jsonl")):
        with open(path, encoding="utf-8", errors="replace") as f:
            for n, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as exc:
                    if errors is not None:
                        errors.append(f"{path.name}:{n}: {exc.msg}")
                    continue
                if not isinstance(rec, dict) or "target" not in rec or "ts" not in rec:
                    if errors is not None:
                        errors.append(f"{path.name}:{n}: not a run record")
                    continue
                yield rec


def load_runs(history_dir: str | Path, errors: list | None = None) -> list[dict]:
    return sorted(iter_runs(history_dir, errors), key=lambda r: r["ts"])


def latest_by_target(runs: list[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for rec in runs:
        if rec["target"] not in latest or rec["ts"] >= latest[rec["target"]]["ts"]:
            latest[rec["target"]] = rec
    return latest
