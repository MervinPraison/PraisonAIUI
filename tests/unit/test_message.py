"""Unit tests for message.py - Chainlit-style Message API."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestMessage:
    """Tests for Message class."""

    def test_message_creation_defaults(self):
        """Test Message creation with default values."""
        from praisonaiui.message import Message

        msg = Message()
        assert msg.content == ""
        assert msg.author == "assistant"
        assert msg.streaming is False
        assert msg.elements == []
        assert msg.actions == []
        assert msg.metadata == {}
        assert msg._sent is False

    def test_message_creation_with_content(self):
        """Test Message creation with content."""
        from praisonaiui.message import Message

        msg = Message(content="Hello world", author="bot")
        assert msg.content == "Hello world"
        assert msg.author == "bot"

    def test_message_id_is_unique(self):
        """Test that each Message gets a unique ID."""
        from praisonaiui.message import Message

        msg1 = Message(content="First")
        msg2 = Message(content="Second")
        assert msg1.id != msg2.id
        assert len(msg1.id) == 36  # UUID format

    def test_add_element(self):
        """Test adding elements to a message."""
        from praisonaiui.message import Message

        msg = Message(content="Here's an image:")
        result = msg.add_element("image", url="https://example.com/img.png", alt="Example")

        assert result is msg  # Returns self for chaining
        assert len(msg.elements) == 1
        assert msg.elements[0]["type"] == "image"
        assert msg.elements[0]["url"] == "https://example.com/img.png"
        assert msg.elements[0]["alt"] == "Example"

    def test_add_element_chaining(self):
        """Test chaining multiple add_element calls."""
        from praisonaiui.message import Message

        msg = Message(content="Multiple elements:")
        msg.add_element("image", url="img1.png").add_element("file", url="doc.pdf")

        assert len(msg.elements) == 2
        assert msg.elements[0]["type"] == "image"
        assert msg.elements[1]["type"] == "file"

    def test_add_action(self):
        """Test adding action buttons to a message."""
        from praisonaiui.message import Message

        msg = Message(content="Choose an option:")
        result = msg.add_action("confirm", "Confirm", icon="✓")

        assert result is msg  # Returns self for chaining
        assert len(msg.actions) == 1
        assert msg.actions[0]["name"] == "confirm"
        assert msg.actions[0]["label"] == "Confirm"
        assert msg.actions[0]["icon"] == "✓"

    def test_add_action_chaining(self):
        """Test chaining multiple add_action calls."""
        from praisonaiui.message import Message

        msg = Message(content="Actions:")
        msg.add_action("yes", "Yes").add_action("no", "No")

        assert len(msg.actions) == 2
        assert msg.actions[0]["name"] == "yes"
        assert msg.actions[1]["name"] == "no"

    @pytest.mark.asyncio
    async def test_send_without_context(self):
        """Test send() returns self when no context available."""
        from praisonaiui.message import Message

        with patch("praisonaiui.callbacks._get_context", return_value=None):
            msg = Message(content="Test")
            msg._context = None
            result = await msg.send()
            assert result is msg

    @pytest.mark.asyncio
    async def test_send_non_streaming(self):
        """Test send() for non-streaming message."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="Hello", author="bot")
            msg._context = mock_context
            await msg.send()

            event = await queue.get()
            assert event["type"] == "message"
            assert event["content"] == "Hello"
            assert event["author"] == "bot"
            assert msg._sent is True

    @pytest.mark.asyncio
    async def test_send_streaming_first_call(self):
        """Test send() for streaming message - first call shows typing."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="", streaming=True)
            msg._context = mock_context
            await msg.send()

            event = await queue.get()
            assert event["type"] == "run_started"
            assert msg._sent is True

    @pytest.mark.asyncio
    async def test_stream_token(self):
        """Test stream_token() adds tokens to accumulated content."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="", streaming=True)
            msg._context = mock_context

            result = await msg.stream_token("Hello ")
            assert result is msg  # Returns self for chaining
            assert msg._accumulated_tokens == "Hello "

            event = await queue.get()
            assert event["type"] == "token"
            assert event["token"] == "Hello "

    @pytest.mark.asyncio
    async def test_stream_token_accumulation(self):
        """Test multiple stream_token() calls accumulate content."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="", streaming=True)
            msg._context = mock_context

            await msg.stream_token("Hello ")
            await msg.stream_token("world!")

            assert msg._accumulated_tokens == "Hello world!"

    @pytest.mark.asyncio
    async def test_update(self):
        """Test update() sends message_update event."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="Original")
            msg._context = mock_context

            result = await msg.update("Updated content")
            assert result is msg
            assert msg.content == "Updated content"

            event = await queue.get()
            assert event["type"] == "message_update"
            assert event["content"] == "Updated content"

    @pytest.mark.asyncio
    async def test_remove(self):
        """Test remove() sends message_remove event."""
        from praisonaiui.message import Message

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            msg = Message(content="To be removed")
            msg._context = mock_context

            await msg.remove()

            event = await queue.get()
            assert event["type"] == "message_remove"
            assert event["message_id"] == msg.id


class TestAskUserMessage:
    """Tests for AskUserMessage class."""

    def test_ask_user_message_creation(self):
        """Test AskUserMessage creation."""
        from praisonaiui.message import AskUserMessage

        ask = AskUserMessage(content="What's your name?")
        assert ask.content == "What's your name?"
        assert ask.options == []
        assert ask.timeout == 300.0
        assert ask.author == "assistant"

    def test_ask_user_message_with_options(self):
        """Test AskUserMessage with options."""
        from praisonaiui.message import AskUserMessage

        ask = AskUserMessage(
            content="Choose one:",
            options=["A", "B", "C"],
            timeout=60.0,
        )
        assert ask.options == ["A", "B", "C"]
        assert ask.timeout == 60.0

    @pytest.mark.asyncio
    async def test_send_without_context(self):
        """Test send() returns None when no context."""
        from praisonaiui.message import AskUserMessage

        with patch("praisonaiui.callbacks._get_context", return_value=None):
            ask = AskUserMessage(content="Question?")
            ask._context = None
            result = await ask.send()
            assert result is None

    @pytest.mark.asyncio
    async def test_send_with_response(self):
        """Test send() returns user response."""
        from praisonaiui.message import AskUserMessage

        mock_context = MagicMock()
        mock_context.ask = AsyncMock(return_value="John")

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            ask = AskUserMessage(content="What's your name?")
            ask._context = mock_context

            result = await ask.send()
            assert result is not None
            assert result["output"] == "John"
            mock_context.ask.assert_called_once_with(
                question="What's your name?",
                options=[],
                timeout=300.0,
            )


class TestStep:
    """Tests for Step class (reasoning steps)."""

    def test_step_creation(self):
        """Test Step creation."""
        from praisonaiui.message import Step

        step = Step(name="Analyzing")
        assert step.name == "Analyzing"
        assert step.parent is None
        assert step.metadata == {}
        assert step._started is False

    def test_step_with_parent(self):
        """Test Step with parent step."""
        from praisonaiui.message import Step

        parent = Step(name="Main")
        child = Step(name="Sub", parent=parent)
        assert child.parent is parent

    @pytest.mark.asyncio
    async def test_step_context_manager(self):
        """Test Step as async context manager."""
        from praisonaiui.message import Step

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            step = Step(name="Processing")
            step._context = mock_context

            async with step:
                assert step._started is True
                # Check reasoning_started event
                event = await queue.get()
                assert event["type"] == "reasoning_started"
                assert event["name"] == "Processing"

            # Check reasoning_completed event
            event = await queue.get()
            assert event["type"] == "reasoning_completed"
            assert event["name"] == "Processing"

    @pytest.mark.asyncio
    async def test_step_stream_token(self):
        """Test streaming tokens within a step."""
        from praisonaiui.message import Step

        queue = asyncio.Queue()
        mock_context = MagicMock()
        mock_context._stream_queue = queue

        with patch("praisonaiui.callbacks._get_context", return_value=mock_context):
            step = Step(name="Thinking")
            step._context = mock_context

            result = await step.stream_token("Processing data...")
            assert result is step

            event = await queue.get()
            assert event["type"] == "reasoning_step"
            assert event["step"] == "Processing data..."
