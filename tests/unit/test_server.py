"""Unit tests for the server module."""

import pytest
from starlette.testclient import TestClient

from praisonaiui.datastore import MemoryDataStore
from praisonaiui.server import (
    _agents,
    _callbacks,
    create_app,
    register_agent,
    register_callback,
    set_datastore,
)


@pytest.fixture
def client():
    """Create a test client with isolated state."""
    # Clear state before each test
    _agents.clear()
    _callbacks.clear()
    set_datastore(MemoryDataStore())
    app = create_app()
    return TestClient(app)


class TestHealthEndpoint:
    """Tests for health endpoint."""

    def test_health_returns_ok(self, client):
        """Test health endpoint returns ok status."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data

    def test_health_live_is_fast(self, client):
        """Test liveness endpoint returns quickly."""
        import time

        start = time.time()
        response = client.get("/health/live")
        duration = time.time() - start

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        # Should respond in under 100ms (generous for tests)
        assert duration < 0.1

    def test_health_ready_with_deep_check(self, client):
        """Test readiness endpoint with deep feature checks."""
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        assert "provider" in data

    def test_health_ready_without_deep_check(self, client):
        """Test readiness endpoint with deep=false skips feature checks."""
        response = client.get("/health/ready?deep=false")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        # Features should not be present when deep=false
        assert "features" not in data

    def test_api_health_is_cached(self, client):
        """Test /api/health endpoint uses caching."""
        import time

        # First request
        response1 = client.get("/api/health")
        assert response1.status_code == 200
        data1 = response1.json()

        # Second request should be cached
        time.sleep(0.1)
        response2 = client.get("/api/health")
        assert response2.status_code == 200
        data2 = response2.json()

        # Timestamps should be identical (cached)
        assert data1["timestamp"] == data2["timestamp"]

    def test_health_endpoints_accessible(self, client):
        """Test all health endpoints are accessible."""
        endpoints = [
            "/health",
            "/health/live",
            "/health/ready",
            "/api/health",
            "/api/health/live",
            "/api/health/ready",
        ]
        for endpoint in endpoints:
            response = client.get(endpoint)
            assert response.status_code == 200


class TestProviderHealthEndpoint:
    """Tests for the provider health JSON route (#151)."""

    def test_api_provider_health_is_json(self, client):
        """/api/provider/health returns JSON, not the SPA HTML shell."""
        response = client.get("/api/provider/health")
        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        body = response.json()
        assert "status" in body
        assert "type" in body
        assert "agents" in body
        assert "detail" in body

    def test_api_provider_health_accept_json(self, client):
        """Accept: application/json still yields JSON body."""
        response = client.get(
            "/api/provider/health", headers={"Accept": "application/json"}
        )
        assert response.status_code == 200
        assert "application/json" in response.headers["content-type"]
        assert "status" in response.json()

    def test_unknown_api_path_not_html(self, client):
        """Unmatched /api/* paths return JSON 404, never SPA HTML 200."""
        response = client.get("/api/this-route-does-not-exist")
        assert response.status_code == 404
        assert "text/html" not in response.headers.get("content-type", "")
        assert "application/json" in response.headers["content-type"]

    def test_provider_health_route_before_catchall(self, client):
        """The dedicated route is registered before the SPA catch-all."""
        paths = [getattr(r, "path", None) for r in client.app.routes]
        assert "/api/provider/health" in paths
        catchall = next(
            (i for i, p in enumerate(paths) if p == "/{path:path}"), None
        )
        if catchall is not None:
            assert paths.index("/api/provider/health") < catchall


class TestAgentsEndpoint:
    """Tests for agents endpoint."""

    def test_list_agents_empty(self, client):
        """Test listing agents when none registered."""
        response = client.get("/agents")
        assert response.status_code == 200
        data = response.json()
        assert data["agents"] == []

    def test_list_agents_with_registered(self, client):
        """Test listing agents after registration."""
        register_agent("test-agent", {"name": "Test"})
        response = client.get("/agents")
        assert response.status_code == 200
        data = response.json()
        assert len(data["agents"]) == 1
        assert data["agents"][0]["name"] == "test-agent"


class TestSessionsEndpoint:
    """Tests for sessions endpoints."""

    def test_list_sessions_empty(self, client):
        """Test listing sessions when none exist."""
        response = client.get("/sessions")
        assert response.status_code == 200
        data = response.json()
        assert data["sessions"] == []

    def test_create_session(self, client):
        """Test creating a new session."""
        response = client.post("/sessions")
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data

    def test_get_session(self, client):
        """Test getting a session."""
        # Create session first
        create_response = client.post("/sessions")
        session_id = create_response.json()["session_id"]

        # Get session
        response = client.get(f"/sessions/{session_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == session_id

    def test_get_nonexistent_session(self, client):
        """Test getting a nonexistent session."""
        response = client.get("/sessions/nonexistent")
        assert response.status_code == 404

    def test_delete_session(self, client):
        """Test deleting a session."""
        # Create session first
        create_response = client.post("/sessions")
        session_id = create_response.json()["session_id"]

        # Delete session
        response = client.delete(f"/sessions/{session_id}")
        assert response.status_code == 200

        # Verify deleted
        get_response = client.get(f"/sessions/{session_id}")
        assert get_response.status_code == 404

    def test_get_session_runs(self, client):
        """Test getting session runs (message history)."""
        # Create session first
        create_response = client.post("/sessions")
        session_id = create_response.json()["session_id"]

        # Get runs
        response = client.get(f"/sessions/{session_id}/runs")
        assert response.status_code == 200
        data = response.json()
        assert "runs" in data
        assert data["runs"] == []


class TestRunEndpoint:
    """Tests for run endpoint."""

    def test_run_without_callback(self, client):
        """Test run endpoint without registered callback."""
        response = client.post(
            "/run",
            json={"message": "Hello"},
        )
        assert response.status_code == 200
        # Should return echo since no callback registered

    def test_run_creates_session(self, client):
        """Test run endpoint creates session if not provided."""
        response = client.post(
            "/run",
            json={"message": "Hello"},
        )
        assert response.status_code == 200

    def test_run_invalid_json(self, client):
        """Test run endpoint with invalid JSON."""
        response = client.post(
            "/run",
            content="not json",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 400


class TestAuthEndpoints:
    """Tests for auth endpoints."""

    def test_register_user(self, client):
        """Test user registration."""
        response = client.post(
            "/register",
            json={"username": "testuser", "password": "testpass"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["user"]["username"] == "testuser"

    def test_login_user(self, client):
        """Test user login."""
        # Register first
        client.post(
            "/register",
            json={"username": "testuser", "password": "testpass"},
        )

        # Login
        response = client.post(
            "/login",
            json={"username": "testuser", "password": "testpass"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data

    def test_login_invalid_credentials(self, client):
        """Test login with invalid credentials."""
        response = client.post(
            "/login",
            json={"username": "nonexistent", "password": "wrong"},
        )
        assert response.status_code == 401

    def test_logout(self, client):
        """Test logout."""
        response = client.post("/logout")
        assert response.status_code == 200

    def test_me_unauthorized(self, client):
        """Test /me endpoint without auth."""
        response = client.get("/me")
        assert response.status_code == 401


class TestRegisterCallback:
    """Tests for callback registration."""

    def test_register_callback(self):
        """Test registering a callback."""
        import praisonaiui.server as _srv
        _srv._callbacks.clear()

        def my_callback():
            pass

        register_callback("test", my_callback)
        assert "test" in _srv._callbacks
        assert _srv._callbacks["test"] == my_callback


class TestReplyTypeDispatch:
    """Tests for @reply decorator type-based dispatch."""

    def test_reply_passes_str_for_str_annotation(self):
        """Test that @reply passes msg.text when func expects str."""
        import praisonaiui.server as _srv
        from praisonaiui.callbacks import reply
        _srv._callbacks.clear()
        received = {}

        @reply
        async def handler(message: str):
            received["value"] = message
            received["type"] = type(message).__name__

        # Simulate what run_agent does
        import asyncio

        from praisonaiui.server import MessageContext

        msg = MessageContext(text="Hello world")
        msg._stream_queue = asyncio.Queue()

        wrapper = _srv._callbacks["reply"]
        asyncio.run(wrapper(msg))

        assert received["type"] == "str"
        assert received["value"] == "Hello world"

    def test_reply_passes_context_for_context_annotation(self):
        """Test that @reply passes MessageContext when func expects it."""
        import praisonaiui.server as _srv
        from praisonaiui.callbacks import reply
        from praisonaiui.server import MessageContext
        _srv._callbacks.clear()
        received = {}

        @reply
        async def handler(msg: MessageContext):
            received["value"] = msg
            received["type"] = type(msg).__name__

        import asyncio

        msg = MessageContext(text="Hello")
        msg._stream_queue = asyncio.Queue()

        wrapper = _srv._callbacks["reply"]
        asyncio.run(wrapper(msg))

        assert received["type"] == "MessageContext"
        assert received["value"].text == "Hello"

    def test_reply_passes_context_for_untyped_param(self):
        """Test that @reply passes MessageContext when func has no annotation."""
        import praisonaiui.server as _srv
        from praisonaiui.callbacks import reply
        from praisonaiui.server import MessageContext
        _srv._callbacks.clear()
        received = {}

        @reply
        async def handler(msg):
            received["value"] = msg
            received["type"] = type(msg).__name__

        import asyncio

        msg = MessageContext(text="Hello")
        msg._stream_queue = asyncio.Queue()

        wrapper = _srv._callbacks["reply"]
        asyncio.run(wrapper(msg))

        assert received["type"] == "MessageContext"


class TestStartersEndpoint:
    """Tests for /starters endpoint."""

    def test_starters_empty(self, client):
        """Test /starters returns empty list when no callback."""
        response = client.get("/starters")
        assert response.status_code == 200
        data = response.json()
        assert data["starters"] == []

    def test_starters_with_callback(self, client):
        """Test /starters returns data from registered callback."""
        starters_data = [
            {"label": "Hello", "message": "Say hello", "icon": "👋"},
            {"label": "Help", "message": "What can you do?", "icon": "❓"},
        ]

        async def get_starters():
            return starters_data

        register_callback("starters", get_starters)
        response = client.get("/starters")
        assert response.status_code == 200
        data = response.json()
        assert len(data["starters"]) == 2
        assert data["starters"][0]["label"] == "Hello"


class TestProfilesEndpoint:
    """Tests for /profiles endpoint."""

    def test_profiles_empty(self, client):
        """Test /profiles returns empty list when no callback."""
        response = client.get("/profiles")
        assert response.status_code == 200
        data = response.json()
        assert data["profiles"] == []

    def test_profiles_with_callback(self, client):
        """Test /profiles returns data from registered callback."""
        profiles_data = [
            {"name": "General", "description": "General assistant", "icon": "🤖"},
        ]

        async def get_profiles():
            return profiles_data

        register_callback("profiles", get_profiles)
        response = client.get("/profiles")
        assert response.status_code == 200
        data = response.json()
        assert len(data["profiles"]) == 1
        assert data["profiles"][0]["name"] == "General"


class TestConfigLoading:
    """Tests for config path loading."""

    def test_create_app_without_config(self):
        """Test create_app works without config_path."""
        _callbacks.clear()
        _agents.clear()
        app = create_app()
        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
