"""Integration tests for all server endpoints.

Tests cover the full request/response cycle for every endpoint,
including callback registration, SSE streaming, auth flow, session
management, and the @reply type dispatch.

Run with:
    python -m pytest tests/integration/test_endpoints.py -v -o "addopts="
"""

import asyncio
import json

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import (
    MessageContext,
    _agents,
    _callbacks,
    _datastore,
    create_app,
    register_agent,
    register_callback,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_state():
    """Reset global state before each test."""
    _agents.clear()
    _callbacks.clear()
    yield
    _agents.clear()
    _callbacks.clear()


@pytest.fixture
def client():
    """Bare app with no callbacks registered."""
    return TestClient(create_app())


@pytest.fixture
def str_app():
    """App with str-typed @reply (simulates chat-app/app.py)."""
    from praisonaiui.callbacks import reply, welcome, starters, profiles, cancel

    @welcome
    async def on_welcome():
        from praisonaiui.callbacks import say
        await say("Welcome!")

    @reply
    async def on_message(message: str):
        from praisonaiui.callbacks import say, think, action_buttons
        await think("Processing...")
        await say(f"Echo: {message}")
        await action_buttons([{"name": "like", "label": "👍"}])

    @starters
    def get_starters():
        return [
            {"label": "Hi", "message": "Hello!", "icon": "👋"},
            {"label": "Help", "message": "Help me", "icon": "❓"},
        ]

    @profiles
    def get_profiles():
        return [
            {"name": "Default", "description": "Default profile", "icon": "🤖"},
        ]

    @cancel
    async def on_cancel():
        pass

    return TestClient(create_app())


@pytest.fixture
def ctx_app():
    """App with MessageContext-typed @reply."""
    from praisonaiui.callbacks import reply

    @reply
    async def on_message(msg: MessageContext):
        from praisonaiui.callbacks import say
        await say(f"ctx:text={msg.text},session={msg.session_id}")

    return TestClient(create_app())


@pytest.fixture
def untyped_app():
    """App with untyped @reply parameter (should receive MessageContext)."""
    from praisonaiui.callbacks import reply

    @reply
    async def on_message(msg):
        from praisonaiui.callbacks import say
        await say(f"type={type(msg).__name__}")

    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
        assert "timestamp" in r.json()


# ---------------------------------------------------------------------------
# Starters & Profiles endpoints
# ---------------------------------------------------------------------------

class TestStarters:
    def test_empty_when_no_callback(self, client):
        r = client.get("/starters")
        assert r.status_code == 200
        assert r.json() == {"starters": []}

    def test_returns_registered_starters(self, str_app):
        r = str_app.get("/starters")
        assert r.status_code == 200
        data = r.json()["starters"]
        assert len(data) == 2
        assert data[0]["label"] == "Hi"
        assert data[1]["icon"] == "❓"

    def test_sync_function_works(self, str_app):
        """Starters callback is a plain sync function, not async."""
        r = str_app.get("/starters")
        assert r.status_code == 200
        assert len(r.json()["starters"]) == 2

    def test_async_starters(self, client):
        """Register an async starters callback."""
        async def astarters():
            return [{"label": "Async", "message": "Hello"}]

        register_callback("starters", astarters)
        app = create_app()
        c = TestClient(app)
        r = c.get("/starters")
        assert r.status_code == 200
        assert r.json()["starters"][0]["label"] == "Async"


class TestProfiles:
    def test_empty_when_no_callback(self, client):
        r = client.get("/profiles")
        assert r.status_code == 200
        assert r.json() == {"profiles": []}

    def test_returns_registered_profiles(self, str_app):
        r = str_app.get("/profiles")
        assert r.status_code == 200
        data = r.json()["profiles"]
        assert len(data) == 1
        assert data[0]["name"] == "Default"


# ---------------------------------------------------------------------------
# Welcome SSE endpoint
# ---------------------------------------------------------------------------

class TestWelcome:
    def test_welcome_empty_when_no_callback(self, client):
        r = client.post("/welcome")
        assert r.status_code == 200
        lines = [l for l in r.text.strip().split("\n") if l.startswith("data:")]
        last_event = json.loads(lines[-1].replace("data: ", ""))
        assert last_event["type"] == "end"

    def test_welcome_streams_message(self, str_app):
        r = str_app.post("/welcome")
        assert r.status_code == 200
        events = _parse_sse(r.text)
        messages = [e for e in events if e.get("type") == "message"]
        assert len(messages) == 1
        assert messages[0]["content"] == "Welcome!"

    def test_welcome_ends_stream(self, str_app):
        r = str_app.post("/welcome")
        events = _parse_sse(r.text)
        assert events[-1]["type"] == "end"


# ---------------------------------------------------------------------------
# @reply Type Dispatch
# ---------------------------------------------------------------------------

class TestReplyTypeDispatch:
    def test_str_typed_receives_string(self, str_app):
        """@reply with `message: str` receives the text string."""
        r = str_app.post("/run", json={"message": "Hello World"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        messages = [e for e in events if e.get("type") == "message"]
        assert any("Echo: Hello World" in m["content"] for m in messages)

    def test_context_typed_receives_context(self, ctx_app):
        """@reply with `msg: MessageContext` receives the full context."""
        r = ctx_app.post("/run", json={"message": "Test msg"})
        assert r.status_code == 200
        events = _parse_sse(r.text)
        messages = [e for e in events if e.get("type") == "message"]
        assert len(messages) >= 1
        content = messages[0]["content"]
        assert "ctx:text=Test msg" in content
        assert "session=" in content

    def test_untyped_receives_context(self, untyped_app):
        """@reply with no annotation receives MessageContext."""
        r = untyped_app.post("/run", json={"message": "X"})
        events = _parse_sse(r.text)
        messages = [e for e in events if e.get("type") == "message"]
        assert any("type=MessageContext" in m["content"] for m in messages)


# ---------------------------------------------------------------------------
# Run endpoint — SSE events
# ---------------------------------------------------------------------------

class TestRunEndpoint:
    def test_includes_session_event(self, str_app):
        r = str_app.post("/run", json={"message": "Hi"})
        events = _parse_sse(r.text)
        session_events = [e for e in events if e.get("type") == "session"]
        assert len(session_events) == 1
        assert "session_id" in session_events[0]

    def test_includes_thinking_events(self, str_app):
        r = str_app.post("/run", json={"message": "Hi"})
        events = _parse_sse(r.text)
        thinking = [e for e in events if e.get("type") == "thinking"]
        assert len(thinking) >= 1
        assert thinking[0]["step"] == "Processing..."

    def test_includes_action_buttons(self, str_app):
        r = str_app.post("/run", json={"message": "Hi"})
        events = _parse_sse(r.text)
        actions = [e for e in events if e.get("type") == "actions"]
        assert len(actions) == 1
        assert actions[0]["buttons"][0]["name"] == "like"

    def test_ends_with_end_event(self, str_app):
        r = str_app.post("/run", json={"message": "Hi"})
        events = _parse_sse(r.text)
        assert events[-1]["type"] == "end"

    def test_auto_creates_session(self, str_app):
        r = str_app.post("/run", json={"message": "Hi"})
        events = _parse_sse(r.text)
        session_id = events[0]["session_id"]
        # Verify session exists via the datastore
        import asyncio
        session = asyncio.get_event_loop().run_until_complete(
            _datastore.get_session(session_id)
        )
        assert session is not None

    def test_uses_existing_session(self, str_app):
        # Create session first
        s = str_app.post("/sessions").json()["session_id"]
        r = str_app.post("/run", json={"message": "Hi", "session_id": s})
        events = _parse_sse(r.text)
        assert events[0]["session_id"] == s

    def test_saves_user_message_to_session(self, str_app):
        s = str_app.post("/sessions").json()["session_id"]
        str_app.post("/run", json={"message": "Saved msg", "session_id": s})
        runs = str_app.get(f"/sessions/{s}/runs").json()["runs"]
        assert any(r["content"] == "Saved msg" for r in runs)

    def test_invalid_json_returns_400(self, str_app):
        r = str_app.post(
            "/run",
            content="not json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_no_callback_returns_echo(self, client):
        r = client.post("/run", json={"message": "Hi"})
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Sessions CRUD
# ---------------------------------------------------------------------------

class TestSessions:
    def test_list_empty(self, client):
        assert client.get("/sessions").json() == {"sessions": []}

    def test_create_and_get(self, client):
        sid = client.post("/sessions").json()["session_id"]
        r = client.get(f"/sessions/{sid}")
        assert r.status_code == 200
        assert r.json()["id"] == sid

    def test_get_nonexistent_404(self, client):
        assert client.get("/sessions/fake").status_code == 404

    def test_delete(self, client):
        sid = client.post("/sessions").json()["session_id"]
        assert client.delete(f"/sessions/{sid}").status_code == 200
        assert client.get(f"/sessions/{sid}").status_code == 404

    def test_delete_nonexistent_404(self, client):
        assert client.delete("/sessions/fake").status_code == 404

    def test_runs_empty(self, client):
        sid = client.post("/sessions").json()["session_id"]
        r = client.get(f"/sessions/{sid}/runs")
        assert r.json()["runs"] == []

    def test_runs_nonexistent_404(self, client):
        assert client.get("/sessions/fake/runs").status_code == 404

    def test_multi_message_history(self, str_app):
        sid = str_app.post("/sessions").json()["session_id"]
        str_app.post("/run", json={"message": "First", "session_id": sid})
        str_app.post("/run", json={"message": "Second", "session_id": sid})
        runs = str_app.get(f"/sessions/{sid}/runs").json()["runs"]
        user_msgs = [r for r in runs if r["role"] == "user"]
        assert len(user_msgs) == 2
        assert user_msgs[0]["content"] == "First"
        assert user_msgs[1]["content"] == "Second"

    def test_list_shows_session_count(self, client):
        client.post("/sessions")
        client.post("/sessions")
        sessions = client.get("/sessions").json()["sessions"]
        assert len(sessions) == 2


# ---------------------------------------------------------------------------
# Auth flow
# ---------------------------------------------------------------------------

class TestAuth:
    def test_register(self, client):
        r = client.post("/register", json={"username": "u1", "password": "p1"})
        assert r.status_code == 200
        assert "token" in r.json()
        assert r.json()["user"]["username"] == "u1"

    def test_login(self, client):
        client.post("/register", json={"username": "u2", "password": "p2"})
        r = client.post("/login", json={"username": "u2", "password": "p2"})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_login_wrong_password(self, client):
        client.post("/register", json={"username": "u3", "password": "p3"})
        r = client.post("/login", json={"username": "u3", "password": "wrong"})
        assert r.status_code == 401

    def test_me_with_token(self, client):
        reg = client.post("/register", json={"username": "u4", "password": "p4"})
        token = reg.json()["token"]
        r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["username"] == "u4"

    def test_me_without_token(self, client):
        assert client.get("/me").status_code == 401

    def test_logout(self, client):
        r = client.post("/logout")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Cancel endpoint
# ---------------------------------------------------------------------------

class TestCancel:
    def test_cancel_no_active_run(self, client):
        r = client.post("/cancel", json={"session_id": "x"})
        assert r.status_code == 200
        assert r.json()["status"] == "no_active_run"


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

class TestAgents:
    def test_list_empty(self, client):
        assert client.get("/agents").json() == {"agents": []}

    def test_list_with_registered(self, client):
        register_agent("a1", {"name": "Agent1"})
        r = client.get("/agents")
        assert len(r.json()["agents"]) == 1
        assert r.json()["agents"][0]["name"] == "a1"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_sse(text: str) -> list[dict]:
    """Parse SSE text into a list of JSON events."""
    events = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            payload = line[len("data:"):].strip()
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    return events
