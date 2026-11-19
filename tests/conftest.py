"""Shared pytest fixtures for PraisonAIUI tests."""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

import pytest

# Keep every test run out of the developer's real data folders. Without this,
# features that persist state (schedules, channels, sessions, config.yaml,
# traces) read and write ~/.praisonaiui, so a local run changes the developer's
# own data and two runs at once (two worktrees, xdist workers) collide.
# Each pytest process (each xdist worker too) gets its own temporary folder,
# set before any praisonaiui module is imported. PRAISONAI_HOME outranks
# AIUI_DATA_DIR (features/_paths.py), so a value from the shell is cleared.
# AIUI_TESTS_REAL_DATA_DIR=1 opts out for debugging against real data.
# Once per process: pytester's in-process runs import this conftest again, and
# a second folder would swap AIUI_DATA_DIR under modules that already read it.
# The mark carries the pid, so xdist workers (which inherit the controller's
# environment) still each get their own folder.
_DATA_DIR_MARK = "_AIUI_TESTS_DATA_DIR"
if os.environ.get("AIUI_TESTS_REAL_DATA_DIR", "").lower() not in ("1", "true", "yes"):
    _pid, _, _test_data_dir = os.environ.get(_DATA_DIR_MARK, "").partition(":")
    if _pid != str(os.getpid()) or not os.path.isdir(_test_data_dir):
        _test_data_dir = tempfile.mkdtemp(prefix="aiui-tests-")
        os.environ[_DATA_DIR_MARK] = f"{os.getpid()}:{_test_data_dir}"
        atexit.register(shutil.rmtree, _test_data_dir, ignore_errors=True)
    os.environ["AIUI_DATA_DIR"] = _test_data_dir
    os.environ.pop("PRAISONAI_HOME", None)

pytest_plugins = ["pytester"]

_LIVE_ENV_VARS = ("PRAISONAI_LIVE_TESTS", "AIUI_LIVE_LLM")


def _live_tests_enabled() -> bool:
    return any(
        os.environ.get(name, "").lower() in ("1", "true", "yes") for name in _LIVE_ENV_VARS
    )


def pytest_collection_modifyitems(config, items):
    """Keep the default run hermetic: ``live`` tests reach a real LLM provider
    over the network (results depend on the model and the network, and a
    stalled socket hangs the run), so they only run when opted in."""
    if _live_tests_enabled():
        return
    skip_live = pytest.mark.skip(
        reason="live LLM test: set PRAISONAI_LIVE_TESTS=1 (or AIUI_LIVE_LLM=1) to run"
    )
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)

def pytest_addoption(parser):
    parser.addoption(
        "--fail-on-skip",
        action="store_true",
        default=False,
        help=(
            "Exit non-zero when any test is skipped. CI passes it to the suites "
            "that need Node, src/frontend/node_modules and Chromium, so a missing "
            "tool fails the job instead of turning the suite into silent skips."
        ),
    )


def pytest_sessionfinish(session, exitstatus):
    if not session.config.getoption("--fail-on-skip", default=False):
        return
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    skipped = reporter.stats.get("skipped", []) if reporter else []
    if not skipped:
        return
    if reporter:
        reporter.write_sep("=", f"--fail-on-skip: {len(skipped)} test(s) skipped", red=True)
        for rep in skipped:
            reason = rep.longrepr[2] if isinstance(rep.longrepr, tuple) else rep.longrepr
            reporter.write_line(f"SKIPPED {rep.nodeid}: {reason}")
    if exitstatus == 0:
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


# Entry-point plugins installed in the developer's environment must not change
# test results (or add ~90 ms per create_app). Set at import time too, so apps
# built while collecting tests are covered. Tests that exercise discovery
# delete it with monkeypatch.
os.environ.setdefault("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")


@pytest.fixture(autouse=True)
def _clear_auth_env(monkeypatch):
    """Prevent host env auth tokens from breaking unauthenticated test clients."""
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)


@pytest.fixture(autouse=True)
def _isolate_shell_env(monkeypatch):
    """Skip the ``praisonaiui.plugins`` entry-point group in every test, and
    ignore a host ``AIUI_SHELL`` (it would turn style dashboard into app)."""
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    yield
    # `aiui run` sets a process-wide layout default; do not leak it into the
    # next test's create_app().
    from praisonaiui.layouts import set_run_default

    set_run_default(None)


@pytest.fixture(autouse=True)
def _no_social_cards(monkeypatch):
    """Build as if Pillow were absent, so docs-build tests give the same output
    whether or not it is installed (test_og_image.py turns the cards on)."""
    monkeypatch.setattr("praisonaiui.compiler.og_image.available", lambda: False)
