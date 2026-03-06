"""Tests for the chat feature protocol (Gap 1–4).

TDD: These tests define the expected behaviour BEFORE the feature is built.
"""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ── Unit tests for ChatFeature protocol ──────────────────────────────

class TestChatFeatureProtocol:
    """Verify the chat feature meets BaseFeatureProtocol."""

    def test_feature_name(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        assert f.name == "chat"

    def test_feature_description(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        assert "chat" in f.description.lower()

    def test_routes_not_empty(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        routes = f.routes()
        assert len(routes) >= 2  # at minimum: WS + REST send

    def test_route_paths(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        paths = [r.path for r in f.routes()]
        assert "/api/chat/ws" in paths or "/api/chat/send" in paths

    @pytest.mark.asyncio
    async def test_health(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        h = await f.health()
        assert h["status"] == "ok"
        assert h["feature"] == "chat"


# ── Unit tests for ChatMessage model ─────────────────────────────────

class TestChatMessage:
    """Verify the chat message dataclass."""

    def test_chat_message_creation(self):
        from praisonaiui.features.chat import ChatMessage
        msg = ChatMessage(
            role="user",
            content="Hello",
            session_id="s1",
        )
        assert msg.role == "user"
        assert msg.content == "Hello"
        assert msg.session_id == "s1"
        assert msg.message_id  # auto-generated

    def test_chat_message_to_dict(self):
        from praisonaiui.features.chat import ChatMessage
        msg = ChatMessage(role="assistant", content="Hi!", session_id="s1")
        d = msg.to_dict()
        assert d["role"] == "assistant"
        assert d["content"] == "Hi!"
        assert "message_id" in d
        assert "timestamp" in d

    def test_chat_message_agent_name(self):
        from praisonaiui.features.chat import ChatMessage
        msg = ChatMessage(
            role="assistant",
            content="Result",
            session_id="s1",
            agent_name="Researcher",
        )
        assert msg.agent_name == "Researcher"


# ── Unit tests for ChatProtocol ──────────────────────────────────────

class TestChatProtocol:
    """Verify the chat protocol interface."""

    def test_protocol_has_send(self):
        from praisonaiui.features.chat import ChatProtocol
        assert hasattr(ChatProtocol, 'send_message')

    def test_protocol_has_history(self):
        from praisonaiui.features.chat import ChatProtocol
        assert hasattr(ChatProtocol, 'get_history')

    def test_protocol_has_abort(self):
        from praisonaiui.features.chat import ChatProtocol
        assert hasattr(ChatProtocol, 'abort_run')


# ── Unit tests for ChatManager ───────────────────────────────────────

class TestChatManager:
    """Verify the chat manager (default implementation of ChatProtocol)."""

    @pytest.mark.asyncio
    async def test_send_message_returns_message_id(self):
        from praisonaiui.features.chat import ChatManager
        mgr = ChatManager()
        result = await mgr.send_message(
            content="Hello",
            session_id="test-session",
        )
        assert "message_id" in result

    @pytest.mark.asyncio
    async def test_get_history_empty(self):
        from praisonaiui.features.chat import ChatManager
        mgr = ChatManager()
        history = await mgr.get_history("nonexistent")
        assert history == []

    @pytest.mark.asyncio
    async def test_abort_run(self):
        from praisonaiui.features.chat import ChatManager
        mgr = ChatManager()
        # Should not error on non-existent run
        result = await mgr.abort_run("fake-run-id")
        assert result["status"] in ("aborted", "no_active_run")


# ── Integration: Feature registered in auto_register_defaults ────────

class TestAutoRegistration:
    """Verify chat feature is auto-registered."""

    def test_chat_in_features(self):
        from praisonaiui.features import auto_register_defaults, get_features
        auto_register_defaults()
        features = get_features()
        assert "chat" in features

    def test_chat_routes_mounted(self):
        from praisonaiui.features import auto_register_defaults, get_features
        auto_register_defaults()
        chat = get_features()["chat"]
        routes = chat.routes()
        assert len(routes) >= 2
