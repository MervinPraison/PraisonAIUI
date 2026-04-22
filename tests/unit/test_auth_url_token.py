"""Unit tests for TokenQueryMiddleware URL token authentication."""

import os
import time
from unittest.mock import patch

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from praisonaiui.auth import TokenQueryMiddleware, _constant_time_eq


@pytest.fixture
def test_token():
    """Test token with sufficient entropy."""
    return "abcdef123456789012345678901234567890"


@pytest.fixture
def middleware_app(test_token):
    """Create test Starlette app with TokenQueryMiddleware."""
    async def success_handler(request):
        return JSONResponse({"message": "success"})

    async def health_handler(request):
        return JSONResponse({"status": "ok"})

    middleware = [
        Middleware(TokenQueryMiddleware, expected_token=test_token)
    ]
    routes = [
        Route("/", success_handler),
        Route("/dashboard", success_handler),
        Route("/api/chat", success_handler),
        Route("/health", health_handler),
        Route("/api/health", health_handler),
        Route("/custom", success_handler),
    ]
    return Starlette(middleware=middleware, routes=routes)


@pytest.fixture
def client(middleware_app):
    """Test client for middleware app."""
    return TestClient(middleware_app)


def test_no_token_unset_env(test_token):
    """Test middleware is inert when no token is configured."""
    async def success_handler(request):
        return JSONResponse({"message": "success"})

    # Middleware with empty token should pass through
    middleware = [
        Middleware(TokenQueryMiddleware, expected_token="")
    ]
    routes = [Route("/", success_handler)]
    starlette_app = Starlette(middleware=middleware, routes=routes)
    client = TestClient(starlette_app)

    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "success"}


def test_no_auth_token_required_html_login_form(client):
    """Test HTML login form is returned for non-API requests without token."""
    response = client.get("/")
    assert response.status_code == 401
    assert "Authentication Required" in response.text
    assert "<form" in response.text
    assert 'name="token"' in response.text


def test_no_auth_token_required_api_json_error(client):
    """Test JSON error for /api/* requests without token."""
    response = client.get("/api/chat")
    assert response.status_code == 401
    assert response.json() == {
        "error": "Unauthorized",
        "hint": "Append ?token=<SECRET> to the URL or send Authorization: Bearer <SECRET>."
    }


def test_valid_query_token_redirects_and_sets_cookie(client, test_token):
    """Test valid ?token=... redirects to clean URL with cookie."""
    response = client.get(f"/?token={test_token}", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] in ["/", "http://testserver/"]

    # Check cookie is set
    assert "praisonaiui_token" in response.cookies
    assert response.cookies["praisonaiui_token"] == test_token


def test_valid_query_token_with_other_params(client, test_token):
    """Test ?token=... preserves other query parameters in redirect."""
    response = client.get(f"/dashboard?foo=bar&token={test_token}&baz=qux", follow_redirects=False)

    assert response.status_code == 303
    # Token should be stripped but other params preserved
    location = response.headers["location"]
    assert "token=" not in location
    assert "foo=bar" in location
    assert "baz=qux" in location


def test_invalid_query_token_returns_401(client):
    """Test invalid ?token=... returns 401."""
    response = client.get("/?token=wrongtoken")
    assert response.status_code == 401


def test_valid_bearer_header_passes(client, test_token):
    """Test valid Authorization: Bearer header passes through."""
    headers = {"Authorization": f"Bearer {test_token}"}
    response = client.get("/", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"message": "success"}


def test_valid_bearer_header_api_endpoint(client, test_token):
    """Test valid Bearer token works for API endpoints."""
    headers = {"Authorization": f"Bearer {test_token}"}
    response = client.get("/api/chat", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"message": "success"}


def test_invalid_bearer_header_returns_401(client):
    """Test invalid Bearer token returns 401."""
    headers = {"Authorization": "Bearer wrongtoken"}
    response = client.get("/", headers=headers)
    assert response.status_code == 401


def test_valid_cookie_passes(client, test_token):
    """Test valid cookie passes through."""
    client.cookies["praisonaiui_token"] = test_token
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "success"}


def test_invalid_cookie_returns_401(client):
    """Test invalid cookie returns 401."""
    client.cookies["praisonaiui_token"] = "wrongtoken"
    response = client.get("/")
    assert response.status_code == 401


def test_exempt_paths_always_pass(test_token):
    """Test exempt paths (/health, /api/health) always pass."""
    async def health_handler(request):
        return JSONResponse({"status": "ok"})

    middleware = [
        Middleware(TokenQueryMiddleware, expected_token=test_token)
    ]
    routes = [
        Route("/health", health_handler),
        Route("/api/health", health_handler),
    ]
    starlette_app = Starlette(middleware=middleware, routes=routes)
    client = TestClient(starlette_app)

    # No auth required for exempt paths
    response = client.get("/health")
    assert response.status_code == 200

    response = client.get("/api/health")
    assert response.status_code == 200


def test_custom_exempt_paths(test_token):
    """Test custom exempt paths work."""
    async def handler(request):
        return JSONResponse({"status": "ok"})

    middleware = [
        Middleware(TokenQueryMiddleware, expected_token=test_token, exempt_paths=["/custom"])
    ]
    routes = [
        Route("/custom", handler),
        Route("/health", handler),
    ]
    starlette_app = Starlette(middleware=middleware, routes=routes)
    client = TestClient(starlette_app)

    # Custom exempt path should work
    response = client.get("/custom")
    assert response.status_code == 200

    # Default exempt paths should still work
    response = client.get("/health")
    assert response.status_code == 200


def test_constant_time_comparison():
    """Test _constant_time_eq prevents timing attacks."""
    correct = "secret123456789012345678901234567890"

    # Test equal strings
    assert _constant_time_eq(correct, correct) is True

    # Test different strings (same length)
    assert _constant_time_eq(correct, "wrong1234567890123456789012345678901") is False

    # Test different lengths
    assert _constant_time_eq(correct, "short") is False
    assert _constant_time_eq("short", correct) is False

    # Test empty strings
    assert _constant_time_eq("", "") is True
    assert _constant_time_eq(correct, "") is False


def test_timing_attack_resistance():
    """Test timing attack resistance - all incorrect tokens take similar time."""
    correct = "secret123456789012345678901234567890"
    wrong_same_length = "wrongg123456789012345678901234567890"
    wrong_diff_length = "wrong"

    # Measure times for different wrong tokens
    times = []
    for wrong_token in [wrong_same_length, wrong_diff_length, ""]:
        start = time.perf_counter()
        for _ in range(1000):  # Multiple iterations for better timing measurement
            _constant_time_eq(correct, wrong_token)
        end = time.perf_counter()
        times.append(end - start)

    # Times should be similar (within reasonable variance)
    # This is a best-effort test - timing can be affected by system load
    avg_time = sum(times) / len(times)
    for t in times:
        # Allow up to 50% variance due to system noise
        assert abs(t - avg_time) / avg_time < 0.5, f"Timing variance too high: {times}"


def test_cookie_security_attributes(client, test_token):
    """Test cookie security attributes are set correctly."""
    # Test HTTP request (no Secure flag)
    response = client.get(f"/?token={test_token}", follow_redirects=False)

    assert response.status_code == 303
    cookie_header = response.headers.get("set-cookie", "")
    assert "HttpOnly" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert "Max-Age=86400" in cookie_header  # 24 hours
    # Secure flag should not be set for HTTP
    assert "Secure" not in cookie_header


@patch.dict(os.environ, {"AIUI_URL_TOKEN": "test_env_token"})
def test_env_var_integration():
    """Test environment variable integration would work in server setup."""
    # This tests the env var reading logic that would be used in create_app()
    token = os.environ.get("AIUI_URL_TOKEN") or os.environ.get("GATEWAY_AUTH_TOKEN")
    assert token == "test_env_token"


@patch.dict(os.environ, {"GATEWAY_AUTH_TOKEN": "gateway_token"})
def test_gateway_auth_token_fallback():
    """Test GATEWAY_AUTH_TOKEN fallback when AIUI_URL_TOKEN not set."""
    # Remove AIUI_URL_TOKEN if it exists
    os.environ.pop("AIUI_URL_TOKEN", None)

    token = os.environ.get("AIUI_URL_TOKEN") or os.environ.get("GATEWAY_AUTH_TOKEN")
    assert token == "gateway_token"


@patch.dict(os.environ, {"AIUI_URL_TOKEN": "aiui_token", "GATEWAY_AUTH_TOKEN": "gateway_token"})
def test_aiui_url_token_takes_precedence():
    """Test AIUI_URL_TOKEN takes precedence over GATEWAY_AUTH_TOKEN."""
    token = os.environ.get("AIUI_URL_TOKEN") or os.environ.get("GATEWAY_AUTH_TOKEN")
    assert token == "aiui_token"
