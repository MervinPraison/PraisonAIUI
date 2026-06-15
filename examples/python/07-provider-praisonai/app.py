"""Full-featured PraisonAI Provider Example.

Demonstrates the protocol-driven provider architecture.
Any class implementing BaseProvider can be plugged in as the AI backend.

What's New (vs dashboard/):
    • Custom BaseProvider subclass — full control over agent execution
    • RunEvent protocol — token streaming, tool calls, reasoning steps
    • Streaming metrics (TTFT, tokens/sec)
    • Tool definitions (get_weather, calculate)

Requires: pip install praisonai
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import asyncio

import praisonaiui as aiui
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

# === Option 1: Provider-based (Direct Mode) ===
# Uses PraisonAI Agent directly with streaming bridge

class FullFeaturedProvider(BaseProvider):
    """Provider showcasing all PraisonAI features via the RunEvent protocol."""

    def __init__(self):
        self._agents = {}

    def _get_agent(self, name: str = "Assistant"):
        if name not in self._agents:
            try:
                from praisonaiagents import Agent
            except ImportError:
                raise ImportError("pip install praisonai")

            tools = self._get_tools()
            self._agents[name] = Agent(
                name=name,
                instructions=(
                    "You are a helpful assistant with access to tools. "
                    "Think step by step. Use markdown formatting. "
                    "When asked about the weather, use the get_weather tool. "
                    "When asked to calculate, use the calculate tool."
                ),
                tools=tools,
            )
        return self._agents[name]

    def _get_tools(self):
        """Define tools the agent can use."""
        def get_weather(city: str) -> str:
            """Get weather for a city."""
            # Simulated weather data
            weather_data = {
                "tokyo": "☀️ 22°C, sunny",
                "london": "🌧️ 15°C, rainy",
                "new york": "⛅ 18°C, partly cloudy",
                "paris": "🌤️ 20°C, clear",
            }
            return weather_data.get(city.lower(), f"🌡️ 20°C, clear skies in {city}")

        def calculate(expression: str) -> str:
            """Evaluate a math expression safely."""
            try:
                # Safe evaluation of basic math
                allowed = set("0123456789+-*/.() ")
                if all(c in allowed for c in expression):
                    result = eval(expression)
                    return f"Result: {result}"
                return "Error: Only basic math operations allowed"
            except Exception as e:
                return f"Error: {e}"

        return [get_weather, calculate]

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        agent = self._get_agent(agent_name or "Assistant")

        yield RunEvent(
            type=RunEventType.RUN_STARTED,
            agent_name=agent.name,
        )

        # Emit reasoning start
        yield RunEvent(type=RunEventType.REASONING_STARTED)
        yield RunEvent(type=RunEventType.REASONING_STEP, step="Analyzing the request...")

        # Get the running event loop for thread-safe queue operations
        loop = asyncio.get_running_loop()
        event_queue = asyncio.Queue()
        _has_streaming = False

        try:
            from praisonaiagents.streaming import StreamEventType as SET

            def _on_stream(evt):
                if evt.type == SET.DELTA_TEXT and evt.content:
                    if evt.is_reasoning:
                        run_event = RunEvent(
                            type=RunEventType.REASONING_STEP,
                            step=evt.content,
                        )
                        # Use thread-safe queue operation
                        loop.call_soon_threadsafe(event_queue.put_nowait, run_event)
                    else:
                        run_event = RunEvent(
                            type=RunEventType.RUN_CONTENT,
                            token=evt.content,
                        )
                        loop.call_soon_threadsafe(event_queue.put_nowait, run_event)
                elif evt.type == SET.DELTA_TOOL_CALL and evt.tool_call:
                    run_event = RunEvent(
                        type=RunEventType.TOOL_CALL_STARTED,
                        name=evt.tool_call.get("name"),
                        args=evt.tool_call.get("arguments"),
                    )
                    loop.call_soon_threadsafe(event_queue.put_nowait, run_event)
                elif evt.type == SET.TOOL_CALL_END and evt.tool_call:
                    run_event = RunEvent(
                        type=RunEventType.TOOL_CALL_COMPLETED,
                        name=evt.tool_call.get("name"),
                        result=evt.tool_call.get("result"),
                    )
                    loop.call_soon_threadsafe(event_queue.put_nowait, run_event)

            agent.stream_emitter.add_callback(_on_stream)
            agent.stream_emitter.enable_metrics()
            _has_streaming = True
        except (ImportError, AttributeError):
            pass

        yield RunEvent(type=RunEventType.REASONING_COMPLETED)

        # Run the agent concurrently with event draining
        if _has_streaming:
            async def _drain_events():
                """Drain events concurrently with agent execution."""
                while True:
                    event = await event_queue.get()
                    if event is None:
                        break
                    yield event

            chat_task = asyncio.create_task(asyncio.to_thread(agent.chat, message))

            async def _signal_end():
                try:
                    await chat_task
                finally:
                    await event_queue.put(None)

            signal_task = asyncio.create_task(_signal_end())

            try:
                # Drain events while agent is running
                async for event in _drain_events():
                    yield event

                # Wait for agent completion
                response = await chat_task
                full_response = str(response)
            except Exception as exc:
                yield RunEvent(type=RunEventType.RUN_ERROR, error=str(exc))
                return
            finally:
                try:
                    agent.stream_emitter.remove_callback(_on_stream)
                except Exception:
                    pass
                # Ensure signal task is cleaned up
                if not signal_task.done():
                    signal_task.cancel()
                    try:
                        await signal_task
                    except asyncio.CancelledError:
                        pass
        else:
            # Fallback without streaming
            try:
                response = await asyncio.to_thread(agent.chat, message)
                full_response = str(response)
            except Exception as exc:
                yield RunEvent(type=RunEventType.RUN_ERROR, error=str(exc))
                return

        # If no tokens were streamed, emit the full response
        if event_queue.empty() and not _has_streaming:
            yield RunEvent(type=RunEventType.RUN_CONTENT, content=full_response)

        # Emit metrics
        if _has_streaming:
            try:
                metrics = agent.stream_emitter.get_metrics()
                if metrics:
                    yield RunEvent(
                        type=RunEventType.RUN_CONTENT,
                        extra_data={"stream_metrics": metrics.to_dict()},
                    )
            except Exception:
                pass

        yield RunEvent(
            type=RunEventType.RUN_COMPLETED,
            content=full_response,
            agent_name=agent.name,
        )

    async def list_agents(self):
        return [
            {"name": "Assistant", "description": "General-purpose AI with tools"},
        ]

    async def health(self):
        info = {"status": "ok", "provider": "FullFeaturedProvider"}
        try:
            import praisonaiagents
            info["praisonai_version"] = getattr(praisonaiagents, "__version__", "unknown")
        except ImportError:
            info["praisonai_installed"] = False
        return info


# Set the provider
aiui.set_provider(FullFeaturedProvider())


# Starters showcasing tool features
@aiui.starters
async def get_starters():
    return [
        {"label": "Weather in Tokyo", "message": "What's the weather in Tokyo?", "icon": "🌤️"},
        {"label": "Calculate 42 * 37", "message": "Calculate 42 * 37", "icon": "🔢"},
        {"label": "Write a poem", "message": "Write a short poem about AI agents", "icon": "✍️"},
        {"label": "Compare cities", "message": "Compare weather in London and Paris", "icon": "🌍"},
    ]
