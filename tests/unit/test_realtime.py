"""Tests for realtime voice feature protocol conformance and session lifecycle."""

import pytest
from unittest import mock
from unittest.mock import AsyncMock, patch

from praisonaiui.features.realtime import (
    RealtimeProtocol,
    OpenAIRealtimeManager,
    get_realtime_manager,
    set_realtime_manager,
)


class TestRealtimeProtocolConformance:
    """Test that OpenAIRealtimeManager correctly implements RealtimeProtocol."""
    
    def test_openai_manager_is_realtime_protocol(self):
        """Verify protocol conformance."""
        manager = OpenAIRealtimeManager()
        assert isinstance(manager, RealtimeProtocol)
    
    def test_protocol_has_required_methods(self):
        """Verify protocol defines all required abstract methods."""
        # Get all abstract methods from RealtimeProtocol
        abstract_methods = RealtimeProtocol.__abstractmethods__
        expected_methods = {
            'create_session', 'send_audio', 'receive_audio', 
            'call_tool', 'close_session'
        }
        assert abstract_methods == expected_methods
    
    def test_openai_manager_implements_all_methods(self):
        """Verify OpenAIRealtimeManager implements all protocol methods."""
        manager = OpenAIRealtimeManager()
        
        # Check all abstract methods are implemented
        for method_name in RealtimeProtocol.__abstractmethods__:
            assert hasattr(manager, method_name)
            assert callable(getattr(manager, method_name))
        
        # Check health method (non-abstract)
        assert hasattr(manager, 'health')
        assert callable(manager.health)


class TestManagerSingleton:
    """Test get/set realtime manager lifecycle."""
    
    def test_manager_round_trip(self):
        """Test set_realtime_manager / get_realtime_manager round-trip."""
        # Create custom manager
        custom_manager = OpenAIRealtimeManager()
        
        # Set it
        set_realtime_manager(custom_manager)
        
        # Get it back
        retrieved = get_realtime_manager()
        
        # Should be the same instance
        assert retrieved is custom_manager
    
    def test_default_manager_is_openai(self):
        """Test default manager is OpenAIRealtimeManager instance."""
        # Reset manager
        set_realtime_manager(None)
        
        # Get default
        default = get_realtime_manager()
        
        assert isinstance(default, OpenAIRealtimeManager)


class TestSessionLifecycle:
    """Test session creation, operations, and cleanup."""
    
    @pytest.mark.asyncio
    async def test_session_lifecycle_without_openai(self):
        """Test session lifecycle when OpenAI SDK not available."""
        import sys
        manager = OpenAIRealtimeManager()
        
        # Force `import openai` inside the function body to fail
        with patch.dict(sys.modules, {"openai": None}):
            session_info = await manager.create_session()
            
            assert session_info["type"] == "error"
            assert "openai package not installed" in session_info["error"]
    
    @pytest.mark.asyncio
    async def test_session_lifecycle_with_mocked_openai(self):
        """Test full session lifecycle with mocked OpenAI."""
        import sys
        manager = OpenAIRealtimeManager()
        
        # Mock OpenAI client and response
        mock_response = mock.MagicMock()
        mock_response.client_secret = "test_secret_123"
        
        mock_openai = mock.MagicMock()
        mock_client = mock.MagicMock()
        mock_client.realtime.sessions.create = AsyncMock(return_value=mock_response)
        mock_openai.OpenAI.return_value = mock_client
        
        with patch.dict(sys.modules, {"openai": mock_openai}):
            # Create session
            session_info = await manager.create_session(model="gpt-4o-realtime-preview")
            
            # Verify session created successfully
            assert session_info["status"] == "created"
            assert session_info["client_secret"] == "test_secret_123"
            assert session_info["model"] == "gpt-4o-realtime-preview"
            assert session_info["type"] == "webrtc"
            assert "session_id" in session_info
            
            session_id = session_info["session_id"]
            
            # Test send_audio (should not raise)
            await manager.send_audio(session_id, b"audio_data")
            
            # Test receive_audio
            events = []
            async for event in manager.receive_audio(session_id):
                events.append(event)
                break  # Just get first event
            
            assert len(events) == 1
            assert events[0]["type"] == "conversation.item.created"
            
            # Test call_tool
            tool_result = await manager.call_tool(session_id, "test_tool", {"call_id": "call_123"})
            assert tool_result["type"] == "function_call_output"
            assert tool_result["call_id"] == "call_123"
            
            # Test close session
            await manager.close_session(session_id)
            
            # Verify session is removed from internal tracking
            assert session_id not in manager._sessions
    
    @pytest.mark.asyncio
    async def test_receive_audio_invalid_session(self):
        """Test receive_audio with invalid session ID."""
        manager = OpenAIRealtimeManager()
        
        events = []
        async for event in manager.receive_audio("invalid_session_id"):
            events.append(event)
            break
        
        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "Session not found" in events[0]["error"]


class TestHealthEndpoint:
    """Test health endpoint behavior."""
    
    def test_health_without_openai(self):
        """Test health when OpenAI not installed."""
        manager = OpenAIRealtimeManager()
        
        with patch('builtins.__import__', side_effect=ImportError("No module named 'openai'")):
            health = manager.health()
            
            assert health["status"] == "degraded"
            assert health["provider"] == "OpenAIRealtimeManager"
            assert health["reason"] == "openai not installed"
    
    def test_health_with_openai(self):
        """Test health when OpenAI is available."""
        import sys
        manager = OpenAIRealtimeManager()
        
        # Add some sessions to test counter
        manager._sessions["session_1"] = {"id": "session_1"}
        manager._sessions["session_2"] = {"id": "session_2"}
        
        mock_openai = mock.MagicMock()
        with patch.dict(sys.modules, {"openai": mock_openai}):
            health = manager.health()
            
            assert health["status"] == "ok"
            assert health["provider"] == "OpenAIRealtimeManager"
            assert health["active_sessions"] == 2


class TestLazyImportInvariant:
    """Test that importing praisonaiui doesn't eagerly load OpenAI SDK."""
    
    def test_import_praisonaiui_no_openai_import(self):
        """Verify importing praisonaiui package doesn't import openai."""
        # This test ensures lazy imports work correctly
        import sys
        
        # Remove openai from modules if present
        openai_modules = [mod for mod in sys.modules.keys() if mod.startswith('openai')]
        for mod in openai_modules:
            if mod in sys.modules:
                del sys.modules[mod]
        
        # Import praisonaiui
        import praisonaiui  # noqa: F401
        
        # Verify openai wasn't imported
        openai_imported = any(mod.startswith('openai') for mod in sys.modules.keys())
        assert not openai_imported, "OpenAI SDK was imported during praisonaiui import"
    
    def test_accessing_realtime_still_lazy(self):
        """Test that accessing realtime attributes still uses lazy imports."""
        import sys
        
        # Remove openai from modules if present
        openai_modules = [mod for mod in sys.modules.keys() if mod.startswith('openai')]
        for mod in openai_modules:
            if mod in sys.modules:
                del sys.modules[mod]
        
        # Access manager functions (should not import openai yet)
        manager = get_realtime_manager()
        assert isinstance(manager, OpenAIRealtimeManager)
        
        # OpenAI should still not be imported until we try to use it
        openai_imported = any(mod.startswith('openai') for mod in sys.modules.keys())
        assert not openai_imported, "OpenAI SDK was imported too early"