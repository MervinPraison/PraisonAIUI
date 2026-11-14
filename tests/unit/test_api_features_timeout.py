"""One slow feature cannot hold ``GET /api/features`` (the Overview page).

Regression: every feature's ``info()`` was awaited without a timeout, so a
third-party feature whose ``info()`` hung kept the whole listing, and the
Overview page with it, waiting. ``/api/health`` already bounded each check.
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

import praisonaiui.server as srv


class _Feature:
    def __init__(self, name, delay=0.0, fail=False):
        self.name, self.delay, self.fail = name, delay, fail

    async def info(self):
        await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        return {"name": self.name, "status": "ok"}


@pytest.mark.asyncio
async def test_slow_feature_times_out_alone(monkeypatch):
    feats = {
        "fast": _Feature("fast"),
        "hung": _Feature("hung", delay=60),
        "broken": _Feature("broken", fail=True),
    }
    monkeypatch.setattr(srv, "get_features", lambda: feats)
    monkeypatch.setattr(srv, "_FEATURE_INFO_TIMEOUT", 0.2)
    started = time.perf_counter()
    res = await srv.api_features(None)
    assert time.perf_counter() - started < 5
    body = json.loads(res.body)
    assert body["count"] == 3
    assert body["features"] == [
        {"name": "fast", "status": "ok"},
        {"name": "hung", "status": "timeout"},
        {"name": "broken", "status": "error"},
    ]
