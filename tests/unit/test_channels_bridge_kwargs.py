"""Regression coverage for issue #287: the channels chat bridge dropped
extra keyword arguments (e.g. ``chat_id``, ``platform``) because the
``_wrapped_chat`` wrapper installed over ``bot._session.chat`` had a fixed
``(agent, user_id, text)`` signature.

When the bot internals invoked the session with per-conversation kwargs the
wrapper raised ``TypeError: _wrapped_chat() got an unexpected keyword
argument 'chat_id'`` and the bot silently failed to reply. The wrapper must
forward any extra positional/keyword arguments untouched to the original
session ``chat`` so memory/session continuity is preserved.
"""

from __future__ import annotations

from typing import Any

import pytest

from praisonaiui.features.channels import ChannelsFeature


class _FakeSession:
    """Minimal session whose ``chat`` records forwarded arguments."""

    def __init__(self) -> None:
        self.received_args: tuple = ()
        self.received_kwargs: dict = {}

    async def chat(self, agent: Any, user_id: str, text: str, *args: Any, **kwargs: Any) -> str:
        self.received_args = args
        self.received_kwargs = dict(kwargs)
        return f"reply to {text}"


class _FakeBot:
    def __init__(self) -> None:
        self._session = _FakeSession()


@pytest.mark.asyncio
async def test_wrapped_chat_forwards_kwargs() -> None:
    feature = ChannelsFeature()
    bot = _FakeBot()

    feature._attach_chat_bridge("chan-1", bot, "telegram")

    # The bridge replaced the session chat with the wrapper.
    assert bot._session.chat.__name__ == "_wrapped_chat"

    reply = await bot._session.chat(
        object(),
        "user-42",
        "Hi",
        chat_id="987654321",
        platform="telegram",
        user_id_meta="987654321",
    )

    assert reply == "reply to Hi"
    assert bot._session.received_kwargs["chat_id"] == "987654321"
    assert bot._session.received_kwargs["platform"] == "telegram"


@pytest.mark.asyncio
async def test_wrapped_chat_forwards_extra_positional_args() -> None:
    feature = ChannelsFeature()
    bot = _FakeBot()

    feature._attach_chat_bridge("chan-2", bot, "slack")

    reply = await bot._session.chat(object(), "user-7", "Hello", "extra")

    assert reply == "reply to Hello"
    assert bot._session.received_args == ("extra",)


@pytest.mark.asyncio
async def test_wrapped_chat_still_works_without_kwargs() -> None:
    """No-kwargs path (web UI / existing callers) must keep working."""
    feature = ChannelsFeature()
    bot = _FakeBot()

    feature._attach_chat_bridge("chan-3", bot, "discord")

    reply = await bot._session.chat(object(), "user-9", "Ping")

    assert reply == "reply to Ping"
    assert bot._session.received_kwargs == {}
