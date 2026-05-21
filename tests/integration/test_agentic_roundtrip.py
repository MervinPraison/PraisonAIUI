"""Integration test: POST /run roundtrip persists a session."""

from __future__ import annotations

from starlette.testclient import TestClient

from praisonaiui.provider import BaseProvider, RunEvent, RunEventType
from praisonaiui.server import create_app, reset_state, set_provider


class MockProvider(BaseProvider):
    """Small provider stub for deterministic roundtrip tests."""

    async def run(self, message: str, **kwargs):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        # Keep completion content empty so the memory feature is not invoked.
        yield RunEvent(type=RunEventType.RUN_COMPLETED)

    async def health(self):
        return {"status": "ok", "provider": "MockProvider"}


def test_agentic_roundtrip_run_then_sessions_list():
    reset_state()
    set_provider(MockProvider())
    client = TestClient(create_app())

    with client.stream("POST", "/run", json={"message": "hello", "session_id": "roundtrip"}) as resp:
        assert resp.status_code == 200
        stream_text = "".join(resp.iter_text())
        assert "session" in stream_text
        assert "end" in stream_text

    sessions_resp = client.get("/sessions")
    assert sessions_resp.status_code == 200
    sessions = sessions_resp.json().get("sessions", [])
    assert any(s.get("id") == "roundtrip" for s in sessions)
