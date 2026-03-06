"""Real Agent Dashboard — PraisonAI agents + PraisonAIUI dashboard.

Unlike 12-agent-dashboard (mock data), this runs REAL PraisonAI agents.
Uses PraisonAIUI's native dashboard with @profiles, @reply, @page,
and register_agent() — no custom HTML.

Features:
    • 3 real PraisonAI agents (assistant, code-reviewer, summarizer)
    • Profile switching to chat with different agents
    • Streaming responses via stream_emitter
    • @page for live agent metrics (real call counts, token usage, latency)
    • register_agent() for dashboard agent visibility

Requires:
    pip install praisonaiui praisonaiagents
    export OPENAI_API_KEY=sk-...

Run:
    aiui run app.py --style dashboard
"""

import os
import time
import asyncio
from collections import defaultdict

import praisonaiui as aiui

try:
    from praisonaiagents import Agent
    from praisonaiagents.streaming.events import StreamEventType
except ImportError:
    raise ImportError(
        "praisonaiagents required: pip install praisonaiagents"
    )

# ── Metrics tracker ──────────────────────────────────────────────────

class MetricsTracker:
    """Tracks real agent call metrics."""

    def __init__(self):
        self.calls = defaultdict(int)
        self.tokens = defaultdict(int)
        self.errors = defaultdict(int)
        self.latencies = defaultdict(list)
        self.last_messages = []

    def record(self, agent_id: str, user_msg: str, response: str, latency_ms: int):
        self.calls[agent_id] += 1
        est_tokens = len(response.split())
        self.tokens[agent_id] += est_tokens
        self.latencies[agent_id].append(latency_ms)
        self.last_messages.append({
            "agent": agent_id,
            "user": user_msg[:80],
            "response": response[:120],
            "tokens": est_tokens,
            "latency_ms": latency_ms,
            "time": time.strftime("%H:%M:%S"),
        })
        # Keep last 50
        if len(self.last_messages) > 50:
            self.last_messages = self.last_messages[-50:]

    def record_error(self, agent_id: str):
        self.errors[agent_id] += 1

    def avg_latency(self, agent_id: str) -> int:
        lats = self.latencies.get(agent_id, [])
        return round(sum(lats) / len(lats)) if lats else 0

    def summary(self):
        total_calls = sum(self.calls.values())
        total_tokens = sum(self.tokens.values())
        total_errors = sum(self.errors.values())
        all_lats = [l for lats in self.latencies.values() for l in lats]
        avg_lat = round(sum(all_lats) / len(all_lats)) if all_lats else 0
        return {
            "total_calls": total_calls,
            "total_tokens": total_tokens,
            "total_errors": total_errors,
            "avg_latency_ms": avg_lat,
        }


metrics = MetricsTracker()

# ── Create real agents ───────────────────────────────────────────────

AGENTS = {}


def _create_agents():
    """Create real PraisonAI agents (lazy, called on first use)."""
    if AGENTS:
        return

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY to use real agents")

    AGENTS["assistant"] = Agent(
        name="General Assistant",
        instructions="You are a helpful, concise assistant. Answer clearly using markdown.",
        llm="gpt-4o-mini",
    )
    AGENTS["code-reviewer"] = Agent(
        name="Code Reviewer",
        instructions="You are a senior code reviewer. Review code for bugs, performance, and style. Be specific and constructive.",
        llm="gpt-4o-mini",
    )
    AGENTS["summarizer"] = Agent(
        name="Summarizer",
        instructions="You summarize text into clear, concise bullet points. Keep it under 5 bullets.",
        llm="gpt-4o-mini",
    )

    # Register agents for dashboard visibility
    for agent_id, agent in AGENTS.items():
        aiui.register_agent(
            id=agent_id,
            name=agent.name,
            description=f"PraisonAI Agent: {agent.instructions[:60]}...",
        )


# ── Profiles — switch between real agents ────────────────────────────

@aiui.profiles
async def get_profiles():
    return [
        {"name": "General Assistant", "description": "General-purpose Q&A", "icon": "🤖", "default": True},
        {"name": "Code Reviewer", "description": "Reviews code for bugs & style", "icon": "🔍"},
        {"name": "Summarizer", "description": "Summarizes text into bullets", "icon": "📋"},
    ]


# Map profile name → agent key
_PROFILE_MAP = {
    "General Assistant": "assistant",
    "Code Reviewer": "code-reviewer",
    "Summarizer": "summarizer",
}


@aiui.starters
async def get_starters():
    return [
        {"label": "Explain async/await", "message": "Explain async/await in Python clearly", "icon": "🐍"},
        {"label": "Review my code", "message": "Review this Python code:\n\ndef fib(n):\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)", "icon": "🔍"},
        {"label": "Summarize AI news", "message": "Summarize the key trends in AI for 2024", "icon": "📋"},
    ]


@aiui.welcome
async def on_welcome():
    await aiui.say("👋 **Real Agent Dashboard** — you're chatting with live PraisonAI agents.\n\nSwitch profiles to talk to different agents. Check the **Metrics** page for live stats.")


# ── Reply — routes to real agent with streaming ──────────────────────

@aiui.reply
async def on_message(message: str):
    """Route message to the selected real PraisonAI agent with streaming."""
    _create_agents()  # Lazy init

    # Determine which agent from the current profile
    profile = aiui.get_profile()
    agent_id = _PROFILE_MAP.get(profile, "assistant") if profile else "assistant"
    agent = AGENTS.get(agent_id, AGENTS["assistant"])

    await aiui.think(f"Routing to **{agent.name}**...")

    start_time = time.time()
    token_queue = asyncio.Queue()

    def on_stream_event(event):
        if event.type == StreamEventType.DELTA_TEXT and event.content:
            token_queue.put_nowait(event.content)
        elif event.type == StreamEventType.FIRST_TOKEN and event.content:
            token_queue.put_nowait(event.content)
        elif event.type == StreamEventType.STREAM_END:
            token_queue.put_nowait(None)

    agent.stream_emitter.add_callback(on_stream_event)

    full_response = []

    try:
        chat_task = asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.chat(str(message), stream=True)
        )

        while True:
            try:
                token = await asyncio.wait_for(token_queue.get(), timeout=60.0)
            except asyncio.TimeoutError:
                break
            if token is None:
                break
            full_response.append(token)
            await aiui.stream_token(token)

        await chat_task

        latency_ms = round((time.time() - start_time) * 1000)
        response_text = "".join(full_response)
        metrics.record(agent_id, str(message), response_text, latency_ms)

    except Exception as e:
        metrics.record_error(agent_id)
        await aiui.say(f"❌ Agent error: {e}")

    finally:
        agent.stream_emitter.remove_callback(on_stream_event)


# ── @page — live agent metrics ───────────────────────────────────────

@aiui.page("metrics", title="Agent Metrics", icon="📊", group="Analytics",
           description="Live stats from real agent conversations")
async def metrics_page():
    """Returns live metrics computed from actual agent calls."""
    summary = metrics.summary()
    per_agent = {}
    for agent_id in AGENTS:
        per_agent[agent_id] = {
            "name": AGENTS[agent_id].name if agent_id in AGENTS else agent_id,
            "calls": metrics.calls.get(agent_id, 0),
            "tokens": metrics.tokens.get(agent_id, 0),
            "errors": metrics.errors.get(agent_id, 0),
            "avg_latency_ms": metrics.avg_latency(agent_id),
        }

    return {
        "overview": summary,
        "per_agent": per_agent,
        "recent_messages": list(reversed(metrics.last_messages[-10:])),
    }


@aiui.page("agents-status", title="Agent Status", icon="🧠", group="Analytics",
           description="Real-time agent health and configuration")
async def agents_status_page():
    """Shows real agent configuration and status."""
    agents_info = []
    for agent_id, agent in AGENTS.items():
        agents_info.append({
            "id": agent_id,
            "name": agent.name,
            "model": getattr(agent, 'llm', 'unknown'),
            "instructions": agent.instructions[:100] + "...",
            "calls": metrics.calls.get(agent_id, 0),
            "status": "ready",
        })
    return {"agents": agents_info, "count": len(agents_info)}


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
