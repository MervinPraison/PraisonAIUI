"""Live E2E for PraisonAI v4.8.2 — copy of standard SDK harness."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HARNESS_PATH = ROOT / "e2e-audit-logs" / "praisonai-live-sdk-e2e-20260825.py"
spec = importlib.util.spec_from_file_location("live_harness", HARNESS_PATH)
harness = importlib.util.module_from_spec(spec)
sys.modules["live_harness"] = harness
assert spec.loader
spec.loader.exec_module(harness)

if __name__ == "__main__":
    harness.OUT = Path(__file__).with_name("live-sdk-v482.results.json")
    harness.main()