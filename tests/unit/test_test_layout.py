"""Every test file lives where CI runs it.

CI runs ``pytest tests/unit tests/integration``. A ``tests/test_*.py`` file
outside those folders never gates a merge, which is how 17 top-level files
rotted (scripts with no test functions, fixtures that did not exist, stale
assertions) while looking like coverage.
"""

from __future__ import annotations

from pathlib import Path

TESTS = Path(__file__).resolve().parents[1]


def test_no_test_files_outside_unit_and_integration():
    stray = sorted(
        p.relative_to(TESTS).as_posix()
        for p in TESTS.rglob("test_*.py")
        if p.relative_to(TESTS).parts[0] not in ("unit", "integration", "browser")
    )
    assert stray == [], f"move these into tests/unit or tests/integration: {stray}"
