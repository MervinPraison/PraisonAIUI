"""PraisonAI provider — default backend with full feature integration.

Bridges PraisonAI Agents (streaming, tools, memory, knowledge, hooks, approval)
to the PraisonAIUI ``RunEvent`` protocol.

Two operating modes:
1. **Callback mode** (default): Uses ``@aiui.reply`` handler + queue system
2. **Direct mode**: When no callback registered, uses PraisonAI Agent directly

The provider attaches to PraisonAI's ``StreamEventEmitter`` for real-time
token-by-token streaming and ``HookRegistry`` for tool/agent lifecycle events.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# StreamEvent → RunEvent bridge
# ---------------------------------------------------------------------------

def _stream_event_to_run_event(stream_event) -> Optional[RunEvent]:
    """Translate a praisonaiagents StreamEvent to a RunEvent."""
    from praisonaiagents.streaming import StreamEventType as SET

    mapping = {
        SET.DELTA_TEXT: lambda e: RunEvent(
            type=RunEventType.REASONING_STEP if e.is_reasoning
            else RunEventType.RUN_CONTENT,
            token=e.content,
            step=e.content if e.is_reasoning else None,
        ),
        SET.DELTA_TOOL_CALL: lambda e: RunEvent(
            type=RunEventType.TOOL_CALL_STARTED,
            name=e.tool_call.get("name") if e.tool_call else None,
            args=e.tool_call.get("arguments") if e.tool_call else None,
            tool_call_id=e.tool_call.get("id") if e.tool_call else str(uuid.uuid4()),
        ),
        SET.TOOL_CALL_END: lambda e: RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name=e.tool_call.get("name") if e.tool_call else None,
            result=e.tool_call.get("result") if e.tool_call else None,
            tool_call_id=e.tool_call.get("id") if e.tool_call else None,
        ),
        SET.FIRST_TOKEN: lambda e: RunEvent(
            type=RunEventType.RUN_CONTENT,
            token=e.content or "",
            extra_data={"ttft": True},
        ),
        SET.REQUEST_START: lambda e: RunEvent(
            type=RunEventType.RUN_STARTED,
        ),
        SET.STREAM_END: lambda e: None,  # Handled separately
        SET.ERROR: lambda e: RunEvent(
            type=RunEventType.RUN_ERROR,
            error=e.error or "Streaming error",
        ),
    }

    handler = mapping.get(stream_event.type)
    if handler:
        return handler(stream_event)
    return None


# ---------------------------------------------------------------------------
# Hook → RunEvent bridge
# ---------------------------------------------------------------------------

def _hook_event_to_run_events(hook_event_name: str, event_data) -> List[RunEvent]:
    """Translate HookRegistry lifecycle events to RunEvent list."""
    events = []

    if hook_event_name == "before_tool":
        events.append(RunEvent(
            type=RunEventType.TOOL_CALL_STARTED,
            name=getattr(event_data, "tool_name", None),
            args=getattr(event_data, "arguments", None),
        ))
    elif hook_event_name == "after_tool":
        events.append(RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name=getattr(event_data, "tool_name", None),
            result=getattr(event_data, "result", None),
            error=getattr(event_data, "error", None),
        ))
    elif hook_event_name == "before_agent":
        events.append(RunEvent(
            type=RunEventType.RUN_STARTED,
            agent_name=getattr(event_data, "agent_name", None),
            agent_id=getattr(event_data, "agent_id", None),
        ))
    elif hook_event_name == "after_agent":
        events.append(RunEvent(
            type=RunEventType.RUN_COMPLETED,
            agent_name=getattr(event_data, "agent_name", None),
            content=getattr(event_data, "result", None),
        ))

    return events


# Map legacy queue event types → RunEventType
_LEGACY_MAP: Dict[str, RunEventType] = {
    "token": RunEventType.RUN_CONTENT,
    "message": RunEventType.RUN_CONTENT,
    "thinking": RunEventType.REASONING_STEP,
    "tool_call": RunEventType.TOOL_CALL_STARTED,
    "ask": RunEventType.RUN_PAUSED,
    "error": RunEventType.RUN_ERROR,
    "cancelled": RunEventType.RUN_CANCELLED,
}


class PraisonAIProvider(BaseProvider):
    """Default provider with full PraisonAI Agents integration.

    Features surfaced:
    - **Streaming**: Real-time token-by-token via StreamEventEmitter
    - **Tool calls**: Start/complete lifecycle with args and results
    - **Reasoning**: Thinking/chain-of-thought steps (is_reasoning flag)
    - **Memory**: Read/write events via hooks
    - **Approval**: Human-in-the-loop via ask events
    - **Multi-agent**: Team run start/complete with agent_name/agent_id
    - **Metrics**: TTFT, stream duration, tokens/sec via StreamMetrics

    Two modes:
    1. Callback mode: ``@aiui.reply`` handler registered → wraps queue events
    2. Direct mode: No handler → uses PraisonAI Agent directly with streaming
    """

    def __init__(self, agent=None, agents=None, **agent_kwargs):
        """Initialize with optional pre-configured agent(s).

        Args:
            agent: Single pre-configured Agent instance.
            agents: List of Agent instances for multi-agent scenarios.
            **agent_kwargs: Passed to Agent() if no agent provided.
        """
        self._agent = agent
        self._agents = agents or []
        self._agent_kwargs = agent_kwargs
        # Per-session agent cache: each session gets its own Agent
        # so chat_history is isolated between sessions
        self._session_agents: Dict[str, Any] = {}

    def _get_or_create_agent(
        self,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
    ):
        """Get or lazily create a PraisonAI Agent.

        When session_id is provided and no named/pre-configured agent
        is matched, a per-session Agent is created so that each session
        has its own isolated chat_history.
        """
        # If specific agent requested and we have a list
        if agent_name and self._agents:
            for a in self._agents:
                if getattr(a, "name", None) == agent_name:
                    return a

        # Use provided single agent (backward compat)
        if self._agent is not None:
            return self._agent

        # Per-session agent: return cached or create new
        if session_id and session_id in self._session_agents:
            return self._session_agents[session_id]

        # Lazy-create agent for this session
        try:
            from praisonaiagents import Agent
        except ImportError:
            return None

        kwargs = {
            "name": "Assistant",
            "instructions": "You are a helpful assistant. Use markdown formatting.",
            "memory": True,
        }
        kwargs.update(self._agent_kwargs)
        agent = Agent(**kwargs)

        # Cache per session if session_id provided
        if session_id:
            self._session_agents[session_id] = agent
        else:
            # No session — store as singleton fallback
            self._agent = agent

        return agent

    async def run(
        self,
        message: str,
        *,
        session_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        **kwargs: Any,
    ) -> AsyncIterator[RunEvent]:
        # Lazy import to avoid circular deps
        from praisonaiui.server import _callbacks

        reply_callback = _callbacks.get("reply")
        if reply_callback:
            # --- Callback mode: use existing @aiui.reply handler ---
            async for event in self._run_callback_mode(
                message, reply_callback, session_id, agent_name
            ):
                yield event
        else:
            # --- Direct mode: use PraisonAI Agent directly ---
            async for event in self._run_direct_mode(
                message, session_id, agent_name, **kwargs
            ):
                yield event

    async def _run_callback_mode(
        self,
        message: str,
        reply_callback,
        session_id: Optional[str],
        agent_name: Optional[str],
    ) -> AsyncIterator[RunEvent]:
        """Execute via @aiui.reply callback, translating queue events → RunEvent."""
        from praisonaiui.server import MessageContext, _active_tasks

        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name=agent_name)

        msg = MessageContext(
            text=message,
            session_id=session_id,
            agent_name=agent_name,
        )
        stream_queue: asyncio.Queue = asyncio.Queue()
        msg._stream_queue = stream_queue

        async def _run_cb():
            try:
                result = reply_callback(msg)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:
                await stream_queue.put({"type": "error", "error": str(exc)})
            finally:
                await stream_queue.put({"type": "done"})

        task = asyncio.create_task(_run_cb())
        if session_id:
            _active_tasks[session_id] = task

        full_response = ""
        try:
            while True:
                try:
                    event = await asyncio.wait_for(stream_queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    yield RunEvent(type=RunEventType.RUN_ERROR, error="Timeout")
                    break

                evt_type = event.get("type", "")
                if evt_type == "done":
                    break
                if evt_type == "cancelled":
                    yield RunEvent(type=RunEventType.RUN_CANCELLED)
                    break

                # Map queue events → RunEvent
                if evt_type == "token":
                    tok = event.get("token", "")
                    full_response += tok
                    yield RunEvent(type=RunEventType.RUN_CONTENT, token=tok)
                elif evt_type == "message":
                    content = event.get("content", "")
                    if content:
                        if full_response:
                            full_response += "\n"
                        full_response += content
                    yield RunEvent(type=RunEventType.RUN_CONTENT, content=content)
                elif evt_type == "thinking":
                    yield RunEvent(type=RunEventType.REASONING_STEP, step=event.get("step", ""))
                elif evt_type == "tool_call":
                    yield RunEvent(
                        type=RunEventType.TOOL_CALL_STARTED,
                        name=event.get("name"),
                        args=event.get("args"),
                        result=event.get("result"),
                    )
                elif evt_type == "tool_result":
                    yield RunEvent(
                        type=RunEventType.TOOL_CALL_COMPLETED,
                        name=event.get("name"),
                        result=event.get("result"),
                        error=event.get("error"),
                    )
                elif evt_type == "ask":
                    yield RunEvent(
                        type=RunEventType.RUN_PAUSED,
                        extra_data={
                            "question": event.get("question", ""),
                            "options": event.get("options", []),
                        },
                    )
                elif evt_type == "error":
                    yield RunEvent(type=RunEventType.RUN_ERROR, error=event.get("error", "Unknown"))
                elif evt_type == "memory_start":
                    yield RunEvent(type=RunEventType.MEMORY_UPDATE_STARTED)
                elif evt_type == "memory_done":
                    yield RunEvent(type=RunEventType.MEMORY_UPDATE_COMPLETED)
                elif evt_type == "memory":
                    yield RunEvent(type=RunEventType.UPDATING_MEMORY, extra_data=event)
                else:
                    mapped = _LEGACY_MAP.get(evt_type)
                    if mapped:
                        yield RunEvent(type=mapped, extra_data=event)
                    else:
                        yield RunEvent(type=RunEventType.RUN_CONTENT, extra_data=event)
        finally:
            if session_id:
                _active_tasks.pop(session_id, None)

        if not task.done():
            await task

        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=full_response)

    async def _run_direct_mode(
        self,
        message: str,
        session_id: Optional[str],
        agent_name: Optional[str],
        **kwargs: Any,
    ) -> AsyncIterator[RunEvent]:
        """Execute via PraisonAI Agent directly with streaming bridge."""
        agent = self._get_or_create_agent(agent_name, session_id)
        if agent is None:
            # No praisonaiagents installed — echo fallback
            yield RunEvent(type=RunEventType.RUN_STARTED)
            yield RunEvent(type=RunEventType.RUN_CONTENT, token=f"Echo: {message}")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"Echo: {message}")
            return

        yield RunEvent(
            type=RunEventType.RUN_STARTED,
            agent_name=getattr(agent, "name", agent_name),
            agent_id=getattr(agent, "agent_id", None),
        )

        # Set up a queue to bridge streaming events → RunEvent
        event_queue: asyncio.Queue = asyncio.Queue()

        # Attach streaming callback to the agent's emitter
        try:
            from praisonaiagents.streaming import StreamEventType as SET  # noqa: F811

            _loop = asyncio.get_running_loop()

            def _on_stream_event(stream_event):
                """Sync callback from StreamEventEmitter → queue (thread-safe)."""
                run_evt = _stream_event_to_run_event(stream_event)
                if run_evt:
                    _loop.call_soon_threadsafe(event_queue.put_nowait, run_evt)

            emitter = agent.stream_emitter
            emitter.add_callback(_on_stream_event)
            emitter.enable_metrics()
            _has_streaming = True
        except (ImportError, AttributeError):
            _has_streaming = False
            _on_stream_event = None

        # Attach hook callbacks if agent has hooks
        _hook_callback = None
        try:
            from praisonaiagents.hooks import HookEvent

            if hasattr(agent, "hooks") and agent.hooks is not None:
                hooks = agent.hooks

                def _on_hook(event_data, event_name=None):
                    """Hook callback → queue."""
                    if event_name:
                        for run_evt in _hook_event_to_run_events(event_name, event_data):
                            try:
                                event_queue.put_nowait(run_evt)
                            except Exception:
                                pass

                # Register hooks for key lifecycle events
                for hook_name in ["before_tool", "after_tool"]:
                    try:
                        hook_event = getattr(HookEvent, hook_name.upper(), None)
                        if hook_event:
                            hooks.on(hook_event)(
                                lambda data, n=hook_name: _on_hook(data, n)
                            )
                            _hook_callback = True
                    except Exception:
                        pass
        except ImportError:
            pass

        # Run agent.chat in a background thread while draining the
        # event queue concurrently so tokens stream in real-time.
        full_response = ""
        _chat_error = None
        _streamed_tokens = 0

        async def _run_chat():
            nonlocal full_response, _chat_error
            try:
                response = await asyncio.to_thread(agent.chat, message, stream=True)
                full_response = str(response)
            except Exception as exc:
                _chat_error = exc
            finally:
                # Sentinel to tell the drain loop the chat is done
                await event_queue.put(None)

        chat_task = asyncio.create_task(_run_chat())

        # Drain tokens as they arrive from the streaming callback
        while True:
            try:
                run_evt = await asyncio.wait_for(event_queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                break
            if run_evt is None:  # Sentinel — chat finished
                break
            _streamed_tokens += 1
            yield run_evt

        # Drain any remaining events that arrived after sentinel
        while not event_queue.empty():
            try:
                run_evt = event_queue.get_nowait()
                if run_evt is not None:
                    yield run_evt
            except asyncio.QueueEmpty:
                break

        await chat_task

        if _chat_error:
            yield RunEvent(type=RunEventType.RUN_ERROR, error=str(_chat_error))
            return

        # If no streaming events were captured, emit the full response
        if _streamed_tokens == 0:
            yield RunEvent(type=RunEventType.RUN_CONTENT, content=full_response)

        # Emit metrics if available
        try:
            if _has_streaming:
                metrics = agent.stream_emitter.get_metrics()
                if metrics:
                    yield RunEvent(
                        type=RunEventType.RUN_CONTENT,
                        extra_data={"metrics": metrics.to_dict()},
                    )
        except Exception:
            pass

        # Clean up callbacks
        try:
            if _on_stream_event and _has_streaming:
                agent.stream_emitter.remove_callback(_on_stream_event)
        except Exception:
            pass

        yield RunEvent(
            type=RunEventType.RUN_COMPLETED,
            content=full_response,
            agent_name=getattr(agent, "name", agent_name),
        )

        # Auto-store conversation turn to memory for long-term recall
        if hasattr(agent, 'memory') and agent.memory and hasattr(agent, 'store_memory'):
            try:
                summary = f"User: {message}\nAssistant: {full_response[:500]}"
                await asyncio.to_thread(agent.store_memory, summary)
            except Exception:
                pass  # Memory store failures should not break chat

    async def list_agents(self) -> List[Dict[str, Any]]:
        """List agents from both the UI registry and configured agents."""
        from praisonaiui.server import _agents
        agents = [
            {"name": info["name"], "created_at": info.get("created_at")}
            for info in _agents.values()
        ]
        # Add configured agents
        for a in self._agents:
            name = getattr(a, "name", "Unknown")
            if not any(ag["name"] == name for ag in agents):
                agents.append({"name": name})
        if self._agent:
            name = getattr(self._agent, "name", "Default")
            if not any(ag["name"] == name for ag in agents):
                agents.append({"name": name})
        return agents

    async def health(self) -> Dict[str, Any]:
        """Health check with PraisonAI backend info."""
        info: Dict[str, Any] = {
            "status": "ok",
            "provider": "PraisonAIProvider",
        }
        try:
            import praisonaiagents
            info["praisonai_agents"] = True
            info["praisonai_version"] = getattr(praisonaiagents, "__version__", "unknown")
        except ImportError:
            info["praisonai_agents"] = False
        return info
