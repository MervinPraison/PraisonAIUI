"""Interactive message actions with server-side callback hooks.

This module provides a first-class Action system where agents can attach
clickable buttons to individual messages. When clicked, registered Python
callbacks receive the Action + Message context and can respond.

Example:
    import praisonaiui as aiui

    @aiui.action_callback("approve_pr")
    async def on_approve(action: aiui.Action):
        await action.remove()  # hide the button after click
        await aiui.Message(content=f"✅ PR #{action.payload['pr_number']} approved").send()

    @aiui.reply
    async def handler(message):
        await aiui.Message(
            content="Approve PR #42?",
            actions=[
                aiui.Action(name="approve_pr", label="Approve", payload={"pr_number": 42}),
                aiui.Action(name="reject_pr",  label="Reject",  payload={"pr_number": 42}),
            ],
        ).send()
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Awaitable, Callable, Dict, Optional

from praisonaiui.server import MessageContext

# Global registry for action callbacks
# Key: action name, Value: async callback function
_ACTION_REGISTRY: Dict[str, Callable[["Action"], Awaitable[None]]] = {}


@dataclass
class Action:
    """An interactive action button attached to a message.

    Attributes:
        name: Unique identifier for the action (used for callback registration)
        label: Display text for the button
        payload: Optional data passed to the callback (default: None)
        icon: Optional icon name (default: None)
        variant: Button style variant (default: "secondary")
        id: Auto-generated unique ID for this action instance
        message_id: ID of the message this action belongs to (set automatically)

    Example:
        action = Action(
            name="approve_pr",
            label="Approve",
            payload={"pr_number": 42},
            icon="check",
            variant="primary"
        )
    """

    name: str
    label: str
    payload: Optional[Dict[str, Any]] = None
    icon: Optional[str] = None
    variant: str = "secondary"

    # Auto-generated fields
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    message_id: Optional[str] = None

    # Internal state
    _context: Optional[MessageContext] = field(default=None, repr=False)

    def __post_init__(self):
        """Initialize action with context from current callback."""
        from praisonaiui.callbacks import _get_context
        self._context = _get_context()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize action to deterministic dict format.

        Returns dict with keys sorted alphabetically for stable serialization.
        This ensures the action survives persistence and page reloads.

        Returns:
            Dict representation suitable for JSON serialization
        """
        result = {
            "id": self.id,
            "name": self.name,
            "label": self.label,
            "variant": self.variant,
        }

        # Add optional fields only if they have values (deterministic output)
        if self.payload is not None:
            result["payload"] = self.payload
        if self.icon is not None:
            result["icon"] = self.icon
        if self.message_id is not None:
            result["message_id"] = self.message_id

        return result

    async def remove(self) -> None:
        """Remove this action button from the rendered message.

        Emits a server-side event that removes the button from the UI.
        The action becomes non-functional after removal.
        """
        if not self._context or not self._context._stream_queue:
            return

        await self._context._stream_queue.put({
            "type": "action_remove",
            "action_id": self.id,
            "message_id": self.message_id,
        })


def action_callback(name: str) -> Callable[[Callable], Callable]:
    """Decorator to register an async action callback handler.

    The decorated function will be called when an action with the given name
    is clicked by the user. The function receives an Action instance with
    the original payload and context.

    Args:
        name: The action name to register for (must match Action.name)

    Returns:
        Decorator function that registers the callback

    Example:
        @action_callback("approve_pr")
        async def on_approve(action: Action):
            pr_number = action.payload["pr_number"]
            await action.remove()  # Hide button after click
            await Message(content=f"✅ PR #{pr_number} approved").send()

    Raises:
        ValueError: If name is empty or callback is not async
    """
    if not name:
        raise ValueError("Action name cannot be empty")

    def decorator(
        func: Callable[["Action"], Awaitable[None]]
    ) -> Callable[["Action"], Awaitable[None]]:
        if not callable(func):
            raise ValueError("Action callback must be callable")
        import inspect
        if not inspect.iscoroutinefunction(func):
            raise ValueError("Action callback must be an async function (coroutine)")

        # Check for duplicate registration and warn
        if name in _ACTION_REGISTRY:
            import warnings
            warnings.warn(
                f"Action callback '{name}' is already registered and will be overwritten",
                UserWarning,
                stacklevel=3,
            )

        # Register the callback in global registry
        _ACTION_REGISTRY[name] = func

        @wraps(func)
        async def wrapper(action: "Action") -> None:
            return await func(action)

        return wrapper

    return decorator


def register_action_callback(
    name: str, callback: Callable[["Action"], Awaitable[None]]
) -> None:
    """Programmatically register an action callback (alternative to decorator).

    Args:
        name: The action name to register for
        callback: Async function that handles the action

    Raises:
        ValueError: If name is empty or callback is not callable

    Example:
        async def my_handler(action: Action):
            print(f"Action {action.name} clicked with payload: {action.payload}")

        register_action_callback("my_action", my_handler)
    """
    if not name:
        raise ValueError("Action name cannot be empty")
    if not callable(callback):
        raise ValueError("Callback must be callable")

    _ACTION_REGISTRY[name] = callback


async def dispatch_action_callback(
    action_name: str,
    action_id: str,
    payload: Optional[Dict[str, Any]] = None,
    message_id: Optional[str] = None,
    session_id: Optional[str] = None,
    stream_queue: Optional[asyncio.Queue] = None
) -> None:
    """Dispatch an action callback by name.

    Called by the server endpoint when an action button is clicked.
    Creates an Action instance with the provided data and calls the registered callback.

    Args:
        action_name: Name of the action (must be registered)
        action_id: Unique ID of the clicked action instance
        payload: Optional data from the original action
        message_id: ID of the message containing the action
        session_id: Session ID for context
        stream_queue: Stream queue for server-side events (for action.remove())

    Raises:
        ValueError: If no callback is registered for the action name (HTTP 404 equivalent)
    """
    if action_name not in _ACTION_REGISTRY:
        raise ValueError(f"No callback registered for action '{action_name}'")

    callback = _ACTION_REGISTRY[action_name]

    # Create a MessageContext for server-side side effects (like action.remove())
    if stream_queue is None:
        stream_queue = asyncio.Queue()

    msg_context = MessageContext(
        text="",  # Not needed for action dispatch
        session_id=session_id or "",
        agent_name="action_callback",
    )
    msg_context._stream_queue = stream_queue

    # Set the context for the duration of the callback
    from praisonaiui.callbacks import _set_context
    _set_context(msg_context)

    try:
        # Reconstruct the action for the callback
        action = Action(
            name=action_name,
            label="",  # Label not needed for callback dispatch
            payload=payload,
            id=action_id,
            message_id=message_id,
        )
        # Set the context directly on the action
        action._context = msg_context

        await callback(action)
    finally:
        # Clear the context after callback execution
        _set_context(None)


def get_registered_actions() -> Dict[str, Callable[["Action"], Awaitable[None]]]:
    """Get all registered action callbacks (for testing/debugging).

    Returns:
        Copy of the action registry dict
    """
    return _ACTION_REGISTRY.copy()


def clear_action_registry() -> None:
    """Clear all registered action callbacks (for testing).

    Warning: This will remove all action handlers. Use only in tests.
    """
    global _ACTION_REGISTRY
    _ACTION_REGISTRY.clear()
