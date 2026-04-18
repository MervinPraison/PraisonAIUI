"""Tests for thread sharing functionality."""

import pytest
from unittest.mock import AsyncMock, Mock, patch
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.auth import User, create_token
from praisonaiui.features.sharing import (
    on_shared_thread_view,
    create_share_token,
    get_thread_by_share_token,
    revoke_share_token,
    list_share_tokens,
    check_shared_thread_access,
    get_share_url,
    _on_shared_thread_view_callback,
    _share_tokens,
)


class TestSharingTokens:
    """Test share token creation and management."""

    def setup_method(self):
        """Clear share tokens before each test."""
        _share_tokens.clear()

    def test_create_share_token(self):
        """Test share token creation."""
        thread_id = "session_123"
        user_id = "user_456"
        
        token = create_share_token(thread_id, user_id)
        
        assert len(token) > 0
        assert token in _share_tokens
        
        token_data = _share_tokens[token]
        assert token_data["thread_id"] == thread_id
        assert token_data["created_by"] == user_id
        assert "created_at" in token_data

    def test_get_thread_by_share_token(self):
        """Test retrieving thread ID from share token."""
        thread_id = "session_789"
        user_id = "user_123"
        
        token = create_share_token(thread_id, user_id)
        
        # Valid token
        result = get_thread_by_share_token(token)
        assert result == thread_id
        
        # Invalid token
        result = get_thread_by_share_token("invalid_token")
        assert result is None

    def test_revoke_share_token(self):
        """Test share token revocation."""
        thread_id = "session_456"
        user_id = "user_789"
        other_user_id = "other_user"
        
        token = create_share_token(thread_id, user_id)
        
        # Only creator can revoke
        revoked = revoke_share_token(thread_id, other_user_id)
        assert revoked is False
        assert token in _share_tokens
        
        # Creator can revoke
        revoked = revoke_share_token(thread_id, user_id)
        assert revoked is True
        assert token not in _share_tokens

    def test_list_share_tokens(self):
        """Test listing share tokens by user."""
        user1_id = "user_1"
        user2_id = "user_2"
        
        token1 = create_share_token("thread_1", user1_id)
        token2 = create_share_token("thread_2", user1_id)
        token3 = create_share_token("thread_3", user2_id)
        
        # User 1's tokens
        user1_tokens = list_share_tokens(user1_id)
        assert len(user1_tokens) == 2
        token_values = [t["token"] for t in user1_tokens]
        assert token1 in token_values
        assert token2 in token_values
        
        # User 2's tokens
        user2_tokens = list_share_tokens(user2_id)
        assert len(user2_tokens) == 1
        assert user2_tokens[0]["token"] == token3

    def test_get_share_url(self):
        """Test share URL generation."""
        token = "test_token_123"
        
        # Without base URL
        url = get_share_url(token)
        assert url == "/shared/test_token_123"
        
        # With base URL
        url = get_share_url(token, "https://example.com")
        assert url == "https://example.com/shared/test_token_123"
        
        # With base URL ending in slash
        url = get_share_url(token, "https://example.com/")
        assert url == "https://example.com/shared/test_token_123"


class TestSharingAccessControl:
    """Test sharing access control via callbacks."""

    def setup_method(self):
        """Clear callbacks before each test."""
        global _on_shared_thread_view_callback
        _on_shared_thread_view_callback = None

    def test_on_shared_thread_view_decorator(self):
        """Test shared thread view decorator registration."""
        @on_shared_thread_view
        async def handle_share_view(thread_id, viewer):
            return True
        
        assert _on_shared_thread_view_callback == handle_share_view

    @pytest.mark.asyncio
    async def test_check_shared_thread_access_allow(self):
        """Test shared thread access check - allow."""
        @on_shared_thread_view
        async def allow_access(thread_id, viewer):
            return True
        
        result = await check_shared_thread_access("thread_123", None)
        assert result is True
        
        user = User(identifier="user_123", display_name="Test User")
        result = await check_shared_thread_access("thread_456", user)
        assert result is True

    @pytest.mark.asyncio
    async def test_check_shared_thread_access_deny(self):
        """Test shared thread access check - deny."""
        @on_shared_thread_view
        async def deny_access(thread_id, viewer):
            return False
        
        result = await check_shared_thread_access("thread_789", None)
        assert result is False

    @pytest.mark.asyncio
    async def test_check_shared_thread_access_conditional(self):
        """Test conditional access control."""
        @on_shared_thread_view
        async def conditional_access(thread_id, viewer):
            # Allow logged-in users, deny anonymous
            return viewer is not None
        
        # Anonymous user
        result = await check_shared_thread_access("thread_abc", None)
        assert result is False
        
        # Logged-in user
        user = User(identifier="user_def", display_name="Logged User")
        result = await check_shared_thread_access("thread_abc", user)
        assert result is True

    @pytest.mark.asyncio
    async def test_check_shared_thread_access_no_handler(self):
        """Test access check with no handler registered (safe default)."""
        # No handler registered - should default to deny
        result = await check_shared_thread_access("thread_xyz", None)
        assert result is False

    @pytest.mark.asyncio
    async def test_check_shared_thread_access_callback_error(self):
        """Test access check when callback raises exception."""
        @on_shared_thread_view
        async def error_callback(thread_id, viewer):
            raise Exception("Callback error")
        
        # Should fail safely to deny access
        result = await check_shared_thread_access("thread_error", None)
        assert result is False


@pytest.mark.asyncio
class TestSharingRoutes:
    """Test sharing HTTP routes."""

    def setup_method(self):
        """Clear share tokens before each test."""
        _share_tokens.clear()

    async def test_create_share_endpoint(self):
        """Test POST /api/threads/{id}/share endpoint."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        # Set up test datastore
        datastore = MemoryDataStore()
        session = await datastore.create_session("test_session")
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', datastore):
            client = TestClient(app)
            
            # Create test token
            token = create_token("test_user")
            
            response = client.post(
                f"/api/threads/{session['id']}/share",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "url" in data
            assert "token" in data
            assert "/shared/" in data["url"]

    async def test_create_share_unauthenticated(self):
        """Test share creation without authentication."""
        from praisonaiui.server import create_app
        
        app = create_app()
        client = TestClient(app)
        
        response = client.post("/api/threads/test_session/share")
        assert response.status_code == 401

    async def test_create_share_invalid_thread(self):
        """Test share creation for non-existent thread."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', MemoryDataStore()):
            client = TestClient(app)
            
            # Create test token
            token = create_token("test_user")
            
            response = client.post(
                "/api/threads/nonexistent_session/share",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            assert response.status_code == 404

    async def test_revoke_share_endpoint(self):
        """Test POST /api/threads/{id}/unshare endpoint."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        # Set up test datastore
        datastore = MemoryDataStore()
        session = await datastore.create_session("test_session_revoke")
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', datastore):
            client = TestClient(app)
            
            # Create test token and share
            token = create_token("test_user")
            share_token = create_share_token(session['id'], "test_user")
            
            response = client.post(
                f"/api/threads/{session['id']}/unshare",
                headers={"Authorization": f"Bearer {token}"}
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["revoked"] is True
            assert data["thread_id"] == session['id']
            
            # Verify token was revoked
            assert get_thread_by_share_token(share_token) is None

    async def test_view_shared_thread_endpoint(self):
        """Test GET /shared/{token} endpoint."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        # Set up test datastore
        datastore = MemoryDataStore()
        session = await datastore.create_session("test_session_view")
        await datastore.add_message(session['id'], {
            "role": "user",
            "content": "Hello",
            "timestamp": "2024-01-01T00:00:00Z"
        })
        await datastore.add_message(session['id'], {
            "role": "assistant", 
            "content": "Hi there!",
            "timestamp": "2024-01-01T00:00:01Z"
        })
        
        # Set up sharing callback
        @on_shared_thread_view
        async def allow_all(thread_id, viewer):
            return True
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', datastore):
            client = TestClient(app)
            
            # Create share token
            share_token = create_share_token(session['id'], "test_user")
            
            # Test JSON API access
            response = client.get(
                f"/shared/{share_token}",
                headers={"Accept": "application/json"}
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data["thread_id"] == session['id']
            assert data["read_only"] is True
            assert len(data["messages"]) == 2
            assert data["messages"][0]["content"] == "Hello"
            assert data["messages"][1]["content"] == "Hi there!"

    async def test_view_shared_thread_access_denied(self):
        """Test shared thread access denial."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        # Set up test datastore
        datastore = MemoryDataStore()
        session = await datastore.create_session("test_session_denied")
        
        # Set up sharing callback that denies access
        @on_shared_thread_view
        async def deny_all(thread_id, viewer):
            return False
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', datastore):
            client = TestClient(app)
            
            # Create share token
            share_token = create_share_token(session['id'], "test_user")
            
            response = client.get(
                f"/shared/{share_token}",
                headers={"Accept": "application/json"}
            )
            
            assert response.status_code == 403

    async def test_view_shared_thread_invalid_token(self):
        """Test shared thread with invalid token."""
        from praisonaiui.server import create_app
        
        app = create_app()
        client = TestClient(app)
        
        response = client.get(
            "/shared/invalid_token_123",
            headers={"Accept": "application/json"}
        )
        
        assert response.status_code == 404

    async def test_view_shared_thread_html(self):
        """Test shared thread HTML view."""
        from praisonaiui.server import create_app
        from praisonaiui.datastore import MemoryDataStore
        
        # Set up test datastore
        datastore = MemoryDataStore()
        session = await datastore.create_session("test_session_html")
        
        # Set up sharing callback
        @on_shared_thread_view
        async def allow_all(thread_id, viewer):
            return True
        
        app = create_app()
        
        with patch('praisonaiui.server._datastore', datastore):
            client = TestClient(app)
            
            # Create share token
            share_token = create_share_token(session['id'], "test_user")
            
            # Test HTML access (browser)
            response = client.get(f"/shared/{share_token}")
            
            assert response.status_code == 200
            assert "text/html" in response.headers.get("content-type", "")
            # Should return the SPA shell for frontend to handle
            assert "<!doctype html>" in response.text.lower()