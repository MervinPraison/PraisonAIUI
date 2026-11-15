"""/api/provider/health reports whether the built-in provider has a model key."""

import asyncio

from praisonaiui.providers import PraisonAIProvider, api_key_state


def test_env_key_or_local_base_url_is_set():
    assert api_key_state({"OPENAI_API_KEY": "sk-x"}, runtime_key="") == "set"
    assert api_key_state({"ANTHROPIC_API_KEY": "x"}, runtime_key="") == "set"
    assert api_key_state({"OLLAMA_HOST": "http://localhost:11434"}, runtime_key="") == "set"


def test_blank_env_and_no_saved_key_is_missing():
    assert api_key_state({"OPENAI_API_KEY": "  "}, runtime_key="") == "missing"
    assert api_key_state({}, runtime_key="") == "missing"


def test_a_key_saved_in_settings_is_set():
    assert api_key_state({}, runtime_key="sk-saved") == "set"


def test_health_carries_the_state(monkeypatch):
    for k in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    health = asyncio.run(PraisonAIProvider().health())
    assert health["status"] == "ok"
    assert health["api_key"] == "set"
