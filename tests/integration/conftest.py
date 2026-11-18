"""Keep the integration suites hermetic on a developer machine.

CI runs ``pytest tests/unit tests/integration`` with no provider keys, so no
test reaches a real LLM there. A developer shell usually has keys set, and
then a few feature routes (knowledge listing, for one) call the provider over
the network: slower, and dependent on the network. Clear the keys for every
integration test unless live tests are opted in (``PRAISONAI_LIVE_TESTS=1`` or
``AIUI_LIVE_LLM=1``; see tests/conftest.py), which ``live`` tests need.
"""

from __future__ import annotations

import os

import pytest

PROVIDER_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
)


def _live() -> bool:
    return any(
        os.environ.get(name, "").lower() in ("1", "true", "yes")
        for name in ("PRAISONAI_LIVE_TESTS", "AIUI_LIVE_LLM")
    )


@pytest.fixture(autouse=True)
def _no_provider_keys(monkeypatch):
    if _live():
        return
    for name in PROVIDER_KEYS:
        monkeypatch.delenv(name, raising=False)
