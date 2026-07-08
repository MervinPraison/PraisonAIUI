"""Tests for channel secret redaction in API responses.

Regression coverage for issue #176 (recurrence of #58): ``GET /api/channels``
and related handlers serialized the in-memory ``_channels`` dict verbatim,
exposing ``config.bot_token`` and other secrets in the browser Network panel
without authentication. Read handlers must redact secrets while the write path
still accepts and uses the real token for bot startup.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from praisonaiui.features import channels as channels_mod
from praisonaiui.features.channels import (
    ChannelsFeature,
    _redact_config_secrets,
    _validate_config_security,
)

_DISCORD_TOKEN = "MTQ" + "a1b2c3d4e5f6g7h8i9j0k1l2"


class _Req:
    def __init__(self, path_params=None, body=None):
        self.path_params = path_params or {}
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _isolate_channel_state():
    saved_channels = dict(channels_mod._channels)
    saved_bots = dict(channels_mod._live_bots)
    saved_flag = ChannelsFeature._auto_started
    channels_mod._channels.clear()
    channels_mod._live_bots.clear()
    ChannelsFeature._auto_started = True
    yield
    channels_mod._channels.clear()
    channels_mod._channels.update(saved_channels)
    channels_mod._live_bots.clear()
    channels_mod._live_bots.update(saved_bots)
    ChannelsFeature._auto_started = saved_flag


def _seed_channel():
    entry = {
        "id": "e4a6d6e1d0cf",
        "name": "DhivyaBot",
        "platform": "discord",
        "enabled": True,
        "running": True,
        "config": {"bot_token": _DISCORD_TOKEN},
    }
    channels_mod._channels[entry["id"]] = entry
    return entry


def _body(resp):
    return json.loads(resp.body)


# ── Redaction helper ─────────────────────────────────────────────────


def test_redact_covers_suffix_secret_keys():
    out = _redact_config_secrets(
        {
            "bot_token": _DISCORD_TOKEN,
            "app_token": "xapp-1-abc",
            "signing_secret": "shh",
            "client_secret": "shh2",
            "api_key": "k",
            "webhook_url": "https://example.com/hook",
        }
    )
    assert out["bot_token"] == "***REDACTED***"
    assert out["app_token"] == "***REDACTED***"
    assert out["signing_secret"] == "***REDACTED***"
    assert out["client_secret"] == "***REDACTED***"
    assert out["api_key"] == "***REDACTED***"
    assert out["webhook_url"] == "https://example.com/hook"
    assert out["bot_token_set"] is True
    assert out["app_token_set"] is True


def test_redact_preserves_env_references():
    out = _redact_config_secrets({"bot_token": "env:DISCORD_BOT_TOKEN"})
    assert out["bot_token"] == "env:DISCORD_BOT_TOKEN"
    assert "bot_token_set" not in out


def test_redact_is_non_mutating():
    original = {"bot_token": _DISCORD_TOKEN}
    _redact_config_secrets(original)
    assert original["bot_token"] == _DISCORD_TOKEN


# ── Write path rejects inline secrets on suffix keys ─────────────────


def test_validate_rejects_inline_suffix_secret():
    err = _validate_config_security({"app_token": "xapp-1-" + "a" * 30})
    assert err is not None
    assert "app_token" in err


def test_validate_allows_env_reference_suffix_key():
    assert _validate_config_security({"signing_secret": "env:SLACK_SIGNING_SECRET"}) is None


# ── Read handlers must not leak ──────────────────────────────────────


@pytest.mark.asyncio
async def test_list_redacts_bot_token():
    _seed_channel()
    feature = ChannelsFeature()
    with patch.object(feature, "_sync_running_status"):
        resp = await feature._list(_Req())
    body = _body(resp)
    assert _DISCORD_TOKEN not in json.dumps(body)
    cfg = body["channels"][0]["config"]
    assert cfg["bot_token"] == "***REDACTED***"
    assert cfg["bot_token_set"] is True


@pytest.mark.asyncio
async def test_get_redacts_bot_token():
    entry = _seed_channel()
    feature = ChannelsFeature()
    with patch.object(feature, "_sync_running_status"):
        resp = await feature._get(_Req(path_params={"channel_id": entry["id"]}))
    body = _body(resp)
    assert _DISCORD_TOKEN not in json.dumps(body)
    assert body["config"]["bot_token"] == "***REDACTED***"


@pytest.mark.asyncio
async def test_add_response_redacts_bot_token():
    feature = ChannelsFeature()
    req = _Req(
        body={
            "id": "newch",
            "name": "New",
            "platform": "discord",
            "config": {"bot_token": "env:DISCORD_BOT_TOKEN"},
        }
    )
    with patch.object(feature, "_start_channel_bot", return_value=None), patch.object(
        feature, "_sync_running_status"
    ), patch.object(channels_mod, "_persist_channels"):
        resp = await feature._add(req)
    body = _body(resp)
    assert resp.status_code == 201
    assert _DISCORD_TOKEN not in json.dumps(body)
    assert body["config"]["bot_token"] == "env:DISCORD_BOT_TOKEN"


@pytest.mark.asyncio
async def test_update_response_redacts_bot_token():
    entry = _seed_channel()
    feature = ChannelsFeature()
    req = _Req(
        path_params={"channel_id": entry["id"]},
        body={"name": "Renamed"},
    )
    with patch.object(channels_mod, "_persist_channels"):
        resp = await feature._update(req)
    body = _body(resp)
    assert body["name"] == "Renamed"
    assert _DISCORD_TOKEN not in json.dumps(body)
    assert body["config"]["bot_token"] == "***REDACTED***"


@pytest.mark.asyncio
async def test_toggle_response_redacts_bot_token():
    entry = _seed_channel()
    feature = ChannelsFeature()
    req = _Req(path_params={"channel_id": entry["id"]})
    with patch.object(feature, "_stop_channel_bot", return_value=None):
        resp = await feature._toggle(req)
    body = _body(resp)
    assert _DISCORD_TOKEN not in json.dumps(body)
    assert body["config"]["bot_token"] == "***REDACTED***"


# ── Write path must keep the real secret internally ──────────────────


@pytest.mark.asyncio
async def test_internal_store_retains_real_token_after_read():
    entry = _seed_channel()
    feature = ChannelsFeature()
    with patch.object(feature, "_sync_running_status"):
        await feature._list(_Req())
    assert channels_mod._channels[entry["id"]]["config"]["bot_token"] == _DISCORD_TOKEN


@pytest.mark.asyncio
async def test_start_channel_bot_reads_unredacted_token():
    entry = _seed_channel()
    feature = ChannelsFeature()

    captured: dict = {}

    def _fake_direct(platform, token, agent, config):
        captured["token"] = token
        return None

    with patch.object(feature, "_get_gateway", return_value=None), patch.object(
        feature, "_create_bot_direct", side_effect=_fake_direct
    ):
        await feature._start_channel_bot(entry["id"], entry)

    assert captured["token"] == _DISCORD_TOKEN
