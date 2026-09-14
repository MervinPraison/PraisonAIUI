"""Voice Agent — PraisonAIUI example with telephony webhooks.

  - Outbound calls     → POST /api/voice/calls
  - Provider webhooks  → POST /webhooks/voice (tool-calls, transcript, end-of-call)
  - Dashboard          → Calls list + live call detail + web talk + chat bridge

Run:
    cd examples/python/voice-agent
    pip install httpx
    copy .env.example .env
    .\\start_dev.ps1
    python app.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

import praisonaiui as aiui
from praisonaiui.server import create_app
from starlette.routing import Route, WebSocketRoute

from memory_routes import (
    api_voice_memory_attach_user,
    api_voice_memory_bind,
    api_voice_memory_config,
    api_voice_memory_for_call,
    api_voice_memory_resolve,
)
from realtime_routes import (
    api_realtime_config,
    api_realtime_end,
    api_realtime_new_call,
    api_realtime_session,
    api_realtime_transcript,
)
from speech_engine_routes import (
    api_speech_engine_config,
    api_speech_engine_token,
    speech_engine_websocket,
)
from voice_routes import (
    api_voice_call_detail,
    api_voice_call_detail_ui,
    api_voice_config_status,
    api_voice_create_call,
    api_voice_doctor,
    api_voice_list_calls,
    api_voice_live_transcript,
    api_voice_web_config,
    webhook_voice,
)

_EXAMPLE_DIR = Path(__file__).resolve().parent
if str(_EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE_DIR))


def _load_local_env() -> None:
    env_path = _EXAMPLE_DIR / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key:
            os.environ[key] = value


_load_local_env()

aiui.set_pages(
    [
        "chat",
        "voice-calls",
        "call-detail",
        "web-talk",
        "eleven-talk",
        "realtime-talk",
        "mcp",
        "config",
    ]
)
aiui.set_style("dashboard")
aiui.set_custom_js(_EXAMPLE_DIR / "plugin.js")


def get_agent():
    from integrations.voice.agent_runner import get_voice_agent

    return get_voice_agent()


aiui.register_agent("voice-assistant", get_agent())


@aiui.on_app_startup
async def _start_voice_chat_bridge() -> None:
    from integrations.voice.chat_bridge import start_chat_bridge_worker

    start_chat_bridge_worker()


@aiui.reply
async def on_message(message: str):
    """Chat with the voice demo agent."""
    from integrations.voice.tools import demo_tool_reply

    text = str(message).strip()
    if not text:
        return

    demo = demo_tool_reply(text)
    if demo is not None:
        await aiui.say(demo)
        return

    if not os.getenv("OPENAI_API_KEY"):
        await aiui.say(
            "Set `OPENAI_API_KEY` for open-ended chat. "
            'Demo without API key: "What time is it?" or "Echo hello world".'
        )
        return
    await aiui.think("Running voice assistant...")
    agent = get_agent()
    response = await asyncio.to_thread(agent.chat, text)
    await aiui.say(str(response))


def _list_calls() -> list[dict[str, Any]]:
    from integrations.voice.call_finalize import analytics_for_record
    from integrations.voice.store import VoiceCallStore

    rows = VoiceCallStore.list_calls()
    out: list[dict[str, Any]] = []
    for r in rows:
        analytics = analytics_for_record(r)
        out.append(
            {
                "id": r["call_id"],
                "status": r["status"],
                "customer_number": r.get("customer_number") or "—",
                "transcript_preview": (r.get("transcript") or "")[:120],
                "duration": analytics.get("duration") or "—",
                "turn_count": analytics.get("turn_count") or 0,
                "updated_at": r.get("updated_at") or "",
            }
        )
    return out


def _pick_call(calls: list[dict[str, Any]]) -> dict[str, Any]:
    live = next((c for c in calls if "progress" in (c.get("status") or "").lower()), None)
    return live or (calls[0] if calls else {"id": "—", "status": "none", "customer_number": "—", "transcript_preview": ""})


@aiui.page("voice-calls", title="Voice calls", icon="📞", group="Voice", order=1)
async def voice_calls_page():
    calls = _list_calls()
    rows = [
        [c["id"], c["customer_number"], c["status"], c["duration"], str(c["turn_count"]), c["updated_at"]]
        for c in calls
    ]
    return aiui.layout(
        [
            aiui.text("Outbound and inbound voice calls via telephony provider"),
            aiui.table(
                headers=["Call ID", "Customer", "Status", "Duration", "Turns", "Updated"],
                rows=rows or [["—", "—", "—", "—", "—", "—"]],
            ),
            aiui.alert(
                "Open **Call detail** for live transcript (SSE). "
                "Voice sessions also appear in **Chat** sidebar as 📞 entries.",
                variant="info",
                title="Phase 2",
            ),
        ]
    )


@aiui.page("call-detail", title="Call detail", icon="🎙️", group="Voice", order=2)
async def call_detail_page():
    """Server fallback — plugin.js registerView overrides with live SSE + UI components."""
    from integrations.voice.call_detail_ui import build_call_detail_layout
    from integrations.voice.store import VoiceCallStore

    calls = _list_calls()
    picked = _pick_call(calls)
    record = VoiceCallStore.get_call(picked["id"]) if picked.get("id") and picked["id"] != "—" else None
    if record:
        return build_call_detail_layout(record)
    return aiui.layout(
        [
            aiui.alert(
                "No calls yet. Start from ElevenLabs talk, GPT Realtime, or Web talk.",
                variant="info",
                title="Call detail",
            ),
        ]
    )


@aiui.page("web-talk", title="Web talk", icon="🎤", group="Voice", order=3)
async def web_talk_page():
    return aiui.layout(
        [
            aiui.text("Browser voice widget — client view loads from plugin.js"),
            aiui.alert(
                "Set VOICE_PUBLIC_API_KEY, VOICE_ASSISTANT_ID, VOICE_WEB_SDK_URL, and "
                "VOICE_WEB_SDK_GLOBAL in .env.",
                variant="info",
                title="Web SDK",
            ),
        ]
    )


@aiui.page("eleven-talk", title="ElevenLabs talk", icon="🗣️", group="Voice", order=4)
async def eleven_talk_page():
    return aiui.layout(
        [
            aiui.text("Browser voice via ElevenLabs Speech Engine — loads from plugin.js"),
            aiui.alert(
                "Set ELEVENLABS_API_KEY, run setup_speech_engine.py after start_dev.ps1, "
                "then click Start conversation.",
                variant="info",
                title="Speech Engine",
            ),
        ]
    )


@aiui.page("realtime-talk", title="GPT Realtime", icon="⚡", group="Voice", order=5)
async def realtime_talk_page():
    return aiui.layout(
        [
            aiui.text("Browser voice via OpenAI gpt-realtime-2.1-mini — loads from plugin.js"),
            aiui.alert(
                "Set OPENAI_API_KEY and REALTIME_MODEL=gpt-realtime-2.1-mini.",
                variant="warning",
                title="OpenAI Realtime",
            ),
        ]
    )


app = create_app()
app.routes[0:0] = [
    Route("/api/voice/calls", api_voice_create_call, methods=["POST"]),
    Route("/api/voice/calls", api_voice_list_calls, methods=["GET"]),
    Route("/api/voice/calls/{call_id}", api_voice_call_detail, methods=["GET"]),
    Route("/api/voice/calls/{call_id}/ui", api_voice_call_detail_ui, methods=["GET"]),
    Route("/api/voice/calls/{call_id}/live-transcript", api_voice_live_transcript, methods=["GET"]),
    Route("/api/voice/config", api_voice_config_status, methods=["GET"]),
    Route("/api/voice/doctor", api_voice_doctor, methods=["GET"]),
    Route("/api/voice/web-config", api_voice_web_config, methods=["GET"]),
    Route("/api/voice/speech-engine/config", api_speech_engine_config, methods=["GET"]),
    Route("/api/voice/speech-engine/token", api_speech_engine_token, methods=["GET"]),
    Route("/api/voice/memory/config", api_voice_memory_config, methods=["GET"]),
    Route("/api/voice/memory/bind", api_voice_memory_bind, methods=["POST"]),
    Route("/api/voice/memory/attach-user", api_voice_memory_attach_user, methods=["POST"]),
    Route("/api/voice/memory/resolve", api_voice_memory_resolve, methods=["GET"]),
    Route("/api/voice/memory/for-call", api_voice_memory_for_call, methods=["GET"]),
    Route("/api/voice/realtime/config", api_realtime_config, methods=["GET"]),
    Route("/api/voice/realtime/new-call", api_realtime_new_call, methods=["POST"]),
    Route("/api/voice/realtime/session", api_realtime_session, methods=["POST"]),
    Route("/api/voice/realtime/transcript", api_realtime_transcript, methods=["POST"]),
    Route("/api/voice/realtime/end", api_realtime_end, methods=["POST"]),
    Route("/webhooks/voice", webhook_voice, methods=["POST"]),
    WebSocketRoute("/ws", speech_engine_websocket),
]

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("VOICE_AGENT_PORT", "8001"))
    uvicorn.run(app, host=host, port=port)
