"""The default pytest run stays hermetic: tests that call a real LLM carry the
registered ``live`` marker and are skipped unless explicitly opted in."""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    tomllib = None


def _pytest_ini() -> dict:
    if tomllib is None:
        import pytest

        pytest.skip("tomllib needs Python 3.11+")
    data = tomllib.loads((ROOT / "pyproject.toml").read_text())
    return data["tool"]["pytest"]["ini_options"]


def test_live_and_slow_markers_are_registered():
    names = {m.split(":", 1)[0].strip() for m in _pytest_ini()["markers"]}
    assert {"live", "slow"} <= names


def test_tool_call_parity_module_is_marked_live():
    tree = ast.parse((ROOT / "tests/integration/test_tool_call_parity.py").read_text())
    marks = [
        ast.unparse(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in node.targets)
    ]
    assert marks == ["pytest.mark.live"]


def test_live_items_are_skipped_without_opt_in(pytester, monkeypatch):
    monkeypatch.delenv("PRAISONAI_LIVE_TESTS", raising=False)
    monkeypatch.delenv("AIUI_LIVE_LLM", raising=False)
    pytester.makeconftest((ROOT / "tests/conftest.py").read_text())
    pytester.makeini("[pytest]\nmarkers =\n    live: x\n")
    pytester.makepyfile(
        "import pytest\n"
        "@pytest.mark.live\n"
        "def test_net():\n    raise AssertionError('must not run')\n"
        "def test_local():\n    pass\n"
    )
    result = pytester.runpytest("-p", "no:cacheprovider", "-o", "addopts=")
    result.assert_outcomes(passed=1, skipped=1)

    monkeypatch.setenv("AIUI_LIVE_LLM", "1")
    result = pytester.runpytest("-p", "no:cacheprovider", "-o", "addopts=")
    result.assert_outcomes(passed=1, failed=1)
