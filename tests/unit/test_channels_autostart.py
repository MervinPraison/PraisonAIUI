"""Tests for channel auto-start lifecycle and running-status correctness.

Regression coverage for issue #167: auto-start raised
``'dict' object has no attribute 'append'`` when the gateway exposed
``_channel_tasks`` as a dict, and reported ``running: true`` despite a
``start_error`` being set.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from praisonaiui.features import channels as channels_mod
from praisonaiui.features.channels import ChannelsFeature


class _FakeBot:
    def __init__(self) -> None:
        self.is_running = False
        self.started = False

    async def start(self) -> None:
        self.started = True


class _GatewayDictTasks:
    def __init__(self) -> None:
        self._channel_bots: dict = {}
        self._channel_tasks: dict = {}
        self._agents: dict = {}


class _GatewayListTasks:
    def __init__(self) -> None:
        self._channel_bots: dict = {}
        self._channel_tasks: list = []
        self._agents: dict = {}


@pytest.fixture(autouse=True)
def _isolate_channel_state():
    saved_channels = dict(channels_mod._channels)
    saved_bots = dict(channels_mod._live_bots)
    saved_flag = ChannelsFeature._auto_started
    channels_mod._channels.clear()
    channels_mod._live_bots.clear()
    ChannelsFeature._auto_started = False
    yield
    channels_mod._channels.clear()
    channels_mod._channels.update(saved_channels)
    channels_mod._live_bots.clear()
    channels_mod._live_bots.update(saved_bots)
    ChannelsFeature._auto_started = saved_flag


@pytest.mark.asyncio
async def test_start_channel_bot_dict_channel_tasks_no_attribute_error():
    feature = ChannelsFeature()
    gw = _GatewayDictTasks()
    bot = _FakeBot()
    entry = {"id": "ch1", "platform": "discord", "config": {"bot_token": "x" * 30}}

    with patch.object(feature, "_get_gateway", return_value=gw), patch.object(
        feature, "_create_bot_direct", return_value=bot
    ), patch.object(feature, "_attach_chat_bridge"):
        error = await feature._start_channel_bot("ch1", entry)

    assert error is None
    assert "ch1" in gw._channel_tasks
    assert gw._channel_bots["ch1"] is bot
    assert entry["running"] is True
    assert "start_error" not in entry


@pytest.mark.asyncio
async def test_start_channel_bot_list_channel_tasks_no_regression():
    feature = ChannelsFeature()
    gw = _GatewayListTasks()
    bot = _FakeBot()
    entry = {"id": "ch2", "platform": "discord", "config": {"bot_token": "x" * 30}}

    with patch.object(feature, "_get_gateway", return_value=gw), patch.object(
        feature, "_create_bot_direct", return_value=bot
    ), patch.object(feature, "_attach_chat_bridge"):
        error = await feature._start_channel_bot("ch2", entry)

    assert error is None
    assert len(gw._channel_tasks) == 1
    assert gw._channel_bots["ch2"] is bot
    assert entry["running"] is True


def test_sync_running_status_start_error_forces_not_running():
    feature = ChannelsFeature()
    channels_mod._channels["chx"] = {
        "id": "chx",
        "platform": "discord",
        "running": True,
        "start_error": "boom",
    }

    with patch.object(feature, "_get_gateway", return_value=None):
        feature._sync_running_status()

    assert channels_mod._channels["chx"]["running"] is False


@pytest.mark.asyncio
async def test_auto_start_runs_once_per_process():
    feature = ChannelsFeature()
    channels_mod._channels["ch3"] = {
        "id": "ch3",
        "platform": "discord",
        "enabled": True,
        "config": {"bot_token": "x" * 30},
    }

    with patch.object(
        feature, "_start_channel_bot", return_value=None
    ) as mock_start:
        await feature._auto_start_enabled_channels()
        await feature._auto_start_enabled_channels()

    assert mock_start.call_count == 1


@pytest.mark.asyncio
async def test_auto_start_skips_disabled_channels():
    feature = ChannelsFeature()
    channels_mod._channels["ch4"] = {
        "id": "ch4",
        "platform": "discord",
        "enabled": False,
        "config": {"bot_token": "x" * 30},
    }

    with patch.object(
        feature, "_start_channel_bot", return_value=None
    ) as mock_start:
        await feature._auto_start_enabled_channels()

    assert mock_start.call_count == 0


@pytest.mark.asyncio
async def test_auto_start_failure_sets_not_running_and_error():
    feature = ChannelsFeature()
    entry = {
        "id": "ch5",
        "platform": "discord",
        "enabled": True,
        "running": True,
        "config": {"bot_token": "x" * 30},
    }
    channels_mod._channels["ch5"] = entry

    async def _boom(channel_id, e):
        raise AttributeError("'dict' object has no attribute 'append'")

    with patch.object(feature, "_start_channel_bot", side_effect=_boom):
        await feature._auto_start_enabled_channels()

    assert entry["running"] is False
    assert "start_error" in entry
