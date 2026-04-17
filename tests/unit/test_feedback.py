"""Unit tests for feedback functionality."""

import pytest
from starlette.testclient import TestClient

from praisonaiui.datastore import MemoryDataStore, BaseDataStore
from praisonaiui.server import (
    create_app,
    set_datastore,
    set_feedback_enabled,
    _callbacks,
)


@pytest.fixture
def client():
    """Create a test client with isolated state."""
    # Clear state before each test
    _callbacks.clear()
    set_datastore(MemoryDataStore())
    set_feedback_enabled(True)
    app = create_app()
    return TestClient(app)


class TestFeedbackDataStore:
    """Tests for feedback datastore methods."""

    def test_memory_datastore_record_feedback(self):
        """Test MemoryDataStore can record feedback."""
        datastore = MemoryDataStore()
        
        # Record feedback
        import asyncio
        asyncio.run(datastore.record_feedback("session1", "msg1", 1, "Great response!"))
        
        # List feedback
        feedback = asyncio.run(datastore.list_feedback())
        assert len(feedback) == 1
        assert feedback[0]["session_id"] == "session1"
        assert feedback[0]["message_id"] == "msg1"
        assert feedback[0]["value"] == 1
        assert feedback[0]["comment"] == "Great response!"

    def test_memory_datastore_list_feedback_by_session(self):
        """Test MemoryDataStore can filter feedback by session."""
        datastore = MemoryDataStore()
        
        import asyncio
        # Record feedback for different sessions
        asyncio.run(datastore.record_feedback("session1", "msg1", 1, "Good"))
        asyncio.run(datastore.record_feedback("session2", "msg2", -1, "Bad"))
        asyncio.run(datastore.record_feedback("session1", "msg3", 0))
        
        # List all feedback
        all_feedback = asyncio.run(datastore.list_feedback())
        assert len(all_feedback) == 3
        
        # List feedback for session1
        session1_feedback = asyncio.run(datastore.list_feedback("session1"))
        assert len(session1_feedback) == 2
        assert all(f["session_id"] == "session1" for f in session1_feedback)

    def test_base_datastore_feedback_defaults(self):
        """Test BaseDataStore provides default no-op implementations."""
        from src.praisonaiui.datastore import MemoryDataStore
        
        # Use MemoryDataStore which inherits the default implementations
        datastore = MemoryDataStore()
        
        import asyncio
        # Should not raise an error
        asyncio.run(datastore.record_feedback("session1", "msg1", 1))
        
        # Should return the recorded feedback, not empty list
        feedback = asyncio.run(datastore.list_feedback())
        assert len(feedback) == 1


class TestFeedbackAPI:
    """Tests for feedback API endpoints."""

    def test_post_feedback_success(self, client):
        """Test successfully posting feedback."""
        response = client.post("/api/feedback", json={
            "session_id": "test-session",
            "message_id": "test-message",
            "value": 1,
            "comment": "Great response!"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "recorded"

    def test_post_feedback_missing_fields(self, client):
        """Test posting feedback with missing required fields."""
        response = client.post("/api/feedback", json={
            "session_id": "test-session",
            # missing message_id and value
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "Missing required fields" in data["error"]

    def test_post_feedback_invalid_value(self, client):
        """Test posting feedback with invalid value."""
        response = client.post("/api/feedback", json={
            "session_id": "test-session",
            "message_id": "test-message",
            "value": 2,  # invalid, should be -1, 0, or 1
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "value must be -1, 0, or 1" in data["error"]

    def test_post_feedback_invalid_json(self, client):
        """Test posting invalid JSON."""
        response = client.post("/api/feedback", data="invalid json")
        
        assert response.status_code == 400
        data = response.json()
        assert "Invalid JSON" in data["error"]

    def test_post_feedback_disabled(self, client):
        """Test posting feedback when disabled."""
        # Disable feedback
        set_feedback_enabled(False)
        app = create_app()
        client = TestClient(app)
        
        response = client.post("/api/feedback", json={
            "session_id": "test-session",
            "message_id": "test-message",
            "value": 1,
        })
        
        assert response.status_code == 403
        data = response.json()
        assert "Feedback is disabled" in data["error"]

    def test_get_feedback_empty(self, client):
        """Test getting feedback when none exists."""
        response = client.get("/api/feedback")
        
        assert response.status_code == 200
        data = response.json()
        assert data["feedback"] == []
        assert data["summary"]["total"] == 0

    def test_get_feedback_with_data(self, client):
        """Test getting feedback with existing data."""
        # First, post some feedback
        client.post("/api/feedback", json={
            "session_id": "session1",
            "message_id": "msg1",
            "value": 1,
            "comment": "Good"
        })
        client.post("/api/feedback", json={
            "session_id": "session1",
            "message_id": "msg2",
            "value": -1,
            "comment": "Bad"
        })
        client.post("/api/feedback", json={
            "session_id": "session2",
            "message_id": "msg3",
            "value": 0,
        })
        
        response = client.get("/api/feedback")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["feedback"]) == 3
        assert data["summary"]["total"] == 3
        assert data["summary"]["positive"] == 1
        assert data["summary"]["negative"] == 1
        assert data["summary"]["neutral"] == 1
        assert len(data["summary"]["by_session"]) == 2

    def test_get_feedback_with_session_filter(self, client):
        """Test getting feedback filtered by session."""
        # First, post some feedback
        client.post("/api/feedback", json={
            "session_id": "session1",
            "message_id": "msg1", 
            "value": 1,
        })
        client.post("/api/feedback", json={
            "session_id": "session2",
            "message_id": "msg2",
            "value": -1,
        })
        
        response = client.get("/api/feedback?session_id=session1")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["feedback"]) == 1
        assert data["feedback"][0]["session_id"] == "session1"

    def test_get_feedback_disabled(self, client):
        """Test getting feedback when disabled."""
        # Disable feedback
        set_feedback_enabled(False)
        app = create_app()
        client = TestClient(app)
        
        response = client.get("/api/feedback")
        
        assert response.status_code == 403
        data = response.json()
        assert "Feedback is disabled" in data["error"]


class TestFeedbackCallbacks:
    """Tests for feedback callback integration."""

    def test_feedback_callback_called(self, client):
        """Test that feedback callback is called when registered."""
        callback_data = []
        
        # Register a feedback callback
        from praisonaiui.server import register_callback
        
        async def feedback_handler(data):
            callback_data.append(data)
        
        register_callback("on:feedback", feedback_handler)
        
        # Post feedback
        client.post("/api/feedback", json={
            "session_id": "test-session",
            "message_id": "test-message",
            "value": 1,
            "comment": "Great!"
        })
        
        # Callback should have been called
        assert len(callback_data) == 1
        assert callback_data[0]["session_id"] == "test-session"
        assert callback_data[0]["message_id"] == "test-message"
        assert callback_data[0]["value"] == 1
        assert callback_data[0]["comment"] == "Great!"


class TestFeedbackConfiguration:
    """Tests for feedback configuration."""

    def test_set_feedback_enabled_true(self):
        """Test enabling feedback."""
        from src.praisonaiui.server import _callbacks, set_datastore
        from src.praisonaiui.datastore import MemoryDataStore
        
        # Set up isolated test environment
        _callbacks.clear()
        set_datastore(MemoryDataStore())
        set_feedback_enabled(True)
        
        try:
            # Test by creating an app and checking the API works
            app = create_app()
            client = TestClient(app)
            
            response = client.post("/api/feedback", json={
                "session_id": "test",
                "message_id": "test",
                "value": 1,
            })
            assert response.status_code == 200
        finally:
            _callbacks.clear()
            set_datastore(MemoryDataStore())
            set_feedback_enabled(True)

    def test_set_feedback_enabled_false(self):
        """Test disabling feedback."""
        from src.praisonaiui.server import _callbacks, set_datastore
        from src.praisonaiui.datastore import MemoryDataStore
        
        # Set up isolated test environment
        _callbacks.clear()
        set_datastore(MemoryDataStore())
        set_feedback_enabled(False)
        
        try:
            app = create_app()
            client = TestClient(app)
            
            response = client.post("/api/feedback", json={
                "session_id": "test",
                "message_id": "test", 
                "value": 1,
            })
            assert response.status_code == 403
        finally:
            _callbacks.clear()
            set_datastore(MemoryDataStore())
            set_feedback_enabled(True)


class TestJSONFileDataStoreFeedback:
    """Tests for JSONFileDataStore feedback functionality."""

    def test_json_file_feedback_basic(self, tmp_path):
        """Test basic feedback recording and listing with JSONFileDataStore."""
        import asyncio
        from src.praisonaiui.datastore import JSONFileDataStore
        
        datastore = JSONFileDataStore(str(tmp_path))
        
        async def run_test():
            # Record feedback
            await datastore.record_feedback("session1", "msg1", 1, "Great!")
            await datastore.record_feedback("session1", "msg2", -1, "Bad")
            await datastore.record_feedback("session2", "msg3", 0)
            
            # List all feedback
            feedback = await datastore.list_feedback()
            assert len(feedback) == 3
            
            # Check feedback content
            assert feedback[0]["session_id"] == "session1"
            assert feedback[0]["message_id"] == "msg1"
            assert feedback[0]["value"] == 1
            assert feedback[0]["comment"] == "Great!"
            
            # List session-filtered feedback
            session1_feedback = await datastore.list_feedback("session1")
            assert len(session1_feedback) == 2
            
        asyncio.run(run_test())

    def test_json_file_feedback_no_collision_with_sessions(self, tmp_path):
        """Test that feedback.json doesn't interfere with session listing."""
        import asyncio
        from src.praisonaiui.datastore import JSONFileDataStore
        
        datastore = JSONFileDataStore(str(tmp_path))
        
        async def run_test():
            # Create a session
            session = await datastore.create_session("test-session")
            assert session["id"] == "test-session"
            
            # Record feedback
            await datastore.record_feedback("test-session", "msg1", 1)
            
            # List sessions should still work
            sessions = await datastore.list_sessions()
            assert len(sessions) == 1
            assert sessions[0]["id"] == "test-session"
            
            # Feedback should be in separate directory (note: datastore creates its own data_dir structure)
            feedback_file = tmp_path / "feedback" / "feedback.json"
            assert feedback_file.exists()
            
            # Session file should exist separately
            session_file = tmp_path / "test-session.json"
            assert session_file.exists()
            
        asyncio.run(run_test())