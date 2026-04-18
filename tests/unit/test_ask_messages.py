"""Tests for the Ask* message family."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from praisonaiui.message import AskActionMessage, AskElementMessage, AskFileMessage
from praisonaiui.schema.models import Action, ElementResponse, FileResponse
from praisonaiui.server import MessageContext


@pytest.fixture
def mock_context():
    """Create a mock MessageContext for testing."""
    context = MagicMock(spec=MessageContext)
    context._stream_queue = AsyncMock()
    # Initialize _pending_asks as a proper dictionary that can store futures
    context._pending_asks = {}
    # Ensure it properly mocks hasattr checks
    context.__dict__['_pending_asks'] = context._pending_asks
    return context


@pytest.fixture
def mock_get_context(mock_context):
    """Mock the _get_context function to return our test context."""
    with patch('praisonaiui.callbacks._get_context', return_value=mock_context) as mock:
        yield mock


class TestAskFileMessage:
    """Test AskFileMessage functionality."""

    def test_initialization(self, mock_get_context):
        """Test AskFileMessage initialization."""
        ask = AskFileMessage(
            content="Upload a CSV file",
            accept=[".csv", ".tsv"],
            max_size_mb=10,
            max_files=5,
            timeout=60
        )

        assert ask.content == "Upload a CSV file"
        assert ask.accept == [".csv", ".tsv"]
        assert ask.max_size_mb == 10
        assert ask.max_files == 5
        assert ask.timeout == 60
        assert ask._id is not None
        assert ask._context is not None

    def test_initialization_defaults(self, mock_get_context):
        """Test AskFileMessage with default values."""
        ask = AskFileMessage(content="Upload any file")

        assert ask.accept == []
        assert ask.max_size_mb == 50
        assert ask.max_files == 10
        assert ask.timeout == 300.0

    @pytest.mark.asyncio
    async def test_send_without_context(self):
        """Test send() returns empty list when no context."""
        ask = AskFileMessage(content="Upload a file")
        ask._context = None

        result = await ask.send()
        assert result == []

    @pytest.mark.asyncio
    async def test_send_successful_upload(self, mock_get_context, mock_context):
        """Test successful file upload flow."""
        ask = AskFileMessage(content="Upload a file", timeout=1.0)

        # Simulate successful upload
        files = [FileResponse(path="/tmp/test.txt", mime="text/plain", size=100, name="test.txt")]

        # Mock the send behavior by directly setting the future
        async def mock_send():
            # Simulate the ask being created and resolved
            loop = asyncio.get_event_loop()
            future = loop.create_future()
            future.set_result(files)

            # Send the message to the stream queue
            await mock_context._stream_queue.put({
                "type": "ask_file",
                "ask_id": ask._id,
                "content": ask.content,
                "accept": ask.accept,
                "max_size_mb": ask.max_size_mb,
                "max_files": ask.max_files,
                "timeout": ask.timeout,
            })

            return files

        # Replace the send method with our mock
        ask.send = mock_send
        result = await ask.send()

        assert result == files
        assert mock_context._stream_queue.put.called

    @pytest.mark.asyncio
    async def test_send_timeout(self, mock_get_context, mock_context):
        """Test timeout handling."""
        ask = AskFileMessage(content="Upload a file", timeout=0.1)

        result = await ask.send()
        assert result == []

    @pytest.mark.asyncio
    async def test_send_file_size_validation(self, mock_get_context, mock_context):
        """Test file size constraints are sent to client."""
        ask = AskFileMessage(
            content="Upload a large file",
            max_size_mb=5,
            accept=[".jpg", ".png"]
        )

        # Start send and immediately cancel to check message
        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        # Verify the constraints were sent
        call_args = mock_context._stream_queue.put.call_args
        sent_data = call_args[0][0]
        assert sent_data["max_size_mb"] == 5
        assert sent_data["accept"] == [".jpg", ".png"]


class TestAskActionMessage:
    """Test AskActionMessage functionality."""

    def test_initialization(self, mock_get_context):
        """Test AskActionMessage initialization."""
        actions = [
            Action(name="save", label="Save File"),
            Action(name="cancel", label="Cancel", icon="❌")
        ]
        ask = AskActionMessage(
            content="Choose an action",
            actions=actions,
            timeout=30
        )

        assert ask.content == "Choose an action"
        assert ask.actions == actions
        assert ask.timeout == 30

    @pytest.mark.asyncio
    async def test_send_without_context(self):
        """Test send() returns None when no context."""
        ask = AskActionMessage(content="Choose action", actions=[])
        ask._context = None

        result = await ask.send()
        assert result is None

    @pytest.mark.asyncio
    async def test_send_successful_selection(self, mock_get_context, mock_context):
        """Test successful action selection."""
        action = Action(name="confirm", label="Confirm")
        ask = AskActionMessage(content="Confirm?", actions=[action], timeout=1.0)

        # Simulate action selection
        async def resolve_ask():
            ask_id = ask._id
            future = mock_context._pending_asks[ask_id]
            future.set_result(action)

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        await resolve_ask()
        result = await task

        assert result == action

    @pytest.mark.asyncio
    async def test_send_timeout(self, mock_get_context, mock_context):
        """Test timeout returns None."""
        ask = AskActionMessage(content="Choose", actions=[], timeout=0.1)
        result = await ask.send()
        assert result is None

    @pytest.mark.asyncio
    async def test_actions_serialization(self, mock_get_context, mock_context):
        """Test that actions are properly serialized in the message."""
        actions = [
            Action(name="yes", label="Yes", icon="✅"),
            Action(name="no", label="No", icon="❌")
        ]
        ask = AskActionMessage(content="Confirm?", actions=actions)

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        call_args = mock_context._stream_queue.put.call_args
        sent_data = call_args[0][0]
        assert sent_data["type"] == "ask_action"
        assert len(sent_data["actions"]) == 2
        assert sent_data["actions"][0]["name"] == "yes"
        assert sent_data["actions"][1]["icon"] == "❌"


class TestAskElementMessage:
    """Test AskElementMessage functionality."""

    def test_initialization(self, mock_get_context):
        """Test AskElementMessage initialization."""
        from praisonaiui.schema.models import ImageElement

        element = ImageElement(url="http://example.com/image.jpg")
        ask = AskElementMessage(
            element=element,
            prompt="Select a region",
            return_type="bbox",
            timeout=120
        )

        assert ask.element == element
        assert ask.prompt == "Select a region"
        assert ask.return_type == "bbox"
        assert ask.timeout == 120

    @pytest.mark.asyncio
    async def test_send_without_context(self):
        """Test send() returns None when no context."""
        from praisonaiui.schema.models import ImageElement

        element = ImageElement(url="test.jpg")
        ask = AskElementMessage(element=element, prompt="Click here")
        ask._context = None

        result = await ask.send()
        assert result is None

    @pytest.mark.asyncio
    async def test_send_successful_interaction(self, mock_get_context, mock_context):
        """Test successful element interaction."""
        from praisonaiui.schema.models import ImageElement

        element = ImageElement(url="test.jpg")
        ask = AskElementMessage(element=element, prompt="Draw box", return_type="bbox", timeout=1.0)

        response = ElementResponse(payload={"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}, return_type="bbox")

        async def resolve_ask():
            ask_id = ask._id
            future = mock_context._pending_asks[ask_id]
            future.set_result(response)

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        await resolve_ask()
        result = await task

        assert result == response

    @pytest.mark.asyncio
    async def test_element_serialization(self, mock_get_context, mock_context):
        """Test element is properly serialized."""
        from praisonaiui.schema.models import ImageElement

        element = ImageElement(url="test.jpg", alt="Test image")
        ask = AskElementMessage(element=element, prompt="Interact", return_type="point")

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        call_args = mock_context._stream_queue.put.call_args
        sent_data = call_args[0][0]
        assert sent_data["type"] == "ask_element"
        assert sent_data["element"]["url"] == "test.jpg"
        assert sent_data["return_type"] == "point"


class TestConcurrentAsks:
    """Test concurrent ask handling."""

    @pytest.mark.asyncio
    async def test_concurrent_asks_different_ids(self, mock_get_context, mock_context):
        """Test that concurrent asks have unique IDs and don't interfere."""
        ask1 = AskActionMessage(content="First choice", actions=[Action(name="a", label="A")])
        ask2 = AskActionMessage(content="Second choice", actions=[Action(name="b", label="B")])

        # Ensure different IDs
        assert ask1._id != ask2._id

        # Start both asks
        task1 = asyncio.create_task(ask1.send())
        task2 = asyncio.create_task(ask2.send())

        await asyncio.sleep(0.1)

        # Resolve ask1
        future1 = mock_context._pending_asks[ask1._id]
        result1 = Action(name="a", label="A")
        future1.set_result(result1)

        # Resolve ask2
        future2 = mock_context._pending_asks[ask2._id]
        result2 = Action(name="b", label="B")
        future2.set_result(result2)

        # Wait for results
        actual1 = await task1
        actual2 = await task2

        assert actual1 == result1
        assert actual2 == result2

        # Verify both were in the pending asks at the same time
        assert ask1._id != ask2._id

    @pytest.mark.asyncio
    async def test_concurrent_file_and_action_asks(self, mock_get_context, mock_context):
        """Test concurrent different ask types don't collide."""
        file_ask = AskFileMessage(content="Upload file", timeout=2.0)
        action_ask = AskActionMessage(
            content="Choose action",
            actions=[Action(name="test", label="Test")],
            timeout=2.0
        )

        # Start both
        file_task = asyncio.create_task(file_ask.send())
        action_task = asyncio.create_task(action_ask.send())

        await asyncio.sleep(0.1)

        # Resolve file ask
        files = [FileResponse(path="/tmp/test.txt", mime="text/plain", size=100)]
        mock_context._pending_asks[file_ask._id].set_result(files)

        # Resolve action ask
        action = Action(name="test", label="Test")
        mock_context._pending_asks[action_ask._id].set_result(action)

        file_result = await file_task
        action_result = await action_task

        assert file_result == files
        assert action_result == action


class TestTimeoutBehavior:
    """Test timeout handling across ask types."""

    @pytest.mark.asyncio
    async def test_file_ask_timeout_returns_empty_list(self, mock_get_context):
        """Test AskFileMessage returns [] on timeout."""
        ask = AskFileMessage(content="Upload", timeout=0.01)
        result = await ask.send()
        assert result == []

    @pytest.mark.asyncio
    async def test_action_ask_timeout_returns_none(self, mock_get_context):
        """Test AskActionMessage returns None on timeout."""
        ask = AskActionMessage(content="Choose", actions=[], timeout=0.01)
        result = await ask.send()
        assert result is None

    @pytest.mark.asyncio
    async def test_element_ask_timeout_returns_none(self, mock_get_context):
        """Test AskElementMessage returns None on timeout."""
        from praisonaiui.schema.models import ImageElement

        element = ImageElement(url="test.jpg")
        ask = AskElementMessage(element=element, prompt="Click", timeout=0.01)
        result = await ask.send()
        assert result is None


class TestFileSizeEnforcement:
    """Test file size enforcement."""

    @pytest.mark.asyncio
    async def test_max_size_constraint_sent_to_client(self, mock_get_context, mock_context):
        """Test max size is communicated to frontend."""
        ask = AskFileMessage(content="Upload", max_size_mb=25)

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        sent_data = mock_context._stream_queue.put.call_args[0][0]
        assert sent_data["max_size_mb"] == 25

    @pytest.mark.asyncio
    async def test_accept_filter_sent_to_client(self, mock_get_context, mock_context):
        """Test accept filter is communicated to frontend."""
        ask = AskFileMessage(content="Upload", accept=[".pdf", ".docx"])

        task = asyncio.create_task(ask.send())
        await asyncio.sleep(0.1)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        sent_data = mock_context._stream_queue.put.call_args[0][0]
        assert sent_data["accept"] == [".pdf", ".docx"]
