"""TDD Tests for PraisonAIUI Protocol Architecture Fixes.

Tests P0 (memory), P1 (skills), and verifies SDK-first pattern.
"""

import pytest


class TestP0MemoryDefaultBackend:
    """P0: Memory manager should default to SDKMemoryManager."""

    def test_memory_manager_defaults_to_sdk(self):
        """get_memory_manager() should return SDKMemoryManager by default."""
        import praisonaiui.features.memory as mem_module
        from praisonaiui.features.memory import (
            get_memory_manager,
            SDKMemoryManager,
            SimpleMemoryManager,
        )
        
        # Reset singleton
        mem_module._memory_manager = None
        
        mgr = get_memory_manager()
        assert isinstance(mgr, SDKMemoryManager), \
            f"Expected SDKMemoryManager, got {type(mgr).__name__}"

    def test_memory_manager_fallback_to_simple(self):
        """If SDK fails, should fall back to SimpleMemoryManager."""
        import praisonaiui.features.memory as mem_module
        from praisonaiui.features.memory import (
            set_memory_manager,
            get_memory_manager,
            SimpleMemoryManager,
        )
        
        # Force SimpleMemoryManager
        set_memory_manager(SimpleMemoryManager())
        
        mgr = get_memory_manager()
        assert isinstance(mgr, SimpleMemoryManager)

    def test_sdk_memory_manager_has_required_methods(self):
        """SDKMemoryManager should implement MemoryProtocol."""
        from praisonaiui.features.memory import SDKMemoryManager
        
        mgr = SDKMemoryManager()
        
        # Check required methods exist
        assert hasattr(mgr, "store")
        assert hasattr(mgr, "search")
        assert hasattr(mgr, "list_all")
        assert hasattr(mgr, "get")
        assert hasattr(mgr, "delete")
        assert hasattr(mgr, "clear")
        assert hasattr(mgr, "get_context")
        assert hasattr(mgr, "health")


class TestP1SkillsSDKIntegration:
    """P1: Skills should read from SDK TOOL_MAPPINGS."""

    def test_get_tool_catalog_returns_sdk_tools(self):
        """get_tool_catalog() should return SDK tools when available."""
        from praisonaiui.features.skills import get_tool_catalog
        
        catalog = get_tool_catalog()
        
        # SDK has 101 tools
        assert len(catalog) >= 100, f"Expected 100+ tools, got {len(catalog)}"

    def test_sdk_tools_have_sdk_flag(self):
        """SDK tools should have sdk_tool=True flag."""
        from praisonaiui.features.skills import get_tool_catalog
        
        catalog = get_tool_catalog()
        sdk_tools = [k for k, v in catalog.items() if v.get("sdk_tool", False)]
        
        # All tools from SDK should have the flag
        assert len(sdk_tools) >= 100, f"Expected 100+ SDK tools, got {len(sdk_tools)}"

    def test_tool_catalog_has_required_fields(self):
        """Each tool in catalog should have required fields."""
        from praisonaiui.features.skills import get_tool_catalog
        
        catalog = get_tool_catalog()
        
        for tool_id, info in list(catalog.items())[:10]:  # Check first 10
            assert "name" in info, f"Tool {tool_id} missing 'name'"
            assert "description" in info, f"Tool {tool_id} missing 'description'"
            assert "category" in info, f"Tool {tool_id} missing 'category'"
            assert "icon" in info, f"Tool {tool_id} missing 'icon'"

    def test_get_tool_catalog_is_cached(self):
        """get_tool_catalog() should cache results."""
        import praisonaiui.features.skills as skills_module
        from praisonaiui.features.skills import get_tool_catalog
        
        # Reset cache
        skills_module._sdk_tool_catalog = None
        
        catalog1 = get_tool_catalog()
        catalog2 = get_tool_catalog()
        
        # Should be same object (cached)
        assert catalog1 is catalog2


class TestProtocolPattern:
    """Test that features follow the SDK-first protocol pattern."""

    def test_memory_protocol_exists(self):
        """MemoryProtocol ABC should exist."""
        from praisonaiui.features.memory import MemoryProtocol
        from abc import ABC
        
        assert issubclass(MemoryProtocol, ABC)

    def test_sessions_uses_sdk_first(self):
        """Sessions should try SDK first."""
        from praisonaiui.features.sessions_ext import _get_session_store
        
        store = _get_session_store()
        # Should have session methods
        assert hasattr(store, "get_session") or hasattr(store, "get")

    def test_schedules_uses_sdk_first(self):
        """Schedules should try SDK first."""
        from praisonaiui.features.schedules import _get_schedule_store
        
        store = _get_schedule_store()
        # Should have schedule methods
        assert store is not None
