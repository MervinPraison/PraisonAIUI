"""Provider resolves agents registered via praisonaiui.register_agent."""

from unittest.mock import MagicMock

import pytest

from praisonaiui.provider import RunEventType
from praisonaiui.providers import PraisonAIProvider
from praisonaiui.server import _agents, register_agent


@pytest.fixture(autouse=True)
def clean_state():
    _agents.clear()
    yield
    _agents.clear()


def test_get_or_create_agent_uses_register_agent():
    mock_agent = MagicMock(name="assistant")
    mock_agent.name = "assistant"
    register_agent("assistant", mock_agent)

    provider = PraisonAIProvider()
    resolved = provider._get_or_create_agent("assistant", "sess-1")

    assert resolved is mock_agent


@pytest.mark.asyncio
async def test_direct_mode_uses_achat_when_available():
    agent = MagicMock()
    agent.name = "assistant"
    agent.stream_emitter = MagicMock()
    agent.stream_emitter.add_callback = MagicMock()
    agent.stream_emitter.enable_metrics = MagicMock()
    agent.stream_emitter.remove_callback = MagicMock()
    agent.stream_emitter.get_metrics = MagicMock(return_value=None)

    achat_calls = []

    async def achat(message, stream=True, **kwargs):
        achat_calls.append({"message": message, "stream": stream, **kwargs})
        return "Hello from achat"

    agent.achat = achat

    provider = PraisonAIProvider(agent=agent)
    events = [
        ev
        async for ev in provider._run_direct_mode("hi", session_id="s1", agent_name=None)
    ]

    assert achat_calls and achat_calls[0]["stream"] is True
    completed = [e for e in events if e.type == RunEventType.RUN_COMPLETED]
    assert completed[-1].content == "Hello from achat"
