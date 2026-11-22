"""Percentiles and summaries for lists of timings."""

from __future__ import annotations

import math
from typing import Iterable


def percentile(values: Iterable[float], pct: float) -> float | None:
    """Nearest-rank percentile; ``None`` for no values."""
    data = sorted(v for v in values if v is not None)
    if not data:
        return None
    rank = max(1, math.ceil(pct / 100 * len(data)))
    return data[rank - 1]


def summarize(values: Iterable[float]) -> dict:
    """``{"n", "p50", "p95", "max"}`` for a list of numbers (empty -> n=0 only)."""
    data = [v for v in values if v is not None]
    if not data:
        return {"n": 0}
    return {
        "n": len(data),
        "p50": percentile(data, 50),
        "p95": percentile(data, 95),
        "max": max(data),
    }
