"""Message class with Chainlit-style .send()/.update()/.stream_token() pattern.

This module provides a composable Message object that can be configured
before sending, enabling rich interactions with metadata, elements, and actions.

Example:
    msg = Message(content="Processing...")
    msg.streaming = True
    await msg.send()  # Sends typing indicator
    await msg.stream_token("Hello ")
    await msg.stream_token("world!")
    await msg.send()  # Finalizes message
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from praisonaiui.server import MessageContext


@dataclass
class Message:
    """A composable message object with Chainlit-style API.

    Attributes:
        content: The message content (text)
        author: Author name (default: "assistant")
        streaming: Whether this is a streaming message
        elements: List of media elements (images, files, etc.)
        actions: List of action buttons
        metadata: Additional metadata dict

    Example:
        # Simple message
        msg = Message(content="Hello!")
        await msg.send()

        # Streaming message
        msg = Message(content="")
        msg.streaming = True
        await msg.send()  # Shows typing indicator
        await msg.stream_token("Hello ")
        await msg.stream_token("world!")
        await msg.send()  # Finalizes

        # Message with elements
        msg = Message(content="Here's an image:")
        msg.elements = [{"type": "image", "url": "https://..."}]
        await msg.send()
    """

    content: str = ""
    author: str = "assistant"
    streaming: bool = False
    elements: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    # Internal state
    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _sent: bool = field(default=False, repr=False)
    _context: Optional[MessageContext] = field(default=None, repr=False)
    _accumulated_tokens: str = field(default="", repr=False)

    def __post_init__(self):
        """Initialize message with context from current callback."""
        from praisonaiui.callbacks import _get_context
        self._context = _get_context()

    @property
    def id(self) -> str:
        """Get the message ID."""
        return self._id

    async def send(self) -> "Message":
        """Send or finalize the message.

        If streaming=True and not yet sent, sends a typing indicator.
        If already sent (streaming), finalizes the message.

        Returns:
            self for chaining
        """
        if not self._context or not self._context._stream_queue:
            return self

        if self.streaming and not self._sent:
            # First send - show typing indicator
            await self._context._stream_queue.put({
                "type": "run_started",
                "message_id": self._id,
                "author": self.author,
            })
            self._sent = True
        elif self.streaming and self._sent:
            # Finalize streaming message
            final_content = self._accumulated_tokens or self.content
            await self._context._stream_queue.put({
                "type": "message",
                "message_id": self._id,
                "content": final_content,
                "author": self.author,
                "elements": self.elements if self.elements else None,
                "actions": self.actions if self.actions else None,
                "metadata": self.metadata if self.metadata else None,
            })
        else:
            # Non-streaming - send complete message
            await self._context._stream_queue.put({
                "type": "message",
                "message_id": self._id,
                "content": self.content,
                "author": self.author,
                "elements": self.elements if self.elements else None,
                "actions": self.actions if self.actions else None,
                "metadata": self.metadata if self.metadata else None,
            })
            self._sent = True

        return self

    async def stream_token(self, token: str) -> "Message":
        """Stream a token to the client.

        Args:
            token: The token to stream

        Returns:
            self for chaining
        """
        if not self._context or not self._context._stream_queue:
            return self

        self._accumulated_tokens += token
        await self._context._stream_queue.put({
            "type": "token",
            "message_id": self._id,
            "token": token,
        })
        return self

    async def update(self, content: Optional[str] = None) -> "Message":
        """Update the message content.

        Args:
            content: New content (if None, uses self.content)

        Returns:
            self for chaining
        """
        if content is not None:
            self.content = content

        if not self._context or not self._context._stream_queue:
            return self

        await self._context._stream_queue.put({
            "type": "message_update",
            "message_id": self._id,
            "content": self.content,
            "author": self.author,
            "elements": self.elements if self.elements else None,
            "actions": self.actions if self.actions else None,
        })
        return self

    async def remove(self) -> None:
        """Remove the message from the UI."""
        if not self._context or not self._context._stream_queue:
            return

        await self._context._stream_queue.put({
            "type": "message_remove",
            "message_id": self._id,
        })

    def add_element(
        self,
        element_type: str,
        url: Optional[str] = None,
        content: Optional[str] = None,
        **kwargs: Any,
    ) -> "Message":
        """Add an element (image, file, etc.) to the message.

        Args:
            element_type: Type of element ("image", "file", "audio", "video")
            url: URL of the element
            content: Inline content (for text elements)
            **kwargs: Additional element properties

        Returns:
            self for chaining
        """
        element = {"type": element_type, **kwargs}
        if url:
            element["url"] = url
        if content:
            element["content"] = content
        self.elements.append(element)
        return self

    def add_action(
        self,
        name: str,
        label: str,
        icon: Optional[str] = None,
        **kwargs: Any,
    ) -> "Message":
        """Add an action button to the message.

        Args:
            name: Action identifier
            label: Button label
            icon: Optional icon name
            **kwargs: Additional action properties

        Returns:
            self for chaining
        """
        action = {"name": name, "label": label, **kwargs}
        if icon:
            action["icon"] = icon
        self.actions.append(action)
        return self


@dataclass
class AskUserMessage:
    """Ask the user a question and wait for response (Chainlit pattern).

    Example:
        res = await AskUserMessage(content="What's your name?").send()
        if res:
            name = res["output"]
    """

    content: str
    options: list[str] = field(default_factory=list)
    timeout: float = 300.0
    author: str = "assistant"

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context
        self._context = _get_context()

    async def send(self) -> Optional[dict[str, Any]]:
        """Send the question and wait for user response.

        Returns:
            Dict with "output" key containing user's response, or None on timeout
        """
        if not self._context:
            return None

        response = await self._context.ask(
            question=self.content,
            options=self.options,
            timeout=self.timeout,
        )

        if response:
            return {"output": response, "message_id": self._id}
        return None


@dataclass
class Step:
    """A reasoning/thinking step (nested steps support).

    Example:
        async with Step(name="Analyzing") as step:
            await step.stream_token("Processing data...")
            # Nested step
            async with Step(name="Sub-analysis", parent=step):
                await aiui.think("Checking details...")
    """

    name: str
    parent: Optional["Step"] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)
    _started: bool = field(default=False, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context
        self._context = _get_context()

    async def __aenter__(self) -> "Step":
        """Start the step."""
        if self._context and self._context._stream_queue:
            await self._context._stream_queue.put({
                "type": "reasoning_started",
                "step_id": self._id,
                "name": self.name,
                "parent_id": self.parent._id if self.parent else None,
            })
            self._started = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Complete the step."""
        if self._context and self._context._stream_queue and self._started:
            await self._context._stream_queue.put({
                "type": "reasoning_completed",
                "step_id": self._id,
                "name": self.name,
                "error": str(exc_val) if exc_val else None,
            })

    async def stream_token(self, token: str) -> "Step":
        """Stream a token within this step."""
        if self._context and self._context._stream_queue:
            await self._context._stream_queue.put({
                "type": "reasoning_step",
                "step_id": self._id,
                "step": token,
            })
        return self
