"""Field load telemetry for the dashboard, when there is any (stdlib only).

Readers' pages send ``aiui:docs-load`` problems and sampled timings to ``aiui serve`` when a site
sets ``content.docs.telemetry`` (src/praisonaiui/docs_telemetry.py); they land in a JSONL file.
The report reads the files named by ``PREQA_TELEMETRY`` (``os.pathsep``-separated), else
``<PREQA_HOME>/telemetry.jsonl`` and the aiui default store, and summarises the last days.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .stats import summarize

OK = ("ok", "inline")


def default_paths(home: str | Path | None = None) -> list[Path]:
    env = os.environ.get("PREQA_TELEMETRY")
    if env:
        return [Path(p) for p in env.split(os.pathsep) if p]
    home = Path(home or os.environ.get("PREQA_HOME", Path.home() / "preqa"))
    # Where aiui serve writes (docs_telemetry.store_path): $PRAISONAI_HOME, else $AIUI_DATA_DIR, else ~/.praisonaiui.
    data = next((os.environ[v].strip() for v in ("PRAISONAI_HOME", "AIUI_DATA_DIR") if os.environ.get(v, "").strip()), "")
    aiui = Path(data).expanduser() if data else Path.home() / ".praisonaiui"
    return [home / "telemetry.jsonl", aiui / "docs-telemetry" / "telemetry.jsonl"]


def summary(paths: list[Path], days: int = 7, now: datetime | None = None) -> dict | None:
    """``None`` when no file exists; else counts, per-file rows (most problems first) and recent problems."""
    found = [p for p in paths if p.is_file()]
    if not found:
        return None
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    records: list[dict] = []
    for p in found:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                rec = json.loads(line)
                if datetime.fromisoformat(rec["created_at"]) >= cutoff:
                    records.append(rec)
            except (ValueError, KeyError, TypeError):
                continue
    rows: dict[str, dict] = {}
    for r in records:
        row = rows.setdefault(str(r.get("url")), {"url": str(r.get("url")), "records": 0, "problems": 0, "reasons": {}, "ms": []})
        row["records"] += 1
        if r.get("outcome") not in OK:
            row["problems"] += 1
            key = r.get("reason") or r.get("outcome")
            row["reasons"][key] = row["reasons"].get(key, 0) + 1
        if r.get("outcome") in ("ok", "retry", "failed") and isinstance(r.get("ms"), (int, float)):
            row["ms"].append(r["ms"])
    by_url = [{**{k: v for k, v in row.items() if k != "ms"}, "ms": summarize(row["ms"]) if row["ms"] else None}
              for row in rows.values()]
    by_url.sort(key=lambda r: (-r["problems"], -r["records"], r["url"]))
    problems = [r for r in records if r.get("outcome") not in OK]
    problems.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return {
        "days": days, "files": [str(p) for p in found], "records": len(records), "problems": len(problems),
        "by_url": by_url[:25], "recent": problems[:100],
    }
