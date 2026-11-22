"""One notification per new failure.

A failure is keyed by ``target:metric``. The keys failing in the last run are
kept in ``notify-state.json``; only keys that were not failing before produce a
message, so a budget that stays breached is reported once, and again only after
it has recovered and broken a second time.

Slack is used only when ``SLACK_BOT_TOKEN`` and ``SLACK_CHANNEL`` are set (the
pre-QA host has neither, by design: no secrets there). Otherwise the message is
appended to ``notifications.jsonl`` next to the history, which the report shows.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from . import budgets, history


def failing_keys(records: list[dict]) -> dict[str, str]:
    keys = {}
    for rec in records:
        for b in rec.get("breaches", []):
            keys[f"{rec['target']}:{b['metric']}"] = f"{rec['target']}: {budgets.describe(b)}"
        if rec.get("error"):
            keys[f"{rec['target']}:error"] = f"{rec['target']}: tracker error: {rec['error']}"
    return keys


def new_failures(state: dict, records: list[dict]) -> tuple[list[str], dict]:
    """(messages for keys not failing before, the next state)."""
    now = failing_keys(records)
    before = set(state.get("failing", []))
    targets = {r["target"] for r in records}
    # Keys of targets not in this run keep their state.
    kept = {k for k in before if k.split(":", 1)[0] not in targets}
    fresh = [msg for key, msg in now.items() if key not in before]
    return fresh, {"failing": sorted(kept | set(now))}


def _slack(text: str) -> bool:
    token, channel = os.environ.get("SLACK_BOT_TOKEN"), os.environ.get("SLACK_CHANNEL")
    if not token or not channel:
        return False
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps({"channel": channel, "text": text}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return bool(json.load(resp).get("ok"))


def run(history_dir: str | Path, records: list[dict], report_url: str = "") -> list[str]:
    d = Path(history_dir)
    d.mkdir(parents=True, exist_ok=True)
    state_path = d / "notify-state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    fresh, state = new_failures(state, records)
    if fresh:
        sha = ", ".join(sorted({f"{r['target']}@{r.get('sha', '')[:8]}" for r in records}))
        text = f"Pre-QA FAILED ({sha})\n" + "\n".join(f"- {m}" for m in fresh)
        if report_url:
            text += f"\n{report_url}"
        try:
            sent = _slack(text)
        except OSError:
            sent = False
        with open(d / "notifications.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": history.utc_now(), "slack": sent, "text": text}) + "\n")
    state_path.write_text(json.dumps(state), encoding="utf-8")
    return fresh
