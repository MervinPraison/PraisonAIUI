"""TDD Tests for Gateway Fixes.

Tests G-1 (Python version), G-2 (DRY helper), G-3 (StandaloneGateway), G-4 (fallback).
"""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock


class TestStandaloneGateway:
    """G-3: Test StandaloneGateway API surface."""

    def test_register_agent(self):
        """register_agent() should store agent by name."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        gw = StandaloneGateway()
        mock_agent = MagicMock()
        
        gw.register_agent("test_agent", mock_agent)
        
        assert "test_agent" in gw.list_agents()
        assert gw.get_agent("test_agent") is mock_agent

    def test_unregister_agent(self):
        """unregister_agent() should remove agent."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        gw = StandaloneGateway()
        mock_agent = MagicMock()
        
        gw.register_agent("test_agent", mock_agent)
        gw.unregister_agent("test_agent")
        
        assert "test_agent" not in gw.list_agents()
        assert gw.get_agent("test_agent") is None

    def test_list_agents(self):
        """list_agents() should return list of agent names."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        gw = StandaloneGateway()
        gw.register_agent("agent1", MagicMock())
        gw.register_agent("agent2", MagicMock())
        
        agents = gw.list_agents()
        
        assert isinstance(agents, list)
        assert "agent1" in agents
        assert "agent2" in agents

    def test_get_agent_returns_none_for_missing(self):
        """get_agent() should return None for non-existent agent."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        gw = StandaloneGateway()
        
        assert gw.get_agent("nonexistent") is None

    def test_health(self):
        """health() should return status dict."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        gw = StandaloneGateway()
        gw.register_agent("agent1", MagicMock())
        
        health = gw.health()
        
        assert health["type"] == "StandaloneGateway"
        assert health["agents"] == 1
        assert "bots" in health

    def test_thread_safety(self):
        """Gateway operations should be thread-safe."""
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        import threading
        
        gw = StandaloneGateway()
        errors = []
        
        def register_agents():
            try:
                for i in range(100):
                    gw.register_agent(f"agent_{threading.current_thread().name}_{i}", MagicMock())
            except Exception as e:
                errors.append(e)
        
        threads = [threading.Thread(target=register_agents) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(errors) == 0, f"Thread safety errors: {errors}"


class TestGatewayRef:
    """Test gateway reference singleton."""

    def test_set_and_get_gateway(self):
        """set_gateway() and get_gateway() should work."""
        from praisonaiui.features._gateway_ref import set_gateway, get_gateway
        
        mock_gw = MagicMock()
        set_gateway(mock_gw)
        
        assert get_gateway() is mock_gw
        
        # Cleanup
        set_gateway(None)

    def test_get_gateway_returns_none_when_not_set(self):
        """get_gateway() should return None when not set."""
        from praisonaiui.features._gateway_ref import set_gateway, get_gateway
        
        set_gateway(None)
        
        assert get_gateway() is None


class TestGatewayFallback:
    """G-4: Test gateway initialization fallback."""

    def test_init_gateway_uses_standalone_when_praisonai_unavailable(self):
        """Should fall back to StandaloneGateway when praisonai not available."""
        from praisonaiui.features._gateway_ref import set_gateway, get_gateway
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        
        # Clear existing gateway
        set_gateway(None)
        
        # Mock praisonai import to fail
        with patch.dict('sys.modules', {'praisonai': None, 'praisonai.gateway': None}):
            from praisonaiui.server import _init_gateway_standalone
            _init_gateway_standalone()
        
        gw = get_gateway()
        assert gw is not None
        assert isinstance(gw, StandaloneGateway)
        
        # Cleanup
        set_gateway(None)

    def test_init_gateway_skips_if_already_set(self):
        """Should not reinitialize if gateway already set."""
        from praisonaiui.features._gateway_ref import set_gateway, get_gateway
        from praisonaiui.server import _init_gateway_standalone
        
        mock_gw = MagicMock()
        set_gateway(mock_gw)
        
        _init_gateway_standalone()
        
        # Should still be the mock, not replaced
        assert get_gateway() is mock_gw
        
        # Cleanup
        set_gateway(None)


class TestSchedulesDRYHelper:
    """G-2: Test _get_agent_for_execution helper."""

    @pytest.mark.asyncio
    async def test_get_agent_from_gateway(self):
        """Should find agent from gateway by name."""
        from praisonaiui.features._gateway_ref import set_gateway
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        from praisonaiui.features.schedules import _get_agent_for_execution
        
        gw = StandaloneGateway()
        mock_agent = MagicMock()
        mock_agent.name = "test_agent"
        gw.register_agent("test_agent", mock_agent)
        set_gateway(gw)
        
        agent, gateway, error = await _get_agent_for_execution("job1", "test_agent")
        
        assert agent is mock_agent
        assert gateway is gw
        assert error is None
        
        # Cleanup
        set_gateway(None)

    @pytest.mark.asyncio
    async def test_get_agent_fallback_to_first(self):
        """Should use first agent if no name match."""
        from praisonaiui.features._gateway_ref import set_gateway
        from praisonaiui.features._standalone_gateway import StandaloneGateway
        from praisonaiui.features.schedules import _get_agent_for_execution
        
        gw = StandaloneGateway()
        mock_agent = MagicMock()
        mock_agent.name = "default_agent"
        gw.register_agent("default_agent", mock_agent)
        set_gateway(gw)
        
        # Request non-existent agent name
        agent, gateway, error = await _get_agent_for_execution("job1", "nonexistent")
        
        # Should fall back to first available
        assert agent is mock_agent
        
        # Cleanup
        set_gateway(None)

    @pytest.mark.asyncio
    async def test_get_agent_creates_via_provider_when_no_gateway(self):
        """Should create agent via provider when no gateway available."""
        from praisonaiui.features._gateway_ref import set_gateway
        from praisonaiui.features.schedules import _get_agent_for_execution
        
        set_gateway(None)
        
        # When gateway is None, provider fallback should create agent
        agent, gateway, error = await _get_agent_for_execution("job1", None)
        
        # Gateway should be None
        assert gateway is None
        # Agent should be created via provider fallback (or error if provider fails)
        # This tests the fallback path works correctly
        if agent is not None:
            # Provider successfully created agent
            assert hasattr(agent, 'chat'), "Agent should have chat method"
        else:
            # Provider failed, should have error
            assert error is not None, "Expected error when no agent created"


class TestPythonVersionConstraint:
    """G-1: Test Python version constraint is updated."""

    def test_praisonai_supports_python_314(self):
        """praisonai should support Python 3.14."""
        import tomllib
        from pathlib import Path
        
        pyproject_path = Path("/Users/praison/praisonai-package/src/praisonai/pyproject.toml")
        if not pyproject_path.exists():
            pytest.skip("pyproject.toml not found")
        
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
        
        requires_python = data.get("project", {}).get("requires-python", "")
        
        # Should allow Python 3.14 (constraint should be <3.15, not <3.13)
        assert "<3.15" in requires_python or "<=3.14" in requires_python, \
            f"Expected Python 3.14 support, got: {requires_python}"
