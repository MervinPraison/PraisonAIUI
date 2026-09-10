"""ElevenLabs Speech Engine — WebSocket LLM bridge for browser voice."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_engine_resource: Any | None = None
_engine_lock = asyncio.Lock()


class SpeechEngineConfigError(Exception):
    pass


@dataclass(frozen=True)
class SpeechEngineSettings:
    api_key: str
    engine_id: str | None
    public_ws_url: str | None
    first_message: str


def _public_ws_url() -> str | None:
    speech_base = os.getenv("SPEECH_ENGINE_PUBLIC_URL", "").strip().rstrip("/")
    base = speech_base or os.getenv("PUBLIC_API_BASE_URL", "").strip().rstrip("/")
    if not base:
        return None
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :] + "/ws"
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :] + "/ws"
    return None


def load_speech_engine_settings(*, require_engine_id: bool = False) -> SpeechEngineSettings:
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise SpeechEngineConfigError("Set ELEVENLABS_API_KEY in .env")
    engine_id = os.getenv("SPEECH_ENGINE_ID", "").strip() or None
    if require_engine_id and not engine_id:
        raise SpeechEngineConfigError("Set SPEECH_ENGINE_ID in .env (run setup_speech_engine.py)")
    return SpeechEngineSettings(
        api_key=api_key,
        engine_id=engine_id,
        public_ws_url=_public_ws_url(),
        first_message=os.getenv(
            "SPEECH_ENGINE_FIRST_MESSAGE", "Hello! How can I help you today?"
        ).strip(),
    )


def speech_engine_enabled() -> bool:
    try:
        settings = load_speech_engine_settings()
    except SpeechEngineConfigError:
        return False
    return bool(settings.engine_id and settings.public_ws_url)


async def get_engine_resource():
    """Lazy-load the ElevenLabs SpeechEngineResource."""
    global _engine_resource
    if _engine_resource is not None:
        return _engine_resource

    async with _engine_lock:
        if _engine_resource is not None:
            return _engine_resource
        settings = load_speech_engine_settings(require_engine_id=True)
        try:
            from elevenlabs import AsyncElevenLabs
        except ImportError as exc:
            raise SpeechEngineConfigError(
                "Install Speech Engine SDK: pip install 'elevenlabs>=2.47.0'"
            ) from exc

        if not hasattr(AsyncElevenLabs(api_key=settings.api_key), "speech_engine"):
            raise SpeechEngineConfigError(
                "elevenlabs package is too old. Run: pip install -U 'elevenlabs>=2.47.0'"
            )

        client = AsyncElevenLabs(api_key=settings.api_key)
        _engine_resource = await client.speech_engine.get(settings.engine_id)
        return _engine_resource


def _conversation_id(session: Any) -> str | None:
    cid = getattr(session, "conversation_id", None)
    return str(cid) if cid else None


def _transcript_display_text(transcript: list[Any], agent_reply: str | None = None) -> str:
    text = _transcript_to_prompt(transcript)
    if agent_reply:
        agent_line = f"agent: {agent_reply.strip()}"
        text = f"{text}\n{agent_line}".strip() if text else agent_line
    return text


def _persist_conversation_turn(call_id: str, transcript: list[Any], agent_reply: str) -> None:
    from integrations.voice.live import transcript_hub
    from integrations.voice.store import VoiceCallStore

    display = _transcript_display_text(transcript, agent_reply)
    VoiceCallStore.upsert_call(
        call_id,
        status="in-progress",
        customer_number="web-speech-engine",
        transcript=display,
    )
    prompt = _transcript_to_prompt(transcript)
    if prompt:
        last_line = prompt.splitlines()[-1]
        role, _, content = last_line.partition(": ")
        transcript_hub.publish(
            call_id,
            {
                "type": "transcript",
                "role": role or "user",
                "transcriptType": "final",
                "text": content,
            },
        )
    transcript_hub.publish(
        call_id,
        {
            "type": "transcript",
            "role": "assistant",
            "transcriptType": "final",
            "text": agent_reply,
        },
    )


def _transcript_to_prompt(transcript: list[Any]) -> str:
    lines: list[str] = []
    for message in transcript:
        role = getattr(message, "role", None) or (message.get("role") if isinstance(message, dict) else "user")
        content = getattr(message, "content", None) or (
            message.get("content") if isinstance(message, dict) else ""
        )
        text = str(content or "").strip()
        if text:
            lines.append(f"{role}: {text}")
    if not lines:
        return ""
    return "\n".join(lines)


def _try_demo_tool_reply(transcript: list[Any]) -> str | None:
    from integrations.voice.tools import demo_tool_reply

    user_text = _latest_user_text(transcript)
    if not user_text:
        return None
    return demo_tool_reply(user_text)


async def _run_openai_reply(transcript: list[Any], *, session_id: str | None = None) -> str:
    """Voice LLM path with demo fast-path + OpenAI tool calling."""
    import json

    from openai import AsyncOpenAI

    from integrations.voice.agent_runner import execute_voice_tool
    from integrations.voice.session_memory import openai_messages_with_memory
    from integrations.voice.tools import openai_tool_schemas, tool_result_for_voice

    prompt = _transcript_to_prompt(transcript)
    if not prompt:
        return "I did not catch that. Could you repeat?"

    fast = _try_demo_tool_reply(transcript)
    if fast:
        return fast

    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", "").strip())
    model = os.getenv("VOICE_AGENT_MODEL", "gpt-4o-mini")
    base_instructions = (
        "You are a helpful voice assistant for PraisonAI demos. "
        "Keep answers concise (1-3 sentences) and conversational. "
        "When the caller asks for the time, call get_current_time. "
        "When they ask you to repeat or echo text, call echo_message."
    )
    messages = openai_messages_with_memory(
        prompt.splitlines(),
        session_id=session_id,
        base_instructions=base_instructions,
    )
    use_tools = os.getenv("VOICE_SPEECH_USE_TOOLS", "true").lower() in ("1", "true", "yes")
    create_kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": 200,
    }
    if use_tools:
        create_kwargs["tools"] = openai_tool_schemas()
        create_kwargs["tool_choice"] = "auto"

    response = await client.chat.completions.create(**create_kwargs)
    choice = response.choices[0].message

    if use_tools and choice.tool_calls:
        messages.append(choice.model_dump(exclude_none=True))
        fallback = "Done."
        for tool_call in choice.tool_calls:
            fn = tool_call.function
            name = fn.name if fn else ""
            try:
                args = json.loads(fn.arguments or "{}") if fn else {}
            except json.JSONDecodeError:
                args = {}
            raw = execute_voice_tool(name, args, session_id=session_id)
            fallback = tool_result_for_voice(raw)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": raw,
                }
            )
        final = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=200,
        )
        text = (final.choices[0].message.content or "").strip()
        return text or fallback

    text = (choice.content or "").strip()
    return text or "Sorry, I could not generate a response."


async def _run_agent_reply(transcript: list[Any], *, session_id: str | None = None) -> str:
    prompt = _transcript_to_prompt(transcript)
    if not prompt:
        return "I did not catch that. Could you repeat?"

    # Prefer fast OpenAI streaming for Speech Engine turn latency.
    if os.getenv("OPENAI_API_KEY", "").strip():
        try:
            return await asyncio.wait_for(
                _run_openai_reply(transcript, session_id=session_id),
                timeout=20.0,
            )
        except TimeoutError:
            return "Sorry, that took too long. Could you ask again with a shorter question?"
        except Exception:  # noqa: BLE001
            logger.exception("OpenAI Speech Engine reply failed; falling back to agent")

    from integrations.voice.agent_runner import get_voice_agent

    agent = get_voice_agent(session_id)
    reply = await asyncio.wait_for(asyncio.to_thread(agent.chat, prompt), timeout=25.0)
    return str(reply).strip() or "Sorry, I could not generate a response."


def _latest_user_text(transcript: list[Any]) -> str:
    prompt = _transcript_to_prompt(transcript)
    if not prompt:
        return ""
    for line in reversed(prompt.splitlines()):
        if line.startswith("user:"):
            return line[5:].strip()
    return ""


async def handle_user_transcript(transcript: list[Any], session: Any) -> None:
    """Run voice LLM on transcript and send text back to Speech Engine."""
    from integrations.voice.session_memory import record_voice_turn, resolve_praison_session_id

    call_id = _conversation_id(session)
    praison_session_id = resolve_praison_session_id(call_id)
    preview = _transcript_to_prompt(transcript)
    print(f"[speech sidecar] transcript: {preview[:200]!r}", flush=True)
    reply = ""
    try:
        reply = await _run_agent_reply(transcript, session_id=praison_session_id)
        print(f"[speech sidecar] reply: {reply[:200]!r}", flush=True)
        await session.send_response(reply)
    except TimeoutError:
        reply = "Sorry, that took too long. Please try a shorter question."
        await session.send_response(reply)
    except Exception:  # noqa: BLE001
        logger.exception("Speech Engine agent reply failed")
        reply = "Sorry, something went wrong on my side."
        await session.send_response(reply)
    if call_id and reply:
        _persist_conversation_turn(call_id, transcript, reply)
        user_text = _latest_user_text(transcript)
        await record_voice_turn(call_id, user_text=user_text or None, agent_text=reply)


async def handle_session_init(conversation_id: str, session: Any) -> None:
    from integrations.voice.session_memory import bind_call_from_pending, ensure_ui_session, resolve_praison_session_id
    from integrations.voice.store import VoiceCallStore

    call_id = str(conversation_id)
    bind_call_from_pending(call_id)
    VoiceCallStore.upsert_call(
        call_id,
        status="in-progress",
        customer_number="web-speech-engine",
    )
    session_id = resolve_praison_session_id(call_id)
    if session_id:
        await ensure_ui_session(session_id, call_id=call_id)
    logger.info("Speech Engine session started: %s", conversation_id)


async def handle_session_close(session: Any) -> None:
    from integrations.voice.call_finalize import finalize_call

    conversation_id = _conversation_id(session)
    if conversation_id:
        await finalize_call(conversation_id, status="ended (customer-ended-call)")
        logger.info("Speech Engine session ended: %s", conversation_id)


async def handle_session_disconnect(session: Any) -> None:
    """Fallback when WebSocket drops without a formal close message."""
    await handle_session_close(session)


def get_webrtc_token() -> str:
    """Mint a browser conversation token (keeps API key server-side)."""
    settings = load_speech_engine_settings(require_engine_id=True)
    try:
        from elevenlabs import ElevenLabs
    except ImportError as exc:
        raise SpeechEngineConfigError("Install elevenlabs: pip install elevenlabs") from exc

    client = ElevenLabs(api_key=settings.api_key)
    response = client.conversational_ai.conversations.get_webrtc_token(
        agent_id=settings.engine_id,
    )
    token = getattr(response, "token", None) or (response.get("token") if isinstance(response, dict) else None)
    if not token:
        raise SpeechEngineConfigError("Could not mint Speech Engine conversation token")
    return str(token)
