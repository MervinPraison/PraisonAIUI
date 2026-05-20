"""Provider resolves agents registered via praisonaiui.register_agent."""

from unittest.mock import MagicMock

import pytest

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
