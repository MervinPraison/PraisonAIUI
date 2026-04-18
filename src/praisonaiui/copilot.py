"""Copilot function support for PraisonAIUI.

This module provides client-side function registration so an embedded copilot
can call host-page JavaScript functions (e.g., navigate_to("/settings")).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Awaitable, Callable, Dict, List, Optional

# Global registry of copilot functions
_copilot_functions: Dict[str, "CopilotFunction"] = {}
_copilot_handlers: List[Callable] = []


@dataclass
class CopilotFunctionParameter:
    """Parameter definition for a copilot function."""

    name: str
    type: str  # "string", "number", "boolean", "object", "array"
    description: str
    required: bool = True
    enum: Optional[List[Any]] = None
    default: Optional[Any] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON schema format."""
        schema = {
            "type": self.type,
            "description": self.description
        }

        if self.enum is not None:
            schema["enum"] = self.enum

        if self.default is not None:
            schema["default"] = self.default

        return schema


@dataclass
class CopilotFunction:
    """Client-side function that can be called by a copilot.

    Registers a function that the embedded copilot can invoke, with the
    result sent back to the copilot via POST request.

    Example:
        @copilot_function("navigate_to", "Navigate to a page")
        def navigate(url: str):
            # Host page navigation logic
            window.location.href = url
            return {"success": True}
    """

    name: str
    description: str
    parameters: List[CopilotFunctionParameter] = field(default_factory=list)
    handler: Optional[Callable] = None

    def __post_init__(self):
        """Register this function globally."""
        _copilot_functions[self.name] = self

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON schema format for OpenAI-style tool calls."""
        properties = {}
        required = []

        for param in self.parameters:
            properties[param.name] = param.to_dict()
            if param.required:
                required.append(param.name)

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                }
            }
        }

    async def call(self, arguments: Dict[str, Any]) -> Any:
        """Call the function with given arguments.

        Args:
            arguments: Function arguments from the copilot

        Returns:
            Function result
        """
        if not self.handler:
            raise RuntimeError(f"No handler registered for function '{self.name}'")

        # Call handler (can be sync or async)
        if hasattr(self.handler, '__call__'):
            result = self.handler(**arguments)
            if hasattr(result, '__await__'):
                result = await result
            return result
        else:
            raise RuntimeError(f"Invalid handler for function '{self.name}'")


def copilot_function(
    name: str,
    description: str,
    parameters: Optional[List[CopilotFunctionParameter]] = None
):
    """Decorator to register a copilot function.

    Args:
        name: Function name (exposed to copilot)
        description: Function description
        parameters: List of function parameters

    Example:
        @copilot_function(
            "navigate_to",
            "Navigate to a specific page",
            [CopilotFunctionParameter("url", "string", "URL to navigate to")]
        )
        async def navigate(url: str):
            # Implementation
            return {"success": True, "url": url}
    """
    def decorator(func: Callable) -> Callable:
        # Create and register the copilot function
        CopilotFunction(
            name=name,
            description=description,
            parameters=parameters or [],
            handler=func
        )

        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await func(*args, **kwargs)

        return wrapper

    return decorator


def register_copilot_function(func: CopilotFunction) -> None:
    """Register a copilot function.

    Args:
        func: CopilotFunction instance to register
    """
    _copilot_functions[func.name] = func


def get_copilot_functions() -> Dict[str, CopilotFunction]:
    """Get all registered copilot functions.

    Returns:
        Dictionary of function name to CopilotFunction
    """
    return _copilot_functions.copy()


def get_copilot_function(name: str) -> Optional[CopilotFunction]:
    """Get a specific copilot function by name.

    Args:
        name: Function name

    Returns:
        CopilotFunction instance or None if not found
    """
    return _copilot_functions.get(name)


def on_copilot_function_call(handler: Callable[[str, Dict[str, Any]], Awaitable[Any]]):
    """Register a handler for copilot function calls.

    The handler receives the function name and arguments, and should return
    the function result.

    Args:
        handler: Async function that handles copilot function calls

    Example:
        @on_copilot_function_call
        async def handle_copilot_call(function_name: str, arguments: dict):
            copilot_func = get_copilot_function(function_name)
            if copilot_func:
                return await copilot_func.call(arguments)
            else:
                return {"error": f"Unknown function: {function_name}"}
    """
    _copilot_handlers.append(handler)
    return handler


async def call_copilot_function(name: str, arguments: Dict[str, Any]) -> Any:
    """Call a copilot function with arguments.

    Args:
        name: Function name
        arguments: Function arguments

    Returns:
        Function result

    Raises:
        ValueError: If function not found
    """
    # First try direct function call
    copilot_func = get_copilot_function(name)
    if copilot_func:
        return await copilot_func.call(arguments)

    # Then try registered handlers
    for handler in _copilot_handlers:
        try:
            result = await handler(name, arguments)
            if result is not None:
                return result
        except Exception as e:
            import logging
            logging.error(f"Error in copilot handler: {e}")
            continue  # Try next handler

    raise ValueError(f"No handler found for copilot function: {name}")


# Built-in copilot functions
@copilot_function(
    "get_page_info",
    "Get information about the current page",
    []
)
async def get_page_info() -> Dict[str, Any]:
    """Get basic page information."""
    return {
        "title": "PraisonAIUI Chat",
        "url": "/",
        "timestamp": "TODO: implement in frontend"
    }


@copilot_function(
    "show_notification",
    "Show a notification to the user",
    [
        CopilotFunctionParameter("message", "string", "Notification message"),
        CopilotFunctionParameter("type", "string", "Notification type", enum=["info", "success", "warning", "error"]),
        CopilotFunctionParameter("duration", "number", "Duration in ms", required=False, default=3000)
    ]
)
async def show_notification(message: str, type: str = "info", duration: int = 3000) -> Dict[str, Any]:
    """Show a notification (implemented in frontend)."""
    return {
        "action": "show_notification",
        "message": message,
        "type": type,
        "duration": duration
    }
