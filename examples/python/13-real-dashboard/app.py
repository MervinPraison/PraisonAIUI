"""Real Agent Dashboard — PraisonAI agents + PraisonAIUI dashboard.

This example uses secure component-based rendering with REAL PraisonAI agents.
Uses PraisonAIUI's native dashboard with @reply, @page, register_agent()
— all backed by actual LLM calls.

Features:
    • Real PraisonAI Agent (gpt-4o-mini) for live AI chat
    • Streaming responses via stream_emitter (word-by-word)
    • @page for live agent metrics (real call counts, latency)
    • register_agent() for dashboard agent visibility

Requires:
    pip install praisonaiui praisonaiagents
    export OPENAI_API_KEY=sk-...

Run:
    aiui run app.py --style dashboard
"""

import asyncio
import os
import sys
import time

import praisonaiui as aiui

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '_shared'))
from stream_bridge import StreamBridge

try:
    from praisonaiagents import Agent
except ImportError:
    raise ImportError(
        "praisonaiagents required: pip install praisonaiagents"
    )


# ── Metrics ──────────────────────────────────────────────────────────

_call_count = 0
_total_tokens = 0
_total_latency_ms = 0
_errors = 0
_recent = []          # last 20 conversations


def _record(user_msg, response, latency_ms):
    global _call_count, _total_tokens, _total_latency_ms
    _call_count += 1
    tokens = len(response.split())
    _total_tokens += tokens
    _total_latency_ms += latency_ms
    _recent.append({
        "user": user_msg[:80],
        "response": response[:120],
        "tokens": tokens,
        "latency_ms": latency_ms,
        "time": time.strftime("%H:%M:%S"),
    })
    if len(_recent) > 20:
        _recent.pop(0)


# ── Create the real agent ────────────────────────────────────────────

api_key = os.getenv("OPENAI_API_KEY", "")
if not api_key:
    print("⚠️  Set OPENAI_API_KEY to use real agents")

agent = Agent(
    name="Assistant",
    instructions="You are a helpful, concise assistant. Answer clearly using markdown.",
    llm="gpt-4o-mini",
)

# Register for dashboard visibility
aiui.register_agent("assistant", agent)


# ── Callbacks ────────────────────────────────────────────────────────

@aiui.starters
async def get_starters():
    return [
        {"label": "Explain async/await", "message": "Explain async/await in Python", "icon": "🐍"},
        {"label": "Write a haiku", "message": "Write a haiku about coding", "icon": "✍️"},
        {"label": "What is Docker?", "message": "Explain Docker in 3 sentences", "icon": "🐳"},
    ]


@aiui.welcome
async def on_welcome():
    await aiui.say(
        "👋 **Real Agent Dashboard** — this is a live PraisonAI agent, "
        "not mock data. Try asking something!\n\n"
        "Check the **Metrics** page for live call stats."
    )


@aiui.reply
async def on_message(message: str):
    """Stream a real PraisonAI Agent response token-by-token."""
    global _errors

    await aiui.think("Agent thinking...")
    start = time.time()

    # Set up thread-safe streaming bridge
    bridge = StreamBridge()
    callback = bridge.emitter_callback()
    agent.stream_emitter.add_callback(callback)
    full = []

    try:
        # Run agent.chat concurrently with token consumption
        task = asyncio.create_task(
            asyncio.to_thread(lambda: agent.chat(str(message), stream=True))
        )

        # Consume tokens as they arrive and stream to UI
        async for tok in bridge.consume():
            full.append(tok)
            await aiui.stream_token(tok)

        await task
        latency = round((time.time() - start) * 1000)
        _record(str(message), "".join(full), latency)

    except Exception as e:
        _errors += 1
        await aiui.say(f"❌ Error: {e}")

    finally:
        agent.stream_emitter.remove_callback(callback)
        bridge.cancel()


# ── @page — live metrics from real calls ─────────────────────────────

@aiui.page("metrics", title="Agent Metrics", icon="📊", group="Analytics",
           description="Live stats from real agent conversations")
async def metrics_page():
    avg = round(_total_latency_ms / _call_count) if _call_count else 0
    return {
        "total_calls": _call_count,
        "total_tokens": _total_tokens,
        "avg_latency_ms": avg,
        "errors": _errors,
        "recent_conversations": list(reversed(_recent[-10:])),
    }


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
