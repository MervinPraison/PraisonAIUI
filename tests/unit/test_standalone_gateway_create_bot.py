"""StandaloneGateway._create_bot takes the call channels.py makes.

``ChannelsFeature._start_channel_bot`` calls
``gw._create_bot(platform, token, agent, bot_config, ch_cfg)`` (the
``WebSocketGateway`` signature). ``StandaloneGateway._create_bot`` used to take
``(platform, config, agent)`` only, so with the in-process gateway the call
raised ``TypeError`` ("takes 4 positional arguments but 6 were given"), was
logged at debug level and silently fell back to the direct import path.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from praisonaiui.features import _standalone_gateway as sg
from praisonaiui.features import channels as channels_mod
from praisonaiui.features.channels import ChannelsFeature


class _FakeBot:
    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def start(self) -> None:
        return None


@pytest.fixture
def fake_factory():
    """Register a bot factory for a fake platform and remove it afterwards."""
    calls: list = []

    def factory(**kwargs):
        calls.append(kwargs)
        return _FakeBot(**kwargs)

    sg.register_bot_factory("fakechat", factory)
    yield calls
    sg._bot_factories.pop("fakechat", None)


def test_gateway_signature_builds_the_bot(fake_factory):
    gw = sg.StandaloneGateway()
    agent = MagicMock(name="agent")
    bot_config = object()

    bot = gw._create_bot(
        "fakechat", "tok-123", agent, bot_config, {"token": "tok-123", "app_token": "xapp"}
    )

    assert isinstance(bot, _FakeBot)
    assert fake_factory == [
        {"agent": agent, "token": "tok-123", "app_token": "xapp", "config": bot_config}
    ]
    assert bot in gw._channel_bots.values()


def test_legacy_three_argument_form_still_works(fake_factory):
    gw = sg.StandaloneGateway()
    agent = MagicMock(name="agent")

    bot = gw._create_bot("fakechat", {"token": "t"}, agent)

    assert isinstance(bot, _FakeBot)
    assert fake_factory == [{"agent": agent, "token": "t"}]


def test_wrong_arity_is_a_clear_type_error():
    with pytest.raises(TypeError, match="_create_bot"):
        sg.StandaloneGateway()._create_bot("fakechat", "only-one")


@pytest.fixture
def _isolate_channel_state():
    saved_channels = dict(channels_mod._channels)
    saved_bots = dict(channels_mod._live_bots)
    channels_mod._live_bots.clear()
    yield
    for entry in channels_mod._live_bots.values():
        entry["task"].cancel()
    channels_mod._channels.clear()
    channels_mod._channels.update(saved_channels)
    channels_mod._live_bots.clear()
    channels_mod._live_bots.update(saved_bots)


@pytest.mark.asyncio
async def test_channels_start_uses_the_standalone_gateway(fake_factory, _isolate_channel_state):
    """End to end: the channel start path builds its bot through the gateway."""
    gw = sg.StandaloneGateway()
    agent = MagicMock(name="agent")
    gw.register_agent(agent, agent_id="assistant")

    # Strategy 1 imports praisonaiagents.bots.BotConfig; stub it so the test
    # does not depend on that package's version.
    fake_bots = types.ModuleType("praisonaiagents.bots")
    fake_bots.BotConfig = lambda token: {"token": token}
    feature = ChannelsFeature()
    entry = {"id": "c1", "platform": "fakechat", "config": {"bot_token": "tok-xyz"}}

    with patch.dict(sys.modules, {"praisonaiagents.bots": fake_bots}), patch.object(
        feature, "_get_gateway", return_value=gw
    ), patch.object(feature, "_create_bot_direct", return_value=None) as direct, patch.object(
        feature, "_attach_chat_bridge"
    ):
        error = await feature._start_channel_bot("c1", entry)

    assert error is None
    direct.assert_not_called()
    assert len(fake_factory) == 1
    assert fake_factory[0]["token"] == "tok-xyz"
    assert fake_factory[0]["agent"] is agent
    assert isinstance(channels_mod._live_bots["c1"]["bot"], _FakeBot)
