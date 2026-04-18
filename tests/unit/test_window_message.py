"""Tests for window message feature."""

import asyncio
import json
import pytest
import time
from unittest.mock import AsyncMock, Mock, patch

from praisonaiui.features.window_message import (
    WindowMessageFeature,
    on_window_message,
    register_window_message_hook,
    handle_window_message,
    send_window_message,
    reset_window_message_state,
    _window_message_hooks,
    _message_log,
    _current_session_context,
)


class TestWindowMessageFeature:
    """Test WindowMessageFeature protocol implementation."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    def test_feature_protocol(self):
        """Test that WindowMessageFeature implements BaseFeatureProtocol correctly."""
        feature = WindowMessageFeature()
        
        assert feature.name == "window_message"
        assert feature.description == "Browser window.postMessage communication"
        assert len(feature.routes()) == 4
        assert len(feature.cli_commands()) == 1
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test health check reports correct state."""
        feature = WindowMessageFeature()
        
        # Add some hooks
        @on_window_message("parent")
        async def parent_hook(data):
            pass
        
        @on_window_message()
        async def wildcard_hook(data):
            pass
        
        health = await feature.health()
        
        assert health["status"] == "ok"
        assert health["feature"] == "window_message"
        assert health["total_hooks"] == 2
        assert "parent" in health["hook_sources"]
        assert "*" in health["hook_sources"]
        assert health["message_log_entries"] == 0


class TestWindowMessageHooks:
    """Test window message hook registration and execution."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    def test_hook_registration(self):
        """Test window message hook registration."""
        
        @register_window_message_hook("parent", lambda data: None)
        def parent_hook(data):
            pass
        
        @register_window_message_hook(None, lambda data: None)
        def wildcard_hook(data):
            pass
        
        assert "parent" in _window_message_hooks
        assert "*" in _window_message_hooks
        assert len(_window_message_hooks["parent"]) == 1
        assert len(_window_message_hooks["*"]) == 1
    
    def test_decorator_syntax(self):
        """Test decorator syntax for window message hooks."""
        
        @on_window_message("https://example.com")
        def specific_origin_hook(data):
            pass
        
        @on_window_message()
        def any_origin_hook(data):
            pass
        
        assert "https://example.com" in _window_message_hooks
        assert "*" in _window_message_hooks
        assert len(_window_message_hooks["https://example.com"]) == 1
        assert len(_window_message_hooks["*"]) == 1
    
    @pytest.mark.asyncio
    async def test_message_handling_with_specific_source(self):
        """Test message handling with specific source matching."""
        calls = []
        
        @on_window_message("parent")
        async def parent_hook(data):
            calls.append(("parent", data))
        
        @on_window_message("https://example.com")
        async def example_hook(data):
            calls.append(("example", data))
        
        # Send message from parent
        await handle_window_message({"type": "test", "value": 1}, "parent")
        
        # Send message from example.com
        await handle_window_message({"type": "test", "value": 2}, "https://example.com")
        
        # Send message from unknown source
        await handle_window_message({"type": "test", "value": 3}, "https://other.com")
        
        assert len(calls) == 2
        assert ("parent", {"type": "test", "value": 1}) in calls
        assert ("example", {"type": "test", "value": 2}) in calls
    
    @pytest.mark.asyncio
    async def test_message_handling_with_wildcard(self):
        """Test message handling with wildcard hooks."""
        calls = []
        
        @on_window_message()  # Wildcard
        async def any_hook(data):
            calls.append(data)
        
        # Send messages from different sources
        await handle_window_message({"type": "test1"}, "parent")
        await handle_window_message({"type": "test2"}, "https://example.com")
        await handle_window_message({"type": "test3"}, None)
        
        assert len(calls) == 3
        assert {"type": "test1"} in calls
        assert {"type": "test2"} in calls
        assert {"type": "test3"} in calls
    
    @pytest.mark.asyncio
    async def test_message_handling_with_multiple_hooks(self):
        """Test message handling with multiple matching hooks."""
        calls = []
        
        @on_window_message("parent")
        async def parent_hook1(data):
            calls.append(("parent1", data))
        
        @on_window_message("parent")
        async def parent_hook2(data):
            calls.append(("parent2", data))
        
        @on_window_message()
        async def wildcard_hook(data):
            calls.append(("wildcard", data))
        
        await handle_window_message({"type": "test"}, "parent")
        
        # Should call all matching hooks
        assert len(calls) == 3
        assert ("parent1", {"type": "test"}) in calls
        assert ("parent2", {"type": "test"}) in calls
        assert ("wildcard", {"type": "test"}) in calls
    
    @pytest.mark.asyncio
    async def test_hook_error_handling(self):
        """Test that hook errors don't break message processing."""
        calls = []
        
        @on_window_message("parent")
        async def failing_hook(data):
            calls.append("failing")
            raise RuntimeError("Hook failed")
        
        @on_window_message("parent")
        async def working_hook(data):
            calls.append("working")
        
        # Should not raise exception
        await handle_window_message({"type": "test"}, "parent")
        
        # Both hooks should have been attempted
        assert "failing" in calls
        assert "working" in calls


class TestWindowMessageLogging:
    """Test window message logging functionality."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    @pytest.mark.asyncio
    async def test_inbound_message_logging(self):
        """Test that inbound messages are logged."""
        await handle_window_message({"type": "test"}, "parent")
        
        assert len(_message_log) == 1
        log_entry = _message_log[0]
        assert log_entry["type"] == "window_message_inbound"
        assert log_entry["data"] == {"type": "test"}
        assert log_entry["source"] == "parent"
        assert "timestamp" in log_entry
    
    @pytest.mark.asyncio
    async def test_outbound_message_logging(self):
        """Test that outbound messages are logged."""
        await send_window_message({"type": "response"}, "parent")
        
        assert len(_message_log) == 1
        log_entry = _message_log[0]
        assert log_entry["type"] == "window_message_outbound"
        assert log_entry["data"] == {"type": "response"}
        assert log_entry["target"] == "parent"
        assert "timestamp" in log_entry


class TestWindowMessageSending:
    """Test window message sending functionality."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    @pytest.mark.asyncio
    async def test_send_to_parent(self):
        """Test sending message to parent window."""
        await send_window_message({"type": "hello", "message": "test"})
        
        assert len(_message_log) == 1
        log_entry = _message_log[0]
        assert log_entry["type"] == "window_message_outbound"
        assert log_entry["data"]["type"] == "hello"
        assert log_entry["target"] == "parent"
    
    @pytest.mark.asyncio
    async def test_send_with_custom_target(self):
        """Test sending message with custom target."""
        await send_window_message({"type": "hello"}, "https://example.com")
        
        assert len(_message_log) == 1
        log_entry = _message_log[0]
        assert log_entry["target"] == "https://example.com"
    
    @pytest.mark.asyncio
    async def test_send_with_invalid_target(self):
        """Test sending message with invalid target is rejected."""
        await send_window_message({"type": "hello"}, "invalid-target")
        
        # Message should not be logged if target is invalid
        assert len(_message_log) == 0
    
    @pytest.mark.asyncio
    async def test_send_with_session_context(self):
        """Test sending message with active session context."""
        # Mock session context with SSE queue
        sse_queue = asyncio.Queue()
        
        # Set global session context
        global _current_session_context
        original_context = _current_session_context
        _current_session_context = {"sse_queue": sse_queue}
        
        try:
            await send_window_message({"type": "test"}, "parent")
            
            # Should have queued message for SSE
            assert not sse_queue.empty()
            message = await sse_queue.get()
            assert message["type"] == "window.message"
            assert message["data"]["type"] == "test"
            assert message["target"] == "parent"
        finally:
            _current_session_context = original_context


class TestWindowMessageSecurity:
    """Test window message security features."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    @pytest.mark.asyncio
    async def test_origin_filtering(self):
        """Test that hooks can filter by origin."""
        calls = []
        
        @on_window_message("https://trusted.com")
        async def trusted_hook(data):
            calls.append("trusted")
        
        @on_window_message("https://evil.com")
        async def evil_hook(data):
            calls.append("evil")
        
        # Send from trusted origin
        await handle_window_message({"type": "test"}, "https://trusted.com")
        assert calls == ["trusted"]
        
        calls.clear()
        
        # Send from evil origin
        await handle_window_message({"type": "test"}, "https://evil.com")
        assert calls == ["evil"]
        
        calls.clear()
        
        # Send from unknown origin
        await handle_window_message({"type": "test"}, "https://unknown.com")
        assert calls == []  # No hooks should be called
    
    @pytest.mark.asyncio
    async def test_target_validation_in_send(self):
        """Test target validation in send_window_message."""
        valid_targets = ["parent", "*", "https://example.com", "http://localhost:3000"]
        invalid_targets = ["javascript:alert(1)", "data:text/html", "file:///etc/passwd"]
        
        for target in valid_targets:
            await send_window_message({"type": "test"}, target)
        
        # Should have logged valid messages
        valid_count = len([t for t in valid_targets if t not in ["javascript:alert(1)"]])
        assert len(_message_log) == len(valid_targets)
        
        # Reset log
        _message_log.clear()
        
        for target in invalid_targets:
            await send_window_message({"type": "test"}, target)
        
        # Should not have logged invalid messages
        assert len(_message_log) == 0


class TestWindowMessageIntegration:
    """Integration tests for window message feature."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_window_message_state()
    
    @pytest.mark.asyncio
    async def test_user_context_example(self):
        """Test the user context example from the issue."""
        user_context = {}
        response_sent = {}
        
        @on_window_message("parent")
        async def on_msg(data):
            if data.get("type") == "set_user":
                user_context["email"] = data["email"]
                # Simulate sending response
                response_sent["type"] = "user_set"
                response_sent["ok"] = True
        
        # Simulate receiving user context message
        await handle_window_message({
            "type": "set_user",
            "email": "user@example.com"
        }, "parent")
        
        assert user_context["email"] == "user@example.com"
        assert response_sent["type"] == "user_set"
        assert response_sent["ok"] is True
    
    @pytest.mark.asyncio
    async def test_bidirectional_communication(self):
        """Test bidirectional communication between iframe and parent."""
        received_messages = []
        
        @on_window_message("parent")
        async def handle_parent_message(data):
            received_messages.append(data)
            
            # Send acknowledgment
            await send_window_message({
                "type": "ack",
                "received": data["type"]
            }, "parent")
        
        # Simulate receiving message from parent
        await handle_window_message({
            "type": "config_update",
            "theme": "dark"
        }, "parent")
        
        # Check message was received
        assert len(received_messages) == 1
        assert received_messages[0]["type"] == "config_update"
        assert received_messages[0]["theme"] == "dark"
        
        # Check acknowledgment was sent
        outbound_logs = [log for log in _message_log if log["type"] == "window_message_outbound"]
        assert len(outbound_logs) == 1
        assert outbound_logs[0]["data"]["type"] == "ack"
        assert outbound_logs[0]["data"]["received"] == "config_update"
    
    @pytest.mark.asyncio
    async def test_multiple_iframe_sources(self):
        """Test handling messages from multiple iframe sources."""
        messages_by_source = {}
        
        @on_window_message()
        async def handle_any_message(data):
            source = data.get("source", "unknown")
            if source not in messages_by_source:
                messages_by_source[source] = []
            messages_by_source[source].append(data)
        
        # Simulate messages from different sources
        sources = ["parent", "https://widget1.com", "https://widget2.com"]
        
        for i, source in enumerate(sources):
            await handle_window_message({
                "type": "status",
                "source": source,
                "id": i
            }, source)
        
        # Check all messages were received
        assert len(messages_by_source) == len(sources)
        for source in sources:
            assert source in messages_by_source
            assert len(messages_by_source[source]) == 1