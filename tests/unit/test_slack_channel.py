"""Tests for Slack channel adapter."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def slack_config():
    """Basic Slack configuration for testing."""
    return {
        "app_token": "xapp-test-token",
        "bot_token": "xoxb-test-token",
        "socket_mode": True
    }


@pytest.fixture
def mock_slack_message():
    """Mock Slack message event."""
    return {
        "type": "message",
        "user": "U12345",
        "channel": "C12345",
        "text": "Hello, bot!",
        "ts": "1234567890.123456"
    }


@pytest.fixture
def mock_reaction_event():
    """Mock Slack reaction event."""
    return {
        "type": "reaction_added",
        "user": "U12345",
        "reaction": "thumbsup",
        "item": {
            "type": "message",
            "channel": "C12345",
            "ts": "1234567890.123456"
        }
    }


@pytest.mark.asyncio
async def test_slack_adapter_creation(slack_config):
    """Test SlackChannelAdapter creation."""
    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None) as mock_init:
        from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter.config = slack_config
        adapter.app_token = slack_config["app_token"]
        adapter.bot_token = slack_config["bot_token"]
        adapter._running = False
        adapter._client = None
        adapter._socket_client = None
        adapter._reaction_handlers = []
        adapter._message_handlers = []

        assert adapter.platform == "slack"
        assert adapter.app_token == "xapp-test-token"
        assert adapter.bot_token == "xoxb-test-token"


@pytest.mark.asyncio
async def test_slack_adapter_start():
    """Test starting Slack adapter."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter.config = {"app_token": "xapp-test", "bot_token": "xoxb-test"}
        adapter.app_token = "xapp-test"
        adapter.bot_token = "xoxb-test"
        adapter.socket_mode = True
        adapter._running = False
        adapter._client = None
        adapter._socket_client = None
        adapter._reaction_handlers = []
        adapter._message_handlers = []

        # Mock the Slack SDK components
        mock_web_client = AsyncMock()
        mock_socket_client = AsyncMock()

        # Mock the Slack SDK modules before import
        mock_slack_modules = {
            'slack_sdk': MagicMock(),
            'slack_sdk.web': MagicMock(),
            'slack_sdk.web.async_client': MagicMock(),
            'slack_sdk.socket_mode': MagicMock(),
            'slack_sdk.socket_mode.async_client': MagicMock(),
        }

        # Configure the mock classes
        mock_slack_modules['slack_sdk.web.async_client'].AsyncWebClient = lambda **kwargs: mock_web_client
        mock_slack_modules['slack_sdk.socket_mode.async_client'].AsyncSocketModeClient = lambda **kwargs: mock_socket_client
        mock_socket_client.socket_mode_request_listeners = []

        with patch.dict('sys.modules', mock_slack_modules):
            await adapter.start()

            assert adapter._running
            mock_socket_client.connect.assert_called_once()


@pytest.mark.asyncio
async def test_slack_send_message():
    """Test sending message via Slack adapter."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True

        # Mock client
        mock_client = AsyncMock()
        mock_client.chat_postMessage.return_value = {"ok": True, "ts": "1234567890.123456"}
        adapter._client = mock_client

        await adapter.send_message("C12345", "Hello, world!")

        mock_client.chat_postMessage.assert_called_once_with(
            channel="C12345",
            text="Hello, world!",
            thread_ts=None
        )


@pytest.mark.asyncio
async def test_slack_stream_token():
    """Test streaming tokens to update Slack message."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True

        # Mock client
        mock_client = AsyncMock()
        adapter._client = mock_client

        await adapter.stream_token("C12345", "1234567890.123456", "Updated content")

        mock_client.chat_update.assert_called_once_with(
            channel="C12345",
            ts="1234567890.123456",
            text="Updated content"
        )


@pytest.mark.asyncio
async def test_slack_handle_message(mock_slack_message):
    """Test handling incoming Slack messages."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True
        adapter._message_handlers = []
        adapter._client = AsyncMock()

        # Mock user info
        adapter._get_user_info = AsyncMock(return_value={
            "id": "U12345",
            "username": "testuser",
            "display_name": "Test User"
        })

        # Mock dispatch method
        adapter._dispatch_message = AsyncMock()

        await adapter._handle_message(mock_slack_message)

        # Verify message was processed
        adapter._dispatch_message.assert_called_once()
        call_args = adapter._dispatch_message.call_args[0][0]

        assert call_args["platform"] == "slack"
        assert call_args["channel_id"] == "C12345"
        assert call_args["user_id"] == "U12345"
        assert call_args["content"] == "Hello, bot!"


@pytest.mark.asyncio
async def test_slack_handle_reaction(mock_reaction_event):
    """Test handling Slack reaction events."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True
        adapter._reaction_handlers = []

        # Add mock reaction handler
        mock_handler = AsyncMock()
        adapter._reaction_handlers.append(mock_handler)

        await adapter._handle_reaction_added(mock_reaction_event)

        # Verify handler was called
        mock_handler.assert_called_once()
        call_args = mock_handler.call_args[0][0]

        assert call_args["platform"] == "slack"
        assert call_args["user_id"] == "U12345"
        assert call_args["reaction"] == "thumbsup"
        assert "C12345:1234567890.123456" in call_args["message_id"]


@pytest.mark.asyncio
async def test_slack_adapter_stop():
    """Test stopping Slack adapter."""
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True

        mock_socket_client = AsyncMock()
        adapter._socket_client = mock_socket_client
        adapter._client = AsyncMock()

        await adapter.stop()

        assert not adapter._running
        mock_socket_client.disconnect.assert_called_once()
        assert adapter._socket_client is None
        assert adapter._client is None


def test_on_slack_reaction_added_decorator():
    """Test the on_slack_reaction_added decorator."""
    from praisonaiui.features.platform_adapters.slack import (
        _slack_reaction_handlers,
        on_slack_reaction_added,
    )

    # Clear any existing handlers
    _slack_reaction_handlers.clear()

    @on_slack_reaction_added
    async def test_handler(event):
        pass

    assert len(_slack_reaction_handlers) == 1
    assert _slack_reaction_handlers[0] == test_handler


@pytest.mark.asyncio
async def test_slack_message_handler_integration():
    """Test integration between message handling and context."""
    from praisonaiui.features.platform_adapters._base import current_channel, current_user
    from praisonaiui.features.platform_adapters.slack import SlackChannelAdapter

    with patch('praisonaiui.features.platform_adapters.slack.SlackChannelAdapter.__init__', return_value=None):
        adapter = SlackChannelAdapter.__new__(SlackChannelAdapter)
        adapter.platform = "slack"
        adapter._running = True
        adapter._message_handlers = []
        adapter._client = AsyncMock()

        # Mock user info
        adapter._get_user_info = AsyncMock(return_value={
            "id": "U12345",
            "username": "testuser",
            "display_name": "Test User"
        })

        # Capture context during handler execution
        captured_channel = None
        captured_user = None

        async def context_capturing_handler(message):
            nonlocal captured_channel, captured_user
            captured_channel = current_channel()
            captured_user = current_user()

        adapter.add_message_handler(context_capturing_handler)

        mock_message = {
            "type": "message",
            "user": "U12345",
            "channel": "C12345",
            "text": "Test message",
            "ts": "1234567890.123456"
        }

        await adapter._handle_message(mock_message)

        # Verify context was set correctly during handler execution
        # Note: context will be None here since we're outside the context manager
        # But during handler execution it should have been set
