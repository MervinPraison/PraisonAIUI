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

import asyncio
import contextvars
import inspect
import json
import time
import uuid
from dataclasses import dataclass, field
from functools import wraps
from typing import TYPE_CHECKING, Any, Literal, Optional, Union

from praisonaiui.schema.models import (
    Action as ActionModel,
)
from praisonaiui.schema.models import (
    AudioElement,
    CodeElement,
    ElementResponse,
    FileElement,
    FileResponse,
    ImageElement,
    MessageElementUnion,
    PdfElement,
    VideoElement,
)
from praisonaiui.server import MessageContext

if TYPE_CHECKING:
    # Action here refers to the decorator-style Action (praisonaiui.actions.Action)
    # used by Message.actions. The schema-model Action is imported above as
    # ActionModel to avoid shadowing.
    from praisonaiui.actions import Action  # noqa: F401

# Size limits in bytes
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
MAX_CODE_SIZE = 1024 * 1024  # 1MB for code blocks

# Step types: what kind of work a step is (any string is kept and sent as is)
StepType = Literal[
    "run", "tool", "llm", "embedding", "retrieval", "rerank", "undefined",
    "tool_call", "reasoning", "sub_agent", "custom",
]


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
            if hasattr(action, "to_dict"):
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
            await self._context._stream_queue.put(
                {
                    "type": "run_started",
                    "message_id": self._id,
                    "author": self.author,
                }
            )
            self._sent = True
        elif self.streaming and self._sent:
            # Finalize streaming message
            final_content = self._accumulated_tokens or self.content
            await self._context._stream_queue.put(
                {
                    "type": "message",
                    "message_id": self._id,
                    "content": final_content,
                    "author": self.author,
                    "elements": self.elements if self.elements else None,
                    "actions": self._serialize_actions(),
                    "metadata": self.metadata if self.metadata else None,
                }
            )
        else:
            # Non-streaming - send complete message
            await self._context._stream_queue.put(
                {
                    "type": "message",
                    "message_id": self._id,
                    "content": self.content,
                    "author": self.author,
                    "elements": self.elements if self.elements else None,
                    "actions": self._serialize_actions(),
                    "metadata": self.metadata if self.metadata else None,
                }
            )
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
        if not self.streaming:
            # A later send() delivers what was streamed (it sets, never repeats).
            self.content += token
        await self._context._stream_queue.put(
            {
                "type": "token",
                "message_id": self._id,
                "token": token,
            }
        )
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

        await self._context._stream_queue.put(
            {
                "type": "message_update",
                "message_id": self._id,
                "content": self.content,
                "author": self.author,
                "elements": self.elements if self.elements else None,
                "actions": self._serialize_actions(),
            }
        )
        return self

    async def remove(self) -> None:
        """Remove the message from the UI."""
        if not self._context or not self._context._stream_queue:
            return

        await self._context._stream_queue.put(
            {
                "type": "message_remove",
                "message_id": self._id,
            }
        )

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

            if content and len(content.encode("utf-8")) > MAX_CODE_SIZE:
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

    def add_image(
        self,
        url: str,
        name: Optional[str] = None,
        alt: Optional[str] = None,
        display: str = "inline",
        **kwargs: Any,
    ) -> "Message":
        """Add an image element to the message."""
        return self.add_element("image", url=url, name=name, alt=alt, display=display, **kwargs)

    def add_pdf(
        self, url: str, name: Optional[str] = None, display: str = "inline", **kwargs: Any
    ) -> "Message":
        """Add a PDF element to the message."""
        return self.add_element("pdf", url=url, name=name, display=display, **kwargs)

    def add_video(
        self,
        url: str,
        name: Optional[str] = None,
        display: str = "inline",
        controls: bool = True,
        **kwargs: Any,
    ) -> "Message":
        """Add a video element to the message."""
        return self.add_element(
            "video", url=url, name=name, display=display, controls=controls, **kwargs
        )

    def add_audio(
        self,
        url: str,
        name: Optional[str] = None,
        display: str = "inline",
        controls: bool = True,
        **kwargs: Any,
    ) -> "Message":
        """Add an audio element to the message."""
        return self.add_element(
            "audio", url=url, name=name, display=display, controls=controls, **kwargs
        )

    def add_file(
        self,
        url: str,
        name: Optional[str] = None,
        display: str = "inline",
        size: Optional[int] = None,
        mime_type: Optional[str] = None,
        **kwargs: Any,
    ) -> "Message":
        """Add a file download element to the message."""
        return self.add_element(
            "file", url=url, name=name, display=display, size=size, mimeType=mime_type, **kwargs
        )

    def add_code(
        self,
        content: str,
        language: Optional[str] = None,
        name: Optional[str] = None,
        display: str = "inline",
        **kwargs: Any,
    ) -> "Message":
        """Add a code block element to the message."""
        return self.add_element(
            "code", content=content, language=language, name=name, display=display, **kwargs
        )

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

            action = Action(name=name, label=label, icon=icon, payload=payload, variant=variant)
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


# The step the running code is inside (async tasks and make_async threads copy it).
_current_step: contextvars.ContextVar[Optional["Step"]] = contextvars.ContextVar(
    "aiui_current_step", default=None
)


def _now_ms() -> float:
    return round(time.time() * 1000, 1)


def _running_loop() -> Optional[asyncio.AbstractEventLoop]:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def _step_text(value: Any) -> Optional[str]:
    """A step's input or output as text (JSON for data), at most MAX_CODE_SIZE characters."""
    if value is None:
        return None
    try:
        text = value if isinstance(value, str) else json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(value)
    return text if len(text) <= MAX_CODE_SIZE else text[:MAX_CODE_SIZE] + "\u2026"


class _Sent:
    """What ``Step.stream_token`` returns: already sent. Await it in async code; sync code need not."""

    def __init__(self, step: "Step") -> None:
        self._step = step

    def __await__(self):
        if False:  # pragma: no cover - makes this a generator
            yield
        return self._step


@dataclass
class Step:
    """A named piece of work shown in the reply as a step (a tool call, an LLM call, a sub-run).

    ``async with`` or ``with`` (sync code and worker threads too). A step opened
    inside another becomes its child on its own, across awaits, tasks and
    ``aiui.make_async`` threads; ``parent=`` sets it explicitly. See docs/features/steps.md.
    """

    name: str
    type: StepType = "reasoning"
    parent: Optional["Step"] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    input: Any = None
    output: Any = None

    #: Epoch milliseconds when the step started and ended; ``status`` is
    #: ``running``, ``done``, ``error`` (the block raised) or ``stopped`` (cancelled).
    start: Optional[float] = field(default=None, init=False)
    end: Optional[float] = field(default=None, init=False)
    status: str = field(default="pending", init=False)
    error: Optional[str] = field(default=None, init=False)

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)
    _started: bool = field(default=False, repr=False)
    _start_time: Optional[float] = field(default=None, repr=False)
    _loop: Optional[asyncio.AbstractEventLoop] = field(default=None, repr=False)
    _token: Any = field(default=None, repr=False)
    _streamed: str = field(default="", repr=False)
    _sent_input: Optional[str] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context
        from praisonaiui.context import current_session

        self._context = _get_context()
        # In a worker thread there is no running loop: send through the reply's.
        outer, session = _current_step.get(), current_session()
        self._loop = _running_loop() or (outer and outer._loop) or (session and session.loop) or None

    @property
    def id(self) -> str:
        return self._id

    @property
    def duration(self) -> Optional[float]:
        """Seconds the step took (None until it ends)."""
        if self.start is None or self.end is None:
            return None
        return (self.end - self.start) / 1000

    def _send(self, kind: str, **fields: Any) -> None:
        queue = self._context._stream_queue if self._context else None
        if queue is None:
            return
        event = {"type": kind, "step_id": self._id, **{k: v for k, v in fields.items() if v is not None}}
        loop = self._loop
        if loop is not None and loop is not _running_loop() and loop.is_running():
            loop.call_soon_threadsafe(queue.put_nowait, event)  # from a worker thread
        else:
            queue.put_nowait(event)

    def _enter(self) -> "Step":
        if self.parent is None:
            self.parent = _current_step.get()
        self._token = _current_step.set(self)
        self._start_time = time.time()
        self.start = _now_ms()
        self.status = "running"
        self._sent_input = _step_text(self.input)
        self._send(
            "step_start",
            name=self.name,
            step_type=self.type,
            parent_id=self.parent._id if self.parent else None,
            start=self.start,
            input=self._sent_input,
            metadata=self.metadata,
        )
        self._started = True
        return self

    def _exit(self, exc: Optional[BaseException]) -> None:
        try:
            _current_step.reset(self._token)
        except (ValueError, RuntimeError):  # exited in another context than it entered
            _current_step.set(self.parent)
        self.end = _now_ms()
        if exc is None:
            self.status = "done"
        elif isinstance(exc, Exception):
            self.status, self.error = "error", str(exc) or type(exc).__name__
        else:
            self.status = "stopped"
        text_in, text_out = _step_text(self.input), _step_text(self.output)
        self._send(
            "step_end",
            name=self.name,
            step_type=self.type,
            end=self.end,
            status=self.status,
            error=self.error,
            duration=self.duration,
            input=text_in if text_in != self._sent_input else None,
            output=text_out if text_out != (self._streamed or None) else None,
            metadata=self.metadata,
        )

    async def __aenter__(self) -> "Step":
        return self._enter()

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self._exit(exc_val)

    def __enter__(self) -> "Step":
        return self._enter()

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._exit(exc_val)

    def stream_token(self, token: str) -> _Sent:
        """Append *token* to the output as it streams (``await`` it in async code; sync code need not)."""
        if token:
            before, self._streamed = self._streamed, self._streamed + token
            if self.output is None or self.output == before:  # an output set by hand stays
                self.output = self._streamed
            self._send("step_update", token=token)
        return _Sent(self)


def step(name: Any = None, type: StepType = "reasoning", **metadata: Any):
    """Show each call of a sync or async function as a step: ``@aiui.step``, ``@aiui.step()``,
    ``@aiui.step("name", type="tool")``. Named after the function unless named; input is the
    call's arguments, output the return value; an exception marks it failed and is raised."""
    if callable(name):  # bare @aiui.step
        return step()(name)

    def decorator(func):
        label = name or getattr(func, "__name__", "step")

        def _new(args: tuple, kwargs: dict) -> Step:
            try:  # the call's arguments by name, self/cls left out
                bound = inspect.signature(func).bind_partial(*args, **kwargs).arguments
                given = {k: v for k, v in bound.items() if k not in ("self", "cls")} or None
            except (TypeError, ValueError):
                given = None
            return Step(name=label, type=type, metadata=dict(metadata), input=given)

        if inspect.iscoroutinefunction(func):

            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                async with _new(args, kwargs) as s:
                    result = await func(*args, **kwargs)
                    if result is not None:
                        s.output = result
                    return result

            return async_wrapper

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            with _new(args, kwargs) as s:
                result = func(*args, **kwargs)
                if result is not None:
                    s.output = result
                return result

        return sync_wrapper

    return decorator


# ── Unified verb-first API (0.3.109) ────────────────────────────────
#
# These supersede ``AskUserMessage`` and the ad-hoc ``aiui.ask`` helper.
# Legacy symbols remain for backwards compatibility (see the deprecation
# notice in the :class:`AskUserMessage` docstring).


@dataclass
class PromptResult:
    """Typed result returned from :func:`prompt`.

    Attributes:
        text: Free-text answer the user typed. ``None`` if they picked an
            option or if the prompt timed out.
        choice: The option the user selected if ``options`` were given.
            ``None`` for free-text prompts.
        message_id: ID of the prompt message, useful for threading/audit.

    The object is truthy when the user actually answered; falsy on timeout,
    so handlers can write ``if res: ...`` naturally.
    """

    text: Optional[str] = None
    choice: Optional[str] = None
    message_id: Optional[str] = None

    def __bool__(self) -> bool:
        return self.text is not None or self.choice is not None

    # Backwards-compat dict-style access so code that previously read
    # ``res["output"]`` keeps working during the deprecation window.
    def __getitem__(self, key: str) -> Any:
        if key == "output":
            return self.choice if self.choice is not None else self.text
        if key == "message_id":
            return self.message_id
        raise KeyError(key)


async def prompt(
    question: str,
    *,
    options: Optional[list[str]] = None,
    timeout: float = 300.0,
) -> PromptResult:
    """Ask the user a question and wait for their answer.

    This is the preferred entry point for pause-and-wait interactions. It
    supersedes :class:`AskUserMessage`, which is kept only as an alias.

    Args:
        question: Text shown to the user.
        options: Optional list of choices. When supplied the user picks one;
            when omitted they type a free-text answer.
        timeout: Seconds to wait before giving up. Default 5 min.

    Returns:
        A :class:`PromptResult`. Truthy when the user answered, falsy on
        timeout so callers can write::

            answer = await aiui.prompt("What's your name?")
            if answer:
                await aiui.say(f"Hi {answer.text}!")

    Example with options::

        pick = await aiui.prompt("Pick a colour", options=["red", "blue"])
        if pick:
            await aiui.say(f"You picked {pick.choice}")
    """
    from praisonaiui.callbacks import _get_context

    ctx = _get_context()
    if ctx is None:
        return PromptResult()

    resp = await ctx.ask(
        question=question,
        options=list(options or []),
        timeout=timeout,
    )
    if not resp:
        return PromptResult()
    # Distinguish text vs option pick: when options were given and the
    # response matches one, treat as a choice.
    choice = resp if (options and resp in options) else None
    text = resp if choice is None else None
    return PromptResult(
        text=text,
        choice=choice,
        message_id=str(uuid.uuid4()),
    )


async def error(
    content: str,
    *,
    details: Optional[str] = None,
    author: str = "assistant",
) -> None:
    """Emit an error message to the user.

    Thin helper that builds a :class:`Message` with ``kind="error"`` and
    sends it. Prefer this over constructing a dedicated ``ErrorMessage``
    class — it keeps the surface area small.

    Args:
        content: Short, user-facing error text.
        details: Optional longer description or traceback summary.
        author: Message author (default ``"assistant"``).

    Example::

        try:
            data = await fetch_data()
        except Exception as exc:
            await aiui.error("Couldn't load data", details=str(exc))
    """
    meta: dict[str, Any] = {"kind": "error"}
    if details:
        meta["details"] = details
    msg = Message(content=content, author=author, metadata=meta)
    await msg.send()


# ── Ask* message family (issue #16) ─────────────────────────────


class ErrorMessage(Message):
    """Error message with red banner styling.

    Explicitly displays error messages with red banner style and
    copy-to-clipboard functionality, distinct from regular messages
    with ad-hoc [ERROR] prefixes.

    Example::

        error_msg = ErrorMessage(content="Authentication failed: Invalid token")
        await error_msg.send()
    """

    def __post_init__(self):
        """Initialize error message with proper type and author."""
        super().__post_init__()
        # Force author to be 'error' for frontend styling
        self.author = "error"
        # Add error metadata to distinguish from regular messages
        if not self.metadata:
            self.metadata = {}
        self.metadata["type"] = "error"
        self.metadata["copyable"] = True  # Enable copy-to-clipboard


@dataclass
class AskFileMessage:
    """Ask the user to upload one or more files.

    Example:
        files = await AskFileMessage(
            content="Upload a CSV to analyse",
            accept=[".csv", ".tsv"],
            max_size_mb=50,
            max_files=3,
            timeout=300,
        ).send()
    """

    content: str
    accept: list[str] = field(default_factory=list)
    max_size_mb: int = 50
    max_files: int = 10
    timeout: float = 300.0
    author: str = "assistant"

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context

        self._context = _get_context()

    async def send(self) -> Optional[list[FileResponse]]:
        """Send the file request and wait for user uploads.

        Returns:
            List of FileResponse objects, or empty list on timeout
        """
        if not self._context:
            return []

        loop = asyncio.get_running_loop()
        pending_ask = loop.create_future()

        if not hasattr(self._context, "_pending_asks"):
            self._context._pending_asks = {}
        self._context._pending_asks[self._id] = pending_ask

        if self._context._stream_queue:
            await self._context._stream_queue.put(
                {
                    "type": "ask_file",
                    "ask_id": self._id,
                    "content": self.content,
                    "accept": self.accept,
                    "max_size_mb": self.max_size_mb,
                    "max_files": self.max_files,
                    "timeout": self.timeout,
                }
            )

        try:
            response = await asyncio.wait_for(pending_ask, timeout=self.timeout)
            return response if response else []
        except asyncio.TimeoutError:
            return []
        finally:
            self._context._pending_asks.pop(self._id, None)


@dataclass
class AskActionMessage:
    """Ask the user to select one action from a list.

    Example:
        chosen = await AskActionMessage(
            content="Which analysis do you want?",
            actions=[
                ActionModel(name="summarise", label="Summarise"),
                ActionModel(name="profile", label="Profile columns"),
                ActionModel(name="plot", label="Plot"),
            ],
            timeout=120,
        ).send()
    """

    content: str
    actions: list[ActionModel] = field(default_factory=list)
    timeout: float = 120.0
    author: str = "assistant"

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context

        self._context = _get_context()

    async def send(self) -> Optional[ActionModel]:
        """Send the action request and wait for user selection.

        Returns:
            The selected ActionModel, or None on timeout
        """
        if not self._context:
            return None

        loop = asyncio.get_running_loop()
        pending_ask = loop.create_future()

        if not hasattr(self._context, "_pending_asks"):
            self._context._pending_asks = {}
        self._context._pending_asks[self._id] = pending_ask

        if self._context._stream_queue:
            await self._context._stream_queue.put(
                {
                    "type": "ask_action",
                    "ask_id": self._id,
                    "content": self.content,
                    "actions": [a.model_dump() for a in self.actions],
                    "timeout": self.timeout,
                }
            )

        try:
            response = await asyncio.wait_for(pending_ask, timeout=self.timeout)
            return response if response else None
        except asyncio.TimeoutError:
            return None
        finally:
            self._context._pending_asks.pop(self._id, None)


@dataclass
class AskElementMessage:
    """Ask the user to interact with an element (draw, annotate, etc).

    Example:
        bbox = await AskElementMessage(
            element=ImageElement(url="/static/chart.png"),
            prompt="Draw a bounding box on the area of interest",
            return_type="bbox",
            timeout=180,
        ).send()
    """

    element: MessageElementUnion
    prompt: str
    return_type: Literal["annotation", "bbox", "point", "freeform"] = "bbox"
    timeout: float = 180.0
    author: str = "assistant"

    _id: str = field(default_factory=lambda: str(uuid.uuid4()))
    _context: Optional[MessageContext] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize with context from current callback."""
        from praisonaiui.callbacks import _get_context

        self._context = _get_context()

    async def send(self) -> Optional[ElementResponse]:
        """Send the element interaction request and wait for user response.

        Returns:
            ElementResponse with interaction data, or None on timeout
        """
        if not self._context:
            return None

        loop = asyncio.get_running_loop()
        pending_ask = loop.create_future()

        if not hasattr(self._context, "_pending_asks"):
            self._context._pending_asks = {}
        self._context._pending_asks[self._id] = pending_ask

        if self._context._stream_queue:
            element_data = (
                self.element.model_dump() if hasattr(self.element, "model_dump") else self.element
            )
            await self._context._stream_queue.put(
                {
                    "type": "ask_element",
                    "ask_id": self._id,
                    "element": element_data,
                    "prompt": self.prompt,
                    "return_type": self.return_type,
                    "timeout": self.timeout,
                }
            )

        try:
            response = await asyncio.wait_for(pending_ask, timeout=self.timeout)
            return response if response else None
        except asyncio.TimeoutError:
            return None
        finally:
            self._context._pending_asks.pop(self._id, None)


# ── PraisonAIUI-native aliases ──────────────────────────────────────
# Noun-first, plain-English names that pair with the verb-first
# ``aiui.prompt()`` helper (see issue #41 API-direction policy).
# A non-developer reads ``FilePrompt`` as "a prompt that asks for a
# file" — no "Message" suffix convention required.  The original
# ``Ask*Message`` names remain importable for backward compatibility.

TextPrompt = AskUserMessage
FilePrompt = AskFileMessage
ChoicePrompt = AskActionMessage
LocationPrompt = AskElementMessage
