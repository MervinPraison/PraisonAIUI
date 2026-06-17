"""Shared pytest fixtures for PraisonAIUI tests."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _clear_auth_env(monkeypatch):
    """Prevent host env auth tokens from breaking unauthenticated test clients."""
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)
