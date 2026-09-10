"""Tools callable from voice provider ``tool-calls`` webhook events."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable


def get_current_time() -> dict[str, Any]:
    """Return current UTC time for voice agent demos."""
    now = datetime.now(timezone.utc).isoformat()
    return {"utc": now, "spoken": f"The current UTC time is {now}"}


def echo_message(message: str = "") -> dict[str, Any]:
    """Echo a message back to the caller."""
    text = message.strip() or "nothing"
    return {"message": text, "spoken": f"You said {text}"}


def demo_tool_reply(text: str) -> str | None:
    """Fast path for common voice tool queries — no LLM round-trip."""
    lower = text.lower().strip()
    if any(p in lower for p in ("what time", "current time", "tell me the time", "time is it")):
        return str(get_current_time()["spoken"])
    if lower.startswith("echo "):
        return str(echo_message(text[5:])["spoken"])
    if lower.startswith("repeat "):
        return str(echo_message(text[7:])["spoken"])
    return None


def openai_tool_schemas() -> list[dict[str, Any]]:
    """OpenAI function schemas for Speech Engine / voice LLM paths."""
    return [
        {
            "type": "function",
            "function": {
                "name": "get_current_time",
                "description": "Return the current UTC time when the caller asks for the time.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "echo_message",
                "description": "Repeat or echo back a phrase the caller wants repeated.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "The text to echo back to the caller",
                        }
                    },
                    "required": ["message"],
                },
            },
        },
    ]


def tool_result_for_voice(raw_result: str) -> str:
    """Convert tool JSON output to speakable voice text."""
    try:
        data = json.loads(raw_result)
    except json.JSONDecodeError:
        return raw_result.strip() or "Done."
    if isinstance(data, dict):
        spoken = data.get("spoken")
        if spoken:
            return str(spoken)
        err = data.get("error")
        if err:
            return f"Sorry, {err}"
    return raw_result.strip() or "Done."


_TOOL_REGISTRY: dict[str, Callable[..., Any]] = {
    "get_current_time": get_current_time,
    "echo_message": echo_message,
}


def register_tool(name: str, fn: Callable[..., Any]) -> None:
    _TOOL_REGISTRY[name] = fn


def execute_tool(name: str, parameters: dict[str, Any] | None) -> str:
    """Run a registered tool and return a JSON string for the provider."""
    fn = _TOOL_REGISTRY.get(name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool: {name}"})
    try:
        result = fn(**(parameters or {}))
        if isinstance(result, str):
            return result
        return json.dumps(result)
    except TypeError:
        try:
            result = fn(parameters or {})
            return json.dumps(result)
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": str(exc)})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})
