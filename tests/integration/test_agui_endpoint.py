"""Integration tests for AG-UI /agui endpoint."""

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def client():
    from praisonaiui.server import create_app, register_agent

    try:
        from praisonaiagents import Agent

        agent = Agent(name="test", instructions="Reply briefly.")
        register_agent("test", agent)
    except ImportError:
        pytest.skip("praisonaiagents not installed")

    return TestClient(create_app())


def test_agui_status(client):
    r = client.get("/agui/status")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data


def test_agui_post_streams(client, monkeypatch):
    async def _fake_run_agent(self, run_input):
        from praisonaiagents.ui.agui.types import RunFinishedEvent, RunStartedEvent

        yield RunStartedEvent(thread_id=run_input.thread_id or "t1", run_id=run_input.run_id or "r1")
        yield RunFinishedEvent(thread_id=run_input.thread_id or "t1", run_id=run_input.run_id or "r1")

    try:
        from praisonaiagents.ui.agui import AGUI

        monkeypatch.setattr(AGUI, "_run_agent", _fake_run_agent)
    except ImportError:
        pytest.skip("praisonaiagents not installed")

    r = client.post(
        "/agui",
        json={
            "thread_id": "t1",
            "run_id": "r1",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")
    assert "data:" in r.text
