"""Tests for lifecycle hooks feature."""

import asyncio
import os
import pytest
import time
from unittest.mock import AsyncMock, Mock, patch

from praisonaiui.features.lifecycle import (
    LifecycleFeature,
    on_app_startup,
    on_app_shutdown,
    register_startup_hook,
    register_shutdown_hook,
    run_startup_hooks,
    run_shutdown_hooks,
    reset_lifecycle_state,
    _startup_hooks,
    _shutdown_hooks,
    _lifecycle_state,
)


class TestLifecycleFeature:
    """Test LifecycleFeature protocol implementation."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_lifecycle_state()
    
    def test_feature_protocol(self):
        """Test that LifecycleFeature implements BaseFeatureProtocol correctly."""
        feature = LifecycleFeature()
        
        assert feature.name == "lifecycle"
        assert feature.description == "Server startup and shutdown hook management"
        assert len(feature.routes()) == 2
        assert len(feature.cli_commands()) == 1
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test health check reports correct state."""
        feature = LifecycleFeature()
        
        # Add some hooks
        @on_app_startup
        async def startup1():
            pass
        
        @on_app_shutdown
        async def shutdown1():
            pass
        
        health = await feature.health()
        
        assert health["status"] == "ok"
        assert health["feature"] == "lifecycle"
        assert health["startup_hooks"] == 1
        assert health["shutdown_hooks"] == 1
        assert health["startup_completed"] is False
        
        # After startup
        await run_startup_hooks()
        health = await feature.health()
        assert health["startup_completed"] is True


class TestLifecycleHooks:
    """Test lifecycle hook registration and execution."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_lifecycle_state()
    
    def test_startup_hook_registration(self):
        """Test startup hook registration."""
        call_count = 0
        
        @register_startup_hook
        def startup_hook():
            nonlocal call_count
            call_count += 1
        
        assert len(_startup_hooks) == 1
        assert _startup_hooks[0] == startup_hook
    
    def test_shutdown_hook_registration(self):
        """Test shutdown hook registration."""
        call_count = 0
        
        @register_shutdown_hook
        def shutdown_hook():
            nonlocal call_count
            call_count += 1
        
        assert len(_shutdown_hooks) == 1
        assert _shutdown_hooks[0] == shutdown_hook
    
    def test_decorator_syntax(self):
        """Test decorator syntax for hooks."""
        
        @on_app_startup
        def startup():
            pass
        
        @on_app_shutdown
        def shutdown():
            pass
        
        assert len(_startup_hooks) == 1
        assert len(_shutdown_hooks) == 1
        assert _startup_hooks[0] == startup
        assert _shutdown_hooks[0] == shutdown
    
    def test_duplicate_registration_prevention(self):
        """Test that duplicate hook registration is prevented."""
        
        def my_hook():
            pass
        
        # Register the same hook multiple times
        register_startup_hook(my_hook)
        register_startup_hook(my_hook)
        register_startup_hook(my_hook)
        
        # Should only appear once
        assert len(_startup_hooks) == 1
        assert _startup_hooks[0] == my_hook
    
    @pytest.mark.asyncio
    async def test_startup_hooks_execution(self):
        """Test startup hooks are executed in order."""
        execution_order = []
        
        @on_app_startup
        def hook1():
            execution_order.append(1)
        
        @on_app_startup
        async def hook2():
            execution_order.append(2)
        
        @on_app_startup
        def hook3():
            execution_order.append(3)
        
        assert _lifecycle_state["startup_completed"] is False
        
        await run_startup_hooks()
        
        assert execution_order == [1, 2, 3]
        assert _lifecycle_state["startup_completed"] is True
        assert _lifecycle_state["startup_time"] > 0
    
    @pytest.mark.asyncio
    async def test_shutdown_hooks_execution(self):
        """Test shutdown hooks are executed in order."""
        execution_order = []
        
        @on_app_shutdown
        def hook1():
            execution_order.append(1)
        
        @on_app_shutdown
        async def hook2():
            execution_order.append(2)
        
        @on_app_shutdown
        def hook3():
            execution_order.append(3)
        
        assert _lifecycle_state["shutdown_initiated"] is False
        
        await run_shutdown_hooks()
        
        assert execution_order == [1, 2, 3]
        assert _lifecycle_state["shutdown_initiated"] is True
        assert _lifecycle_state["shutdown_time"] > 0
    
    @pytest.mark.asyncio
    async def test_startup_hook_failure_handling(self):
        """Test that startup hook failures don't break the process."""
        execution_order = []
        
        @on_app_startup
        def good_hook1():
            execution_order.append(1)
        
        @on_app_startup
        def failing_hook():
            execution_order.append("fail")
            raise RuntimeError("Hook failed")
        
        @on_app_startup
        def good_hook2():
            execution_order.append(2)
        
        # Should not raise exception
        await run_startup_hooks()
        
        # All hooks should have been attempted
        assert execution_order == [1, "fail", 2]
        assert _lifecycle_state["startup_completed"] is True
    
    @pytest.mark.asyncio
    async def test_shutdown_hook_failure_handling(self):
        """Test that shutdown hook failures don't break the process."""
        execution_order = []
        
        @on_app_shutdown
        def good_hook1():
            execution_order.append(1)
        
        @on_app_shutdown
        async def failing_hook():
            execution_order.append("fail")
            raise RuntimeError("Async hook failed")
        
        @on_app_shutdown
        def good_hook2():
            execution_order.append(2)
        
        # Should not raise exception
        await run_shutdown_hooks()
        
        # All hooks should have been attempted
        assert execution_order == [1, "fail", 2]
        assert _lifecycle_state["shutdown_initiated"] is True
    
    @pytest.mark.asyncio
    async def test_shutdown_timeout(self):
        """Test shutdown timeout mechanism."""
        
        @on_app_shutdown
        async def slow_hook():
            await asyncio.sleep(2)  # Simulate slow shutdown
        
        # Set short timeout
        with patch.dict(os.environ, {"AIUI_SHUTDOWN_TIMEOUT": "0.1"}):
            start_time = time.time()
            await run_shutdown_hooks()
            elapsed = time.time() - start_time
            
            # Should timeout quickly
            assert elapsed < 0.5
            assert _lifecycle_state["shutdown_initiated"] is True
    
    @pytest.mark.asyncio
    async def test_startup_idempotent(self):
        """Test that startup hooks are only run once."""
        call_count = 0
        
        @on_app_startup
        def increment_hook():
            nonlocal call_count
            call_count += 1
        
        # Run startup hooks multiple times
        await run_startup_hooks()
        await run_startup_hooks()
        await run_startup_hooks()
        
        # Hook should only be called once
        assert call_count == 1
        assert _lifecycle_state["startup_completed"] is True
    
    @pytest.mark.asyncio
    async def test_shutdown_idempotent(self):
        """Test that shutdown hooks are only run once."""
        call_count = 0
        
        @on_app_shutdown
        def increment_hook():
            nonlocal call_count
            call_count += 1
        
        # Run shutdown hooks multiple times
        await run_shutdown_hooks()
        await run_shutdown_hooks()
        await run_shutdown_hooks()
        
        # Hook should only be called once
        assert call_count == 1
        assert _lifecycle_state["shutdown_initiated"] is True


class TestLifecycleState:
    """Test lifecycle state management."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_lifecycle_state()
    
    def test_initial_state(self):
        """Test initial lifecycle state."""
        assert _lifecycle_state["startup_completed"] is False
        assert _lifecycle_state["shutdown_initiated"] is False
        assert _lifecycle_state["startup_time"] == 0
        assert _lifecycle_state["shutdown_time"] == 0
    
    def test_reset_state(self):
        """Test state reset functionality."""
        # Add some hooks and change state
        @on_app_startup
        def hook():
            pass
        
        _lifecycle_state["startup_completed"] = True
        _lifecycle_state["startup_time"] = 1.5
        
        assert len(_startup_hooks) == 1
        assert _lifecycle_state["startup_completed"] is True
        
        # Reset state
        reset_lifecycle_state()
        
        # Should be back to initial state
        assert len(_startup_hooks) == 0
        assert _lifecycle_state["startup_completed"] is False
        assert _lifecycle_state["startup_time"] == 0


class TestLifecycleIntegration:
    """Integration tests for lifecycle hooks."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_lifecycle_state()
    
    @pytest.mark.asyncio
    async def test_vector_store_example(self):
        """Test the vector store example from the issue."""
        # Simulate a vector store
        vector_store = {"connected": False, "closed": False}
        
        @on_app_startup
        async def warm():
            # Simulate async connection
            await asyncio.sleep(0.01)
            vector_store["connected"] = True
        
        @on_app_shutdown
        async def drain():
            # Simulate async cleanup
            await asyncio.sleep(0.01)
            vector_store["closed"] = True
        
        # Initially not connected
        assert vector_store["connected"] is False
        
        # Run startup
        await run_startup_hooks()
        assert vector_store["connected"] is True
        assert _lifecycle_state["startup_completed"] is True
        
        # Run shutdown
        await run_shutdown_hooks()
        assert vector_store["closed"] is True
        assert _lifecycle_state["shutdown_initiated"] is True
    
    @pytest.mark.asyncio
    async def test_resource_lifecycle(self):
        """Test complete resource lifecycle with startup and shutdown."""
        resource_states = []
        
        class MockResource:
            def __init__(self, name):
                self.name = name
                self.initialized = False
                self.cleaned_up = False
            
            async def initialize(self):
                resource_states.append(f"{self.name}_init")
                self.initialized = True
            
            async def cleanup(self):
                resource_states.append(f"{self.name}_cleanup")
                self.cleaned_up = True
        
        # Create resources
        db = MockResource("db")
        cache = MockResource("cache")
        queue = MockResource("queue")
        
        # Register startup hooks
        @on_app_startup
        async def init_db():
            await db.initialize()
        
        @on_app_startup
        async def init_cache():
            await cache.initialize()
        
        @on_app_startup
        async def init_queue():
            await queue.initialize()
        
        # Register shutdown hooks (reverse order)
        @on_app_shutdown
        async def cleanup_queue():
            await queue.cleanup()
        
        @on_app_shutdown
        async def cleanup_cache():
            await cache.cleanup()
        
        @on_app_shutdown
        async def cleanup_db():
            await db.cleanup()
        
        # Run lifecycle
        await run_startup_hooks()
        
        # All resources should be initialized
        assert db.initialized
        assert cache.initialized
        assert queue.initialized
        
        await run_shutdown_hooks()
        
        # All resources should be cleaned up
        assert db.cleaned_up
        assert cache.cleaned_up
        assert queue.cleaned_up
        
        # Check execution order
        expected_order = [
            "db_init", "cache_init", "queue_init",
            "queue_cleanup", "cache_cleanup", "db_cleanup"
        ]
        assert resource_states == expected_order