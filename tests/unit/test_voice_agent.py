"""Unit tests for Voice Agent integration.

The example lives in ``examples/python/voice-agent`` and ships its own
``integrations.voice`` package. The wider test-suite also owns a top-level
``integrations`` package (``tests/unit/integrations``), so importing the
example's modules requires temporarily giving the example's directory
priority on ``sys.path`` and restoring the original ``integrations`` package
afterwards — otherwise the cached test package shadows ``integrations.voice``.
"""

from __future__ import annotations

import contextlib
import importlib
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[2] / "examples" / "python" / "voice-agent"


@contextlib.contextmanager
def _voice_modules():
    """Import the example's ``integrations.voice`` package in isolation."""
    saved = {
        name: mod
        for name, mod in list(sys.modules.items())
        if name == "integrations" or name.startswith("integrations.")
    }
    for name in saved:
        del sys.modules[name]
    sys.path.insert(0, str(_ROOT))
    try:
        yield importlib.import_module
    finally:
        with contextlib.suppress(ValueError):
            sys.path.remove(str(_ROOT))
        for name in [
            name
            for name in list(sys.modules)
            if name == "integrations" or name.startswith("integrations.")
        ]:
            del sys.modules[name]
        sys.modules.update(saved)


@pytest.fixture(autouse=True)
def voice_env(monkeypatch, tmp_path):
    monkeypatch.setenv("VOICE_API_KEY", "test-voice-key")
    monkeypatch.setenv("VOICE_API_BASE", "https://voice-provider.example.test")
    monkeypatch.setenv("VOICE_SERVER_URL_SECRET", "secret-123")
    monkeypatch.setenv("PUBLIC_API_BASE_URL", "https://voice-dev.example.test")
    monkeypatch.setenv("PRAISONAI_VOICE_DIR", str(tmp_path))


def test_execute_tool_get_current_time():
    with _voice_modules() as imp:
        tools = imp("integrations.voice.tools")
        raw = tools.execute_tool("get_current_time", {})
    assert "utc" in raw


def test_demo_tool_reply_time_and_echo():
    with _voice_modules() as imp:
        tools = imp("integrations.voice.tools")
        time_reply = tools.demo_tool_reply("What time is it?")
        echo_reply = tools.demo_tool_reply("Echo hello world")
    assert time_reply is not None
    assert "UTC time" in time_reply
    assert echo_reply is not None
    assert "hello world" in echo_reply.lower()


def test_speech_engine_demo_fast_path():
    with _voice_modules() as imp:
        se = imp("integrations.voice.speech_engine")

        class Msg:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        reply = se._try_demo_tool_reply([Msg("user", "Tell me the time please")])
    assert reply is not None
    assert "UTC time" in reply


def test_openai_tool_schemas():
    with _voice_modules() as imp:
        tools = imp("integrations.voice.tools")
        schemas = tools.openai_tool_schemas()
        names = [s["function"]["name"] for s in schemas]
    assert "get_current_time" in names
    assert "echo_message" in names


def test_tool_calls_webhook_response():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        settings = config.load_voice_settings()
        payload = {
            "message": {
                "type": "tool-calls",
                "call": {"id": "call-1", "customer": {"number": "+15551234567"}},
                "toolCallList": [
                    {"id": "tc-1", "name": "echo_message", "parameters": {"message": "hello"}}
                ],
            }
        }
        result = processor.process_voice_webhook("tool-calls", payload, settings=settings)
    assert result["results"][0]["name"] == "echo_message"
    assert "hello" in result["results"][0]["result"]


def test_tool_calls_accepts_arguments_field():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        settings = config.load_voice_settings()
        payload = {
            "message": {
                "type": "tool-calls",
                "call": {"id": "call-2"},
                "toolCallList": [{"id": "tc-2", "name": "get_current_time", "arguments": {}}],
            }
        }
        result = processor.process_voice_webhook("tool-calls", payload, settings=settings)
    assert "time" in result["results"][0]["result"].lower()


def test_assistant_request_returns_default_assistant(monkeypatch):
    monkeypatch.setenv("VOICE_ASSISTANT_ID", "asst-123")
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        settings = config.load_voice_settings()
        result = processor.process_voice_webhook(
            "assistant-request",
            {"message": {"type": "assistant-request", "call": {"id": "c1"}}},
            settings=settings,
        )
    assert result == {"assistantId": "asst-123"}


def test_transcript_appends_final_lines():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        store = imp("integrations.voice.store")
        settings = config.load_voice_settings()
        payload = {
            "message": {
                "type": "transcript",
                "call": {"id": "call-t1"},
                "role": "user",
                "transcriptType": "final",
                "transcript": "I need the time",
            }
        }
        processor.process_voice_webhook("transcript", payload, settings=settings)
        record = store.VoiceCallStore.get_call("call-t1")
    assert "user: I need the time" in record["transcript"]


def test_transcript_preserves_live_status():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        store = imp("integrations.voice.store")
        settings = config.load_voice_settings()
        processor.process_voice_webhook(
            "status-update",
            {"message": {"type": "status-update", "call": {"id": "call-s1"}, "status": "in-progress"}},
            settings=settings,
        )
        processor.process_voice_webhook(
            "transcript",
            {
                "message": {
                    "type": "transcript",
                    "call": {"id": "call-s1"},
                    "role": "user",
                    "transcriptType": "final",
                    "transcript": "hello there",
                }
            },
            settings=settings,
        )
        record = store.VoiceCallStore.get_call("call-s1")
    assert record["status"] == "in-progress"
    assert "user: hello there" in record["transcript"]


def test_status_updates_are_not_collapsed_by_idempotency_key():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        store = imp("integrations.voice.store")
        settings = config.load_voice_settings()
        big_call = {
            "id": "call-cascade",
            "orgId": "org-" * 40,
            "assistantId": "asst-" * 40,
            "customer": {"number": "+15551234567"},
        }

        def status_event(status):
            return {"message": {"call": big_call, "status": status, "type": "status-update"}}

        for status in ("ringing", "in-progress", "ended"):
            processor.process_voice_webhook("status-update", status_event(status), settings=settings)
        record = store.VoiceCallStore.get_call("call-cascade")
    assert record["status"] == "ended"


def test_verify_secret_header():
    with _voice_modules() as imp:
        verify = imp("integrations.voice.verify")
        verify.verify_webhook_request(
            secret="secret-123",
            headers={"x-voice-webhook-secret": "secret-123"},
        )
        with pytest.raises(verify.VerificationError):
            verify.verify_webhook_request(
                secret="secret-123", headers={"x-voice-webhook-secret": "wrong"}
            )


def test_create_call_request_body(monkeypatch):
    monkeypatch.setenv("VOICE_ASSISTANT_ID", "asst-1")
    monkeypatch.setenv("VOICE_PHONE_NUMBER_ID", "pn-1")
    with _voice_modules() as imp:
        client_mod = imp("integrations.voice.client")
        config_mod = imp("integrations.voice.config")
        settings = config_mod.load_voice_settings()
        client = client_mod.VoiceClient(settings)
        client._request = MagicMock(return_value={"id": "call-1"})  # noqa: SLF001
        client.create_call(customer_number="+15551234567")
        body = client._request.call_args.kwargs["json_body"]  # noqa: SLF001
    assert body["assistantId"] == "asst-1"
    assert body["customer"]["number"] == "+15551234567"


def test_transcript_hub_publish_sync():
    with _voice_modules() as imp:
        live = imp("integrations.voice.live")
        hub = live.TranscriptHub()
        hub.publish("call-x", {"type": "transcript", "text": "hello"})


def test_dynamic_assistant_request(monkeypatch):
    monkeypatch.setenv("VOICE_ASSISTANT_ID", "asst-123")
    monkeypatch.setenv("VOICE_DYNAMIC_ASSISTANT", "true")
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        settings = config.load_voice_settings()
        result = processor.process_voice_webhook(
            "assistant-request",
            {"message": {"type": "assistant-request", "call": {"id": "c1"}}},
            settings=settings,
        )
    assert "assistant" in result
    assert result["assistant"]["name"] == "Praison Voice Assistant"


def test_chat_bridge_session_id():
    with _voice_modules() as imp:
        bridge = imp("integrations.voice.chat_bridge")
        assert bridge.voice_session_id("abc-123") == "voice-abc-123"


def test_speech_engine_settings_ws_url(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-test-key")
    monkeypatch.setenv("SPEECH_ENGINE_PUBLIC_URL", "https://speech-tunnel.example.test")
    with _voice_modules() as imp:
        se = imp("integrations.voice.speech_engine")
        settings = se.load_speech_engine_settings()
    assert settings.public_ws_url == "wss://speech-tunnel.example.test/ws"


def test_speech_engine_transcript_prompt():
    with _voice_modules() as imp:
        se = imp("integrations.voice.speech_engine")

        class Msg:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        prompt = se._transcript_to_prompt([Msg("user", "What time is it?")])
    assert "user: What time is it?" in prompt


def test_speech_engine_transcript_display_includes_agent_reply():
    with _voice_modules() as imp:
        se = imp("integrations.voice.speech_engine")

        class Msg:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        text = se._transcript_display_text([Msg("user", "Hello")], "Hi there!")
    assert text == "user: Hello\nagent: Hi there!"


def test_speech_engine_persist_turn(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_VOICE_DIR", str(tmp_path))
    with _voice_modules() as imp:
        se = imp("integrations.voice.speech_engine")
        store = imp("integrations.voice.store")

        class Msg:
            def __init__(self, role, content):
                self.role = role
                self.content = content

        se._persist_conversation_turn("conv-test-1", [Msg("user", "What time is it?")], "It is noon UTC.")
        record = store.VoiceCallStore.get_call("conv-test-1")
    assert record is not None
    assert "user: What time is it?" in record["transcript"]
    assert "agent: It is noon UTC." in record["transcript"]


def test_transcript_publishes_to_hub():
    with _voice_modules() as imp:
        processor = imp("integrations.voice.processor")
        config = imp("integrations.voice.config")
        live = imp("integrations.voice.live")
        settings = config.load_voice_settings()
        payload = {
            "message": {
                "type": "transcript",
                "call": {"id": "call-hub"},
                "role": "assistant",
                "transcriptType": "partial",
                "transcript": "One moment",
            }
        }
        processor.process_voice_webhook("transcript", payload, settings=settings)
        live.transcript_hub.publish("call-hub", {"type": "ping"})


def test_realtime_settings_and_session_config(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("REALTIME_MODEL", "gpt-realtime-2.1-mini")
    monkeypatch.setenv("REALTIME_VOICE", "marin")
    monkeypatch.setenv("REALTIME_REASONING_EFFORT", "low")
    with _voice_modules() as imp:
        rt = imp("integrations.voice.realtime")
        settings = rt.load_realtime_settings()
        session = rt.build_session_config(settings)
    assert settings.model == "gpt-realtime-2.1-mini"
    assert session["type"] == "realtime"
    assert session["model"] == "gpt-realtime-2.1-mini"
    assert session["reasoning"]["effort"] == "low"
    assert session["audio"]["output"]["voice"] == "marin"
    assert "input_audio_transcription" in session


def test_call_detail_ui_layout():
    with _voice_modules() as imp:
        ui = imp("integrations.voice.call_detail_ui")
        layout = ui.build_call_detail_layout(
            {
                "call_id": "conv-test",
                "status": "in-progress",
                "customer_number": "web-speech-engine",
                "transcript": "user: hello\nagent: hi",
                "summary": "",
                "metadata": {"user_id": "u-1", "praison_session_id": "voice-user-u-1"},
            }
        )
        children = layout.get("_components") or []
        types = [c.get("type") for c in children]
    assert "badge" in types
    assert "key_value_list" in types
    assert "tabs" in types


def test_voice_memory_bind_and_history(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_VOICE_DIR", str(tmp_path))
    monkeypatch.setenv("VOICE_MEMORY_ENABLED", "true")
    with _voice_modules() as imp:
        sm = imp("integrations.voice.session_memory")
        store = imp("integrations.voice.store")
        session_id = sm.bind_call_user("call-a", "user-123")
        assert session_id == "voice-user-user-123"
        sm.append_session_turn(session_id, "user", "codeword is blue")
        sm.append_session_turn(session_id, "assistant", "Got it.")
        block = sm.history_context_block(session_id)
        assert "codeword is blue" in block
        assert sm.resolve_call_user("call-a") == "user-123"
        store.VoiceCallStore.set_pending_user("user-pending")
        bound = sm.bind_call_from_pending("call-b")
        assert bound == "voice-user-user-pending"
        assert sm.resolve_call_user("call-b") == "user-pending"
        assert store.VoiceCallStore.consume_pending_user() is None


def test_realtime_persist_transcript(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_VOICE_DIR", str(tmp_path))
    with _voice_modules() as imp:
        rt = imp("integrations.voice.realtime")
        store = imp("integrations.voice.store")
        rt.mark_session_started("rt-call-1")
        rt.persist_transcript_line("rt-call-1", "user", "My name is Alex")
        rt.persist_transcript_line("rt-call-1", "agent", "Hi Alex!")
        record = store.VoiceCallStore.get_call("rt-call-1")
    assert record is not None
    assert "user: My name is Alex" in record["transcript"]
    assert "agent: Hi Alex!" in record["transcript"]


def test_call_finalize_analytics():
    with _voice_modules() as imp:
        cf = imp("integrations.voice.call_finalize")
        transcript = "user: hello\nagent: hi there\nuser: thanks"
        assert cf.count_turns(transcript) == 3
        assert cf.format_duration(45) == "45s"
        assert cf.format_duration(125) == "2m 5s"
        record = {
            "transcript": transcript,
            "created_at": "2026-01-01T12:00:00+00:00",
            "metadata": {"ended_at": "2026-01-01T12:01:30+00:00"},
        }
        analytics = cf.analytics_for_record(record)
    assert analytics["turn_count"] == 3
    assert analytics["duration_sec"] == 90
    assert analytics["duration"] == "1m 30s"


@pytest.mark.asyncio
async def test_finalize_call_persists_summary_and_analytics(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAISONAI_VOICE_DIR", str(tmp_path))

    async def fake_summary(_transcript: str) -> str:
        return "Demo call about scheduling."

    enqueued: list[tuple] = []

    def fake_enqueue(call_id, summary, status):
        enqueued.append((call_id, summary, status))

    with _voice_modules() as imp:
        cf = imp("integrations.voice.call_finalize")
        store = imp("integrations.voice.store")
        chat_bridge = imp("integrations.voice.chat_bridge")
        monkeypatch.setattr(cf, "generate_call_summary", fake_summary)
        monkeypatch.setattr(chat_bridge, "enqueue_call_summary", fake_enqueue)
        store.VoiceCallStore.upsert_call(
            "call-final",
            status="in-progress",
            transcript="user: book a meeting\nagent: sure",
        )
        await cf.finalize_call("call-final", status="ended (customer-ended-call)")
        record = store.VoiceCallStore.get_call("call-final")
    assert record is not None
    assert record["summary"] == "Demo call about scheduling."
    assert record["metadata"]["turn_count"] == 2
    assert record["metadata"]["duration_sec"] is not None
    assert enqueued == [("call-final", "Demo call about scheduling.", "ended (customer-ended-call)")]


def test_voice_doctor_report(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key-12345678")
    with _voice_modules() as imp:
        doctor = imp("integrations.voice.doctor")
        report = doctor.run_voice_doctor(app_port=59999, sidecar_port=59998)
    assert "checks" in report
    assert "summary" in report
    names = [c["name"] for c in report["checks"]]
    assert "OPENAI_API_KEY" in names
    assert report["summary"]["failed"] >= 1


def test_call_detail_ui_includes_analytics():
    with _voice_modules() as imp:
        ui = imp("integrations.voice.call_detail_ui")
        layout = ui.build_call_detail_layout(
            {
                "call_id": "conv-analytics",
                "status": "ended (customer-ended-call)",
                "customer_number": "web-speech-engine",
                "transcript": "user: one\nagent: two",
                "summary": "Short demo.",
                "metadata": {"turn_count": 2, "duration_sec": 30},
                "created_at": "2026-01-01T12:00:00+00:00",
            }
        )
        kv = next(c for c in (layout.get("_components") or []) if c.get("type") == "key_value_list")
        labels = [item.get("label") for item in kv.get("items") or []]
    assert "Duration" in labels
    assert "Turns" in labels
