"""Callbacks module - Python decorator API for AI chat behavior."""

from __future__ import annotations

import asyncio
import inspect
from functools import wraps
from typing import Any, Callable, Optional, TypeVar

from praisonaiui.server import MessageContext, register_callback

F = TypeVar("F", bound=Callable[..., Any])

# Global context for the current message being processed
_current_context: Optional[MessageContext] = None


def _set_context(ctx: MessageContext) -> None:
    """Set the current message context."""
    global _current_context
    _current_context = ctx


def _get_context() -> Optional[MessageContext]:
    """Get the current message context."""
    return _current_context


def welcome(func: F) -> F:
    """Decorator for chat start handler.

    Called when a user opens the chat.

    Example:
        @aiui.welcome
        async def hi():
            await aiui.say("Hello! How can I help?")
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("welcome", wrapper)
    return func


def reply(func: F) -> F:
    """Decorator for message handler.

    Called when a user sends a message.

    Example:
        @aiui.reply
        async def go(message: str):
            await aiui.say(f"You said: {message}")

        # Or with full context:
        @aiui.reply
        async def go(msg: MessageContext):
            response = await my_llm(msg.text)
            await aiui.say(response)
    """
    # Inspect first parameter to decide what to pass
    # Use get_type_hints to resolve stringified annotations (PEP 563)
    _pass_text = False
    try:
        import typing
        hints = typing.get_type_hints(func)
        if hints:
            first_hint = next(iter(hints.values()), None)
            if first_hint is str:
                _pass_text = True
    except Exception:
        # Fallback: check raw annotations
        sig = inspect.signature(func)
        params = list(sig.parameters.values())
        if params:
            ann = params[0].annotation
            if ann is str or ann == "str":
                _pass_text = True

    @wraps(func)
    async def wrapper(msg: MessageContext):
        _set_context(msg)
        try:
            arg = msg.text if _pass_text else msg
            result = func(arg)
            if asyncio.iscoroutine(result):
                return await result
            return result
        finally:
            _set_context(None)

    register_callback("reply", wrapper)
    return func


def goodbye(func: F) -> F:
    """Decorator for chat end handler.

    Called when a session ends.

    Example:
        @aiui.goodbye
        async def bye():
            await aiui.say("Goodbye!")
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("goodbye", wrapper)
    return func


def cancel(func: F) -> F:
    """Decorator for stop/cancel handler.

    Called when user clicks stop.

    Example:
        @aiui.cancel
        async def stopped():
            await aiui.say("Cancelled.")
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("cancel", wrapper)
    return func


def button(name: str) -> Callable[[F], F]:
    """Decorator for action button handler.

    Called when user clicks an action button.

    Example:
        @aiui.button("retry")
        async def retry_action():
            await aiui.say("Retrying...")
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result

        register_callback(f"button:{name}", wrapper)
        return func

    return decorator


def login(func: F) -> F:
    """Decorator for login handler.

    Called when user attempts to log in.

    Example:
        @aiui.login
        async def auth(username, password):
            return verify(username, password)
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("login", wrapper)
    return func


def settings(func: F) -> F:
    """Decorator for settings update handler.

    Called when user changes settings.

    Example:
        @aiui.settings
        async def on_settings(new_settings):
            print(f"Settings updated: {new_settings}")
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("settings", wrapper)
    return func


def profiles(func: F) -> F:
    """Decorator for chat profiles provider.

    Returns list of available chat profiles.

    Example:
        @aiui.profiles
        def get_profiles():
            return [
                {"name": "General", "description": "General assistant"},
                {"name": "Code", "description": "Code helper"},
            ]
    """
    register_callback("profiles", func)
    return func


def starters(func: F) -> F:
    """Decorator for starter messages provider.

    Returns list of starter messages.

    Example:
        @aiui.starters
        def get_starters():
            return [
                {"label": "Hello", "message": "Say hello"},
                {"label": "Help", "message": "What can you do?"},
            ]
    """
    register_callback("starters", func)
    return func


def on(event: str) -> Callable[[F], F]:
    """Generic event decorator.

    Register a handler for any custom event.

    Example:
        @aiui.on("file_upload")
        async def handle_upload(file):
            print(f"Received file: {file.name}")

        @aiui.on("audio_chunk")
        async def handle_audio(chunk):
            process_audio(chunk)
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result

        register_callback(f"on:{event}", wrapper)
        return func

    return decorator


def page(
    id: str,
    *,
    title: str,
    icon: str = "📄",
    group: str = "Custom",
    description: str = "",
    order: int = 100,
) -> Callable[[F], F]:
    """Decorator to register a custom dashboard page.

    The decorated function serves as the page's API data handler.
    It should return a dict that will be served as JSON.

    Example::

        @aiui.page("metrics", title="My Metrics", icon="📊", group="Analytics")
        async def metrics_handler():
            return {"kpis": [{"label": "Users", "value": 42}]}

    Args:
        id: Unique page identifier
        title: Display title in sidebar
        icon: Emoji icon for sidebar
        group: Tab group name (e.g. 'Custom', 'Analytics')
        description: Brief subtitle shown in page header
        order: Sort order within group (lower = first)
    """
    def decorator(func: F) -> F:
        from praisonaiui.server import register_page
        register_page(
            id, title=title, icon=icon, group=group,
            description=description, handler=func, order=order,
        )
        return func

    return decorator


def resume(func: F) -> F:
    """Decorator for session resume handler.

    Called when a user resumes an existing session.

    Example:
        @aiui.resume
        async def on_resume(session):
            await aiui.say(f"Welcome back! You have {len(session.messages)} messages.")
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    register_callback("resume", wrapper)
    return func


# Message sending functions

async def say(content: str) -> None:
    """Send a message to the UI.

    Example:
        await aiui.say("Hello!")
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "message", "content": content})


async def stream(token: str) -> None:
    """Stream a token to the UI.

    Example:
        for token in tokens:
            await aiui.stream(token)
    """
    ctx = _get_context()
    if ctx:
        await ctx.stream(token)


# Alias for compatibility — examples use aiui.stream_token()
stream_token = stream


async def think(step: str) -> None:
    """Send a thinking/reasoning step to the UI.

    Example:
        await aiui.think("Analyzing the request...")
    """
    ctx = _get_context()
    if ctx:
        await ctx.think(step)


async def ask(question: str, options: list[str] = None, timeout: float = 300.0) -> str:
    """Ask the user a question and wait for response.

    This function sends an ask event to the UI and waits for the user
    to respond. The response is returned as a string.

    Args:
        question: The question to ask the user
        options: Optional list of choices to present
        timeout: Timeout in seconds (default 5 minutes)

    Returns:
        The user's response text, or empty string on timeout

    Example:
        answer = await aiui.ask("What's your name?")
        choice = await aiui.ask("Pick one:", options=["A", "B", "C"])
    """
    ctx = _get_context()
    if ctx:
        return await ctx.ask(question, options, timeout)
    return ""


async def tool(name: str, args: dict = None, result: Any = None) -> None:
    """Send a tool call event to the UI.

    Example:
        await aiui.tool("search", {"query": "python"}, result=["result1", "result2"])
    """
    ctx = _get_context()
    if ctx:
        await ctx.tool(name, args, result)


async def image(url: str, alt: str = "") -> None:
    """Send an image to the UI.

    Example:
        await aiui.image("https://example.com/image.png", "Example image")
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "image", "url": url, "alt": alt})


async def audio(url: str) -> None:
    """Send audio to the UI.

    Example:
        await aiui.audio("https://example.com/audio.mp3")
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "audio", "url": url})


async def video(url: str) -> None:
    """Send video to the UI.

    Example:
        await aiui.video("https://example.com/video.mp4")
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "video", "url": url})


async def file(url: str, name: str = "") -> None:
    """Send a file to the UI.

    Example:
        await aiui.file("https://example.com/doc.pdf", "document.pdf")
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "file", "url": url, "name": name})


async def action_buttons(buttons: list[dict]) -> None:
    """Send action buttons to the UI.

    Example:
        await aiui.action_buttons([
            {"name": "retry", "label": "Retry"},
            {"name": "cancel", "label": "Cancel"},
        ])
    """
    ctx = _get_context()
    if ctx and ctx._stream_queue:
        await ctx._stream_queue.put({"type": "actions", "buttons": buttons})
