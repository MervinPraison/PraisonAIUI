"""Full-featured PraisonAI Provider Example.

Demonstrates all integrated features:
- Real-time token streaming
- Tool calls with lifecycle events
- Reasoning/thinking steps
- Memory events
- Multi-agent support
- Streaming metrics (TTFT, tokens/sec)

Run:
    aiui run app.py

Requires: pip install praisonai
Set OPENAI_API_KEY before running.
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

        # Set up streaming bridge
        event_queue = asyncio.Queue()
        _has_streaming = False

        try:
            from praisonaiagents.streaming import StreamEventType as SET

            def _on_stream(evt):
                if evt.type == SET.DELTA_TEXT and evt.content:
                    if evt.is_reasoning:
                        event_queue.put_nowait(RunEvent(
                            type=RunEventType.REASONING_STEP,
                            step=evt.content,
                        ))
                    else:
                        event_queue.put_nowait(RunEvent(
                            type=RunEventType.RUN_CONTENT,
                            token=evt.content,
                        ))
                elif evt.type == SET.DELTA_TOOL_CALL and evt.tool_call:
                    event_queue.put_nowait(RunEvent(
                        type=RunEventType.TOOL_CALL_STARTED,
                        name=evt.tool_call.get("name"),
                        args=evt.tool_call.get("arguments"),
                    ))
                elif evt.type == SET.TOOL_CALL_END and evt.tool_call:
                    event_queue.put_nowait(RunEvent(
                        type=RunEventType.TOOL_CALL_COMPLETED,
                        name=evt.tool_call.get("name"),
                        result=evt.tool_call.get("result"),
                    ))

            agent.stream_emitter.add_callback(_on_stream)
            agent.stream_emitter.enable_metrics()
            _has_streaming = True
        except (ImportError, AttributeError):
            pass

        yield RunEvent(type=RunEventType.REASONING_COMPLETED)

        # Run the agent
        try:
            response = await asyncio.to_thread(agent.chat, message)
            full_response = str(response)
        except Exception as exc:
            yield RunEvent(type=RunEventType.RUN_ERROR, error=str(exc))
            return
        finally:
            if _has_streaming:
                try:
                    agent.stream_emitter.remove_callback(_on_stream)
                except Exception:
                    pass

        # Drain streamed events
        while not event_queue.empty():
            try:
                yield event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

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
