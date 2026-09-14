"""Run voice tool-calls through the PraisonAI agent tool registry."""

from __future__ import annotations

import json
import os
from typing import Any, Callable

from integrations.voice.tools import execute_tool, register_tool

_agent: Any | None = None
_session_agents: dict[str, Any] = {}


def _tool_name(tool: Any) -> str | None:
    for attr in ("name", "__name__"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    fn = getattr(tool, "func", None) or getattr(tool, "function", None)
    if fn is not None:
        return _tool_name(fn)
    return None


def _build_voice_agent(*, session_id: str | None = None):
    from praisonaiagents import Agent
    from praisonaiagents.config.feature_configs import MemoryConfig
    from praisonaiagents.escalation.loop_guard import LoopGuard, LoopGuardConfig

    from integrations.voice.session_memory import memory_enabled
    from integrations.voice.tools import echo_message, get_current_time

    register_tool("get_current_time", get_current_time)
    register_tool("echo_message", echo_message)

    tools: list[Any] = [get_current_time, echo_message]
    extra = os.getenv("VOICE_AGENT_EXTRA_TOOLS", "").strip()
    if extra == "meeting_search":
        try:
            from praisonai_tools.tools.meeting_tools import search_meetings

            tools.append(search_meetings)
            register_tool("search_meetings", search_meetings)
        except ImportError:
            pass

    memory_cfg = None
    if memory_enabled() and session_id:
        memory_cfg = MemoryConfig(
            history=True,
            session_id=session_id,
            history_limit=int(os.getenv("VOICE_MEMORY_HISTORY_LIMIT", "20")),
        )

    agent = Agent(
        name="Voice Assistant",
        instructions=(
            "You help with voice and phone agent demos. "
            "Use tools when the caller asks for the time, wants a message echoed, "
            "or asks about past meetings."
        ),
        model=os.getenv("VOICE_AGENT_MODEL", "gpt-4o-mini"),
        tools=tools,
        memory=memory_cfg or False,
    )
    max_turn_sec = float(os.getenv("VOICE_AGENT_LOOP_GUARD_MAX_SEC", "600"))
    agent._loop_guard = LoopGuard(LoopGuardConfig(enabled=True, max_time_per_turn=max_turn_sec))

    for tool in tools:
        name = _tool_name(tool)
        if name:
            register_tool(name, _callable_tool(tool))
    return agent


def get_voice_agent(session_id: str | None = None):
    """Lazy-load the voice assistant (optionally bound to a PraisonAI session)."""
    global _agent
    if session_id:
        cached = _session_agents.get(session_id)
        if cached is not None:
            return cached
        agent = _build_voice_agent(session_id=session_id)
        _session_agents[session_id] = agent
        return agent
    if _agent is not None:
        return _agent
    _agent = _build_voice_agent()
    return _agent


def _callable_tool(tool: Any) -> Callable[..., Any]:
    fn = getattr(tool, "func", None) or getattr(tool, "run", None) or tool
    return fn  # type: ignore[return-value]


def execute_voice_tool(
    name: str,
    parameters: dict[str, Any] | None,
    *,
    session_id: str | None = None,
) -> str:
    """Execute via agent tool registry, then fall back to static registry."""
    params = parameters or {}
    agent = get_voice_agent(session_id)
    for tool in agent.tools or []:
        tname = _tool_name(tool)
        if tname != name:
            continue
        fn = _callable_tool(tool)
        try:
            result = fn(**params)
        except TypeError:
            try:
                result = fn(params)
            except Exception as exc:  # noqa: BLE001
                return json.dumps({"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": str(exc)})
        if isinstance(result, str):
            return result
        return json.dumps(result)
    return execute_tool(name, params)


def list_registered_tool_names() -> list[str]:
    agent = get_voice_agent()
    names: list[str] = []
    for tool in agent.tools or []:
        tname = _tool_name(tool)
        if tname:
            names.append(tname)
    return names


def build_assistant_request_response(settings: Any) -> dict[str, Any]:
    """Return provider assistant config for dynamic assistant-request events."""
    if settings.default_assistant_id and not os.getenv("VOICE_DYNAMIC_ASSISTANT", "").lower() in (
        "1",
        "true",
        "yes",
    ):
        return {"assistantId": settings.default_assistant_id}

    tool_names = list_registered_tool_names()
    assistant: dict[str, Any] = {
        "name": "Praison Voice Assistant",
        "firstMessage": os.getenv("VOICE_FIRST_MESSAGE", "Hello! How can I help you today?"),
        "model": {
            "provider": os.getenv("VOICE_MODEL_PROVIDER", "openai"),
            "model": os.getenv("VOICE_AGENT_MODEL", "gpt-4o-mini"),
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a helpful voice assistant. When asked for the time, call get_current_time. "
                        "When asked to repeat or echo text, call echo_message with the message parameter. "
                        "Available tools: "
                        + ", ".join(tool_names or ["get_current_time", "echo_message"])
                    ),
                }
            ],
        },
    }
    if settings.webhook_url and settings.server_url_secret:
        assistant["server"] = {
            "url": settings.webhook_url,
            "headers": {"X-Voice-Webhook-Secret": settings.server_url_secret},
        }
    return {"assistant": assistant}
