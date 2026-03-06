"""Real Agent Dashboard — PraisonAI agents + PraisonAIUI dashboard.

Unlike 12-agent-dashboard (mock data), this runs REAL PraisonAI agents.
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

import os
import time
import asyncio

import praisonaiui as aiui

try:
    from praisonaiagents import Agent
    from praisonaiagents.streaming.events import StreamEventType
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
    token_queue = asyncio.Queue()

    def on_stream(event):
        if event.type == StreamEventType.DELTA_TEXT and event.content:
            token_queue.put_nowait(event.content)
        elif event.type == StreamEventType.FIRST_TOKEN and event.content:
            token_queue.put_nowait(event.content)
        elif event.type == StreamEventType.STREAM_END:
            token_queue.put_nowait(None)

    agent.stream_emitter.add_callback(on_stream)
    full = []

    try:
        task = asyncio.get_event_loop().run_in_executor(
            None, lambda: agent.chat(str(message), stream=True)
        )

        while True:
            try:
                tok = await asyncio.wait_for(token_queue.get(), timeout=60)
            except asyncio.TimeoutError:
                break
            if tok is None:
                break
            full.append(tok)
            await aiui.stream_token(tok)

        await task
        latency = round((time.time() - start) * 1000)
        _record(str(message), "".join(full), latency)

    except Exception as e:
        _errors += 1
        await aiui.say(f"❌ Error: {e}")

    finally:
        agent.stream_emitter.remove_callback(on_stream)


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
