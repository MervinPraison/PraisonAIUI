"""Copilot Widget — Embeddable AI chat widget with PraisonAIUI.

What's New:
    • Widget/copilot mode — AI chat as a floating panel or sidebar
    • Same @reply callback, just rendered in compact widget layout
    • Streams tokens in the widget via stream_emitter

This is the Streamlit/Gradio equivalent: embed AI chat into any page.
The frontend's ChatLayout supports multiple modes:
    - fullscreen: full-page chat (default --style chat)
    - sidebar:    fixed right-side panel
    - bottom-right / bottom-left / top-right / top-left: floating widget

Requires: pip install praisonaiagents
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py                           # default fullscreen
    aiui run app.py --style chat              # same (explicit)
"""

import asyncio

import praisonaiui as aiui

_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        try:
            from praisonaiagents import Agent
        except ImportError:
            raise ImportError(
                "praisonaiagents required. Install with: pip install praisonaiagents"
            )
        _agent = Agent(
            name="Copilot",
            instructions=(
                "You are a helpful copilot assistant embedded in a web page. "
                "Keep answers concise and focused. Use markdown for formatting."
            ),
        )
    return _agent


@aiui.welcome
async def on_welcome():
    """Compact welcome for widget mode."""
    await aiui.say("💡 Hi! I'm your AI copilot. Ask me anything.")


@aiui.starters
async def get_starters():
    return [
        {"label": "Quick help", "message": "How can you help me?", "icon": "❓"},
        {"label": "Summarize", "message": "Summarize the key concepts of this page", "icon": "📝"},
        {"label": "Code", "message": "Write a quick Python script", "icon": "💻"},
    ]


@aiui.reply
async def on_message(message):
    """Stream response from PraisonAI Agent."""
    await aiui.think("Thinking...")

    agent = _get_agent()
    token_queue = asyncio.Queue()
    _has_streaming = False

    try:
        from praisonaiagents.streaming.events import StreamEventType

        _loop = asyncio.get_running_loop()

        def _on_stream_event(event):
            if event.type == StreamEventType.DELTA_TEXT and event.content:
                _loop.call_soon_threadsafe(token_queue.put_nowait, event.content)
            elif event.type == StreamEventType.STREAM_END:
                _loop.call_soon_threadsafe(token_queue.put_nowait, None)

        agent.stream_emitter.add_callback(_on_stream_event)
        _has_streaming = True
    except (ImportError, AttributeError):
        pass

    if _has_streaming:
        full_response = ""

        async def _run_chat():
            nonlocal full_response
            try:
                response = await asyncio.to_thread(agent.chat, str(message), stream=True)
                full_response = str(response)
            finally:
                await token_queue.put(None)

        chat_task = asyncio.create_task(_run_chat())

        while True:
            try:
                token = await asyncio.wait_for(token_queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                break
            if token is None:
                break
            await aiui.stream_token(token)

        await chat_task

        try:
            agent.stream_emitter.remove_callback(_on_stream_event)
        except Exception:
            pass
    else:
        response = await asyncio.to_thread(agent.chat, str(message))
        await aiui.say(str(response))
