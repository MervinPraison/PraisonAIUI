"""Voice input (speech to text), behind the realtime feature.

``aiui.set_realtime_manager(manager)`` with a manager that implements
``transcribe`` turns it on; ``GET /api/realtime/voice`` says so and
``POST /api/realtime/transcribe`` turns one recorded clip into text.
"""

from __future__ import annotations

import sys
import types
from typing import Any, AsyncIterator, Dict

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.features import realtime
from praisonaiui.features.realtime import (
    VOICE_MAX_BYTES,
    OpenAIRealtimeManager,
    RealtimeFeature,
    RealtimeProtocol,
    set_realtime_manager,
    voice_input_enabled,
)


class _Base(RealtimeProtocol):
    async def create_session(self, *, model: str = "x") -> Dict[str, Any]:
        return {}

    async def send_audio(self, session_id: str, audio_data: bytes) -> None:
        return None

    async def receive_audio(self, session_id: str) -> AsyncIterator[Dict[str, Any]]:
        if False:
            yield {}

    async def call_tool(self, session_id: str, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        return {}

    async def close_session(self, session_id: str) -> None:
        return None


class _Speech(_Base):
    def __init__(self, text: str = "  hello there  ", error: Exception | None = None):
        self.text, self.error, self.calls = text, error, []

    async def transcribe(self, audio: bytes, *, mime_type: str) -> str:
        self.calls.append((audio, mime_type))
        if self.error:
            raise self.error
        return self.text


@pytest.fixture(autouse=True)
def _reset():
    saved = (realtime._realtime_manager, realtime._app_manager)
    realtime._realtime_manager, realtime._app_manager = None, False
    yield
    realtime._realtime_manager, realtime._app_manager = saved


def _client() -> TestClient:
    return TestClient(Starlette(routes=RealtimeFeature().routes()))


def test_off_by_default_even_though_the_default_manager_can_transcribe():
    assert OpenAIRealtimeManager().supports_transcription()
    assert voice_input_enabled() is False
    body = _client().get("/api/realtime/voice").json()
    assert body == {"enabled": False, "max_seconds": realtime.VOICE_MAX_SECONDS, "max_bytes": VOICE_MAX_BYTES}
    r = _client().post("/api/realtime/transcribe", content=b"abc", headers={"content-type": "audio/webm"})
    assert r.status_code == 404


def test_an_app_manager_that_transcribes_turns_it_on_and_none_turns_it_off():
    set_realtime_manager(_Speech())
    assert _client().get("/api/realtime/voice").json()["enabled"] is True
    set_realtime_manager(None)
    assert voice_input_enabled() is False


def test_a_manager_without_transcribe_keeps_voice_input_off():
    mgr = _Base()
    assert mgr.supports_transcription() is False
    set_realtime_manager(mgr)
    assert _client().get("/api/realtime/voice").json()["enabled"] is False


def test_transcribe_returns_the_trimmed_text_and_passes_the_clip_through():
    mgr = _Speech()
    set_realtime_manager(mgr)
    r = _client().post("/api/realtime/transcribe", content=b"OPUS", headers={"content-type": "audio/webm;codecs=opus"})
    assert r.status_code == 200
    assert r.json() == {"text": "hello there"}
    assert mgr.calls == [(b"OPUS", "audio/webm;codecs=opus")]


@pytest.mark.parametrize(
    ("body", "ctype", "status"),
    [
        (b"x", "application/json", 415),
        (b"", "audio/webm", 400),
        (b"x" * (VOICE_MAX_BYTES + 1), "audio/webm", 413),
    ],
)
def test_transcribe_refuses_what_is_not_one_audio_clip(body, ctype, status):
    mgr = _Speech()
    set_realtime_manager(mgr)
    r = _client().post("/api/realtime/transcribe", content=body, headers={"content-type": ctype})
    assert r.status_code == status
    assert "error" in r.json()
    assert mgr.calls == []


def test_a_provider_failure_is_a_502_without_its_message():
    set_realtime_manager(_Speech(error=RuntimeError("401 sk-secret-key rejected")))
    r = _client().post("/api/realtime/transcribe", content=b"x", headers={"content-type": "audio/mp4"})
    assert r.status_code == 502
    assert "sk-secret" not in r.text


def test_openai_manager_transcribes_with_the_speech_to_text_endpoint(monkeypatch):
    seen: dict[str, Any] = {}

    class _Transcriptions:
        async def create(self, **kw):
            seen.update(kw)
            return types.SimpleNamespace(text="from openai")

    class _Client:
        def __init__(self, *a, **k):
            self.audio = types.SimpleNamespace(transcriptions=_Transcriptions())

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(AsyncOpenAI=_Client))
    import asyncio

    mgr = OpenAIRealtimeManager(transcribe_model="whisper-1")
    assert asyncio.run(mgr.transcribe(b"RIFF", mime_type="audio/mp4")) == "from openai"
    assert seen["model"] == "whisper-1"
    assert seen["file"] == ("voice.mp4", b"RIFF", "audio/mp4")
    assert OpenAIRealtimeManager().transcribe_model == OpenAIRealtimeManager.DEFAULT_TRANSCRIBE_MODEL


@pytest.mark.parametrize("mode", ["enforce", "require_auth", "token"])
def test_voice_routes_need_credentials_in_every_auth_mode(mode, monkeypatch, tmp_path):
    """R8: both routes sit behind auth like every other /api route."""
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    kwargs: dict[str, Any] = {}
    if mode == "enforce":
        monkeypatch.setenv("AUTH_ENFORCE", "true")
    elif mode == "require_auth":
        kwargs["require_auth"] = True
    else:
        monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "test-secret-token")
        monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    from praisonaiui import server

    server.reset_state()
    try:
        set_realtime_manager(_Speech())
        client = TestClient(server.create_app(**kwargs))
        assert client.get("/api/realtime/voice").status_code in (401, 403)
        r = client.post("/api/realtime/transcribe", content=b"x", headers={"content-type": "audio/webm"})
        assert r.status_code in (401, 403)
        if mode == "token":
            ok = client.get("/api/realtime/voice", headers={"Authorization": "Bearer test-secret-token"})
            assert ok.status_code == 200 and ok.json()["enabled"] is True
    finally:
        server.reset_state()
