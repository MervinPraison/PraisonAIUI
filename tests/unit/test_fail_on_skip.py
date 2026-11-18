"""``--fail-on-skip`` (tests/conftest.py) turns any skip into a failing exit.

CI's e2e shard 1 runs the suites that need Node 22, src/frontend/node_modules
and Chromium with this flag, so a missing tool fails the job instead of
reporting a row of skips as green.
"""

from __future__ import annotations

from pathlib import Path

import pytest

CONFTEST = Path(__file__).resolve().parents[1] / "conftest.py"

SUITE = """
import pytest

def test_ok():
    assert True

def test_needs_a_tool():
    pytest.skip("node is not installed")
"""


@pytest.fixture
def suite(pytester):
    pytester.makeconftest(CONFTEST.read_text())
    pytester.makepyfile(test_suite=SUITE)
    return pytester


def test_skips_pass_without_the_flag(suite):
    result = suite.runpytest("-p", "no:cacheprovider", "-o", "addopts=")
    result.assert_outcomes(passed=1, skipped=1)
    assert result.ret == 0


def test_skips_fail_with_the_flag(suite):
    result = suite.runpytest("--fail-on-skip", "-p", "no:cacheprovider", "-o", "addopts=")
    result.assert_outcomes(passed=1, skipped=1)
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*--fail-on-skip: 1 test(s) skipped*", "*node is not installed*"])


def test_flag_is_quiet_when_nothing_skips(pytester):
    pytester.makeconftest(CONFTEST.read_text())
    pytester.makepyfile(test_suite="def test_ok():\n    assert True\n")
    result = pytester.runpytest("--fail-on-skip", "-p", "no:cacheprovider", "-o", "addopts=")
    assert result.ret == 0
