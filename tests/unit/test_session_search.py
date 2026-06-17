"""Unit tests for session search functionality."""

from unittest.mock import patch

import pytest
from starlette.testclient import TestClient


def test_sessions_endpoint_returns_list(test_client):
    """Test that /sessions endpoint returns a list of sessions."""
    # Mock the session manager to return test sessions
    with patch("praisonaiui.server._session_manager") as mock_manager:
        mock_manager.list_sessions.return_value = [
            {
                "id": "session-1",
                "title": "Test Session 1",
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T01:00:00Z",
                "message_count": 5,
            },
            {
                "id": "session-2",
                "title": "Test Session 2",
                "created_at": "2024-01-02T00:00:00Z",
                "updated_at": "2024-01-02T01:00:00Z",
                "message_count": 10,
            },
        ]

        response = test_client.get("/sessions")
        assert response.status_code == 200

        data = response.json()
        assert "sessions" in data
        assert len(data["sessions"]) == 2
        assert data["sessions"][0]["id"] == "session-1"
        assert data["sessions"][1]["id"] == "session-2"


def test_sessions_endpoint_empty_list(test_client):
    """Test that /sessions endpoint returns empty list when no sessions."""
    with patch("praisonaiui.server._session_manager") as mock_manager:
        mock_manager.list_sessions.return_value = []

        response = test_client.get("/sessions")
        assert response.status_code == 200

        data = response.json()
        assert "sessions" in data
        assert data["sessions"] == []


def test_session_search_filters_by_title():
    """Test that session search can filter by title (client-side simulation)."""
    sessions = [
        {"id": "1", "title": "Chat about Python", "message_count": 5},
        {"id": "2", "title": "JavaScript discussion", "message_count": 3},
        {"id": "3", "title": "Python tutorial", "message_count": 8},
    ]

    # Simulate client-side filtering by title
    search_term = "python"
    filtered = [
        s for s in sessions
        if search_term.lower() in s["title"].lower()
    ]

    assert len(filtered) == 2
    assert filtered[0]["id"] == "1"
    assert filtered[1]["id"] == "3"


def test_session_search_filters_by_id():
    """Test that session search can filter by ID (client-side simulation)."""
    sessions = [
        {"id": "abc-123", "title": "Session One", "message_count": 5},
        {"id": "def-456", "title": "Session Two", "message_count": 3},
        {"id": "abc-789", "title": "Session Three", "message_count": 8},
    ]

    # Simulate client-side filtering by ID
    search_term = "abc"
    filtered = [
        s for s in sessions
        if search_term.lower() in s["id"].lower()
    ]

    assert len(filtered) == 2
    assert filtered[0]["id"] == "abc-123"
    assert filtered[1]["id"] == "abc-789"


@pytest.fixture
def test_client():
    """Create a test client for the app."""
    from praisonaiui.server import app

    return TestClient(app)
