"""Message class with a composable ``.send()`` / ``.update()`` / ``.stream_token()`` API.

This module provides a ``Message`` object that can be configured
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

import time
import uuid
from dataclasses import dataclass, field
from functools import wraps
from typing import TYPE_CHECKING, Any, Literal, Optional, Union

from praisonaiui.schema.models import (
    AudioElement,
    CodeElement,
    FileElement,
    ImageElement,
    MessageElementUnion,
    PdfElement,
    VideoElement,
)
from praisonaiui.server import MessageContext

if TYPE_CHECKING:
    from praisonaiui.actions import Action

# Size limits in bytes
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_CODE_SIZE = 1024 * 1024  # 1MB for code blocks

# Step types for chain-of-thought UI components
StepType = Literal["tool_call", "reasoning", "sub_agent", "retrieval", "custom"]


@dataclass
class Message:
    """A composable message object with a fluent ``.send()`` / ``.stream_token()`` API.

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
    elements: list[Union[MessageElementUnion, dict[str, Any]]] = field(default_factory=list)
    actions: list[Union["Action", dict[str, Any]]] = field(default_factory=list)
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

    def _serialize_actions(self) -> Optional[list[dict[str, Any]]]:
        """Serialize actions to dict format for transmission.

        Sets message_id on Action objects and converts to dicts.
        Returns None if no actions to avoid sending empty arrays.
        """
        if not self.actions:
            return None

        serialized_actions = []
        for action in self.actions:
            if hasattr(action, 'to_dict'):
                # Set message_id for proper association
                action.message_id = self._id
                serialized_actions.append(action.to_dict())
            else:
                # Legacy dict format
                serialized_actions.append(action)

        return serialized_actions

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
                "actions": self._serialize_actions(),
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
                "actions": self._serialize_actions(),
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
            "actions": self._serialize_actions(),
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
        """Add a typed element (image, file, etc.) to the message.

        Args:
            element_type: Type of element ("image", "pdf", "video", "audio", "file", "code")
            url: URL of the element (required for non-code elements)
            content: Inline content (required for code elements)
            **kwargs: Additional element properties (name, display, alt, etc.)

        Returns:
            self for chaining
        """
        try:
            # Validate size limits
            if kwargs.get("size") and kwargs["size"] > MAX_FILE_SIZE:
                raise ValueError(
                    f"File size {kwargs['size']} exceeds maximum allowed size {MAX_FILE_SIZE}"
                )

            if content and len(content.encode('utf-8')) > MAX_CODE_SIZE:
                raise ValueError(f"Code content size exceeds maximum allowed size {MAX_CODE_SIZE}")

            # Create typed element based on type
            if element_type == "image":
                if not url:
                    raise ValueError("url is required for image elements")
                element = ImageElement(url=url, **kwargs)
            elif element_type == "pdf":
                if not url:
                    raise ValueError("url is required for pdf elements")
                element = PdfElement(url=url, **kwargs)
            elif element_type == "video":
                if not url:
                    raise ValueError("url is required for video elements")
                element = VideoElement(url=url, **kwargs)
            elif element_type == "audio":
                if not url:
                    raise ValueError("url is required for audio elements")
                element = AudioElement(url=url, **kwargs)
            elif element_type == "file":
                if not url:
                    raise ValueError("url is required for file elements")
                element = FileElement(url=url, **kwargs)
            elif element_type == "code":
                if not content:
                    raise ValueError("content is required for code elements")
                element = CodeElement(content=content, **kwargs)
            else:
                # Fallback to legacy dict format for unknown types
                element = {"type": element_type, **kwargs}
                if url:
                    element["url"] = url
                if content:
                    element["content"] = content

            self.elements.append(element)
        except ValueError:
            # Intentional validation errors — propagate to caller
            raise
        except (TypeError, Exception):
            # Dataclass/pydantic constructor mismatch → fall back to dict
            element = {"type": element_type, **kwargs}
            if url:
                element["url"] = url
            if content:
                element["content"] = content
            self.elements.append(element)

        return self

    def add_image(self, url: str, name: Optional[str] = None, alt: Optional[str] = None,
                  display: str = "inline", **kwargs: Any) -> "Message":
        """Add an image element to the message."""
        return self.add_element("image", url=url, name=name, alt=alt, display=display, **kwargs)

    def add_pdf(self, url: str, name: Optional[str] = None, display: str = "inline",
                **kwargs: Any) -> "Message":
        """Add a PDF element to the message."""
        return self.add_element("pdf", url=url, name=name, display=display, **kwargs)

    def add_video(self, url: str, name: Optional[str] = None, display: str = "inline",
                  controls: bool = True, **kwargs: Any) -> "Message":
        """Add a video element to the message."""
        return self.add_element("video", url=url, name=name, display=display,
                               controls=controls, **kwargs)

    def add_audio(self, url: str, name: Optional[str] = None, display: str = "inline",
                  controls: bool = True, **kwargs: Any) -> "Message":
        """Add an audio element to the message."""
        return self.add_element("audio", url=url, name=name, display=display,
                               controls=controls, **kwargs)

    def add_file(self, url: str, name: Optional[str] = None, display: str = "inline",
                 size: Optional[int] = None, mime_type: Optional[str] = None,
                 **kwargs: Any) -> "Message":
        """Add a file download element to the message."""
        return self.add_element("file", url=url, name=name, display=display, size=size,
                               mimeType=mime_type, **kwargs)

    def add_code(self, content: str, language: Optional[str] = None, name: Optional[str] = None,
                 display: str = "inline", **kwargs: Any) -> "Message":
        """Add a code block element to the message."""
        return self.add_element("code", content=content, language=language, name=name,
                               display=display, **kwargs)

    def add_action(
        self,
        name: str,
        label: str,
        icon: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
        variant: str = "secondary",
    ) -> "Message":
        """Add an action button to the message.

        Args:
            name: Action identifier (must match a registered @action_callback)
            label: Button label text
            icon: Optional icon name
            payload: Optional data passed to callback when clicked
            variant: Button style variant ("primary", "secondary", etc.)

        Returns:
            self for chaining
        """
        try:
            # Try to create a proper Action object
            from praisonaiui.actions import Action
            action = Action(
                name=name,
                label=label,
                icon=icon,
                payload=payload,
                variant=variant
            )
            self.actions.append(action)
        except ImportError:
            # Fallback to legacy dict format if actions module not available
            action = {"name": name, "label": label}
            if icon:
                action["icon"] = icon
            if payload is not None:
                action["payload"] = payload
            if variant != "secondary":
                action["variant"] = variant
            self.actions.append(action)
        return self


@dataclass
class AskUserMessage:
    """Ask the user a question and wait for their response.

    .. deprecated:: 0.3.109
        Use :func:`praisonaiui.prompt` instead. ``AskUserMessage`` is kept as a
        thin wrapper and will be removed in 0.5.0.

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
    """A reasoning/thinking step with nested-step support.

    Example:
        async with Step(name="🔧 Tool: web_search", type="tool_call") as step:
            await step.stream_token("Input: { query: ... }")
            await step.stream_token("Output: [ 10 results ]")
            # Nested step
            async with Step(name="Sub-analysis", parent=step, type="reasoning"):
                await step.stream_token("Analyzing results...")
    """

    name: str
    type: StepType = "reasoning"
    parent: Optional["Step"] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)
    _started: bool = field(default=False, repr=False)
    _start_time: Optional[float] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context
        self._context = _get_context()

    async def __aenter__(self) -> "Step":
        """Start the step."""
        self._start_time = time.time()
        if self._context and self._context._stream_queue:
            await self._context._stream_queue.put({
                "type": "reasoning_started",
                "step_id": self._id,
                "name": self.name,
                "step_type": self.type,
                "parent_id": self.parent._id if self.parent else None,
                "metadata": self.metadata,
            })
            self._started = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Complete the step."""
        if self._context and self._context._stream_queue and self._started:
            duration = time.time() - self._start_time if self._start_time else None
            await self._context._stream_queue.put({
                "type": "reasoning_completed",
                "step_id": self._id,
                "name": self.name,
                "step_type": self.type,
                "duration": duration,
                "error": str(exc_val) if exc_val else None,
                "metadata": self.metadata,
            })

    async def stream_token(self, token: str) -> "Step":
        """Stream a token within this step."""
        if self._context and self._context._stream_queue:
            await self._context._stream_queue.put({
                "type": "reasoning_step",
                "step_id": self._id,
                "step": token,
                "step_type": self.type,
            })
        return self


def step(name: str, type: StepType = "reasoning", **metadata: Any):
    """Decorator to wrap a function in a Step context manager.

    Args:
        name: The step name to display
        type: The step type (tool_call, reasoning, sub_agent, retrieval, custom)
        **metadata: Additional metadata to include with the step

    Example:
        @step("🔧 Tool: web_search", type="tool_call")
        async def web_search(query: str):
            # Function will be wrapped in Step context
            result = await search_web(query)
            return result
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            async with Step(name=name, type=type, metadata=metadata):
                return await func(*args, **kwargs)
        return wrapper
    return decorator
