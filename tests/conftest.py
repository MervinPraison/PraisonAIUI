"""Shared pytest fixtures for PraisonAIUI tests."""

from __future__ import annotations

import os

import pytest

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
