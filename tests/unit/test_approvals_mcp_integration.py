"""Test approvals and MCP integration."""

import pytest

from praisonaiui.features.approvals import ApprovalsFeature, SimpleApprovalManager
from praisonaiui.features.mcp_api import MCPAPIFeature


def test_approvals_feature_init():
    """Test that ApprovalsFeature can be initialized."""
    feature = ApprovalsFeature()
    assert feature.name == "approvals"
    assert feature.description == "Tool-execution approval management"

    # Check routes are registered
    routes = feature.routes()
    assert len(routes) > 0
    route_paths = [r.path for r in routes]
    assert "/api/approvals" in route_paths
    assert "/api/approvals/pending" in route_paths
    assert "/api/approvals/stream" in route_paths


def test_simple_approval_manager():
    """Test SimpleApprovalManager functionality."""
    mgr = SimpleApprovalManager()

    # Request approval with high risk to ensure it's pending
    entry = {
        "tool_name": "test_tool",
        "risk_level": "high",
        "arguments": {"test": "arg"},
        "agent_name": "test_agent",
    }
    result = mgr.request_approval(entry)

    assert result["id"]
    assert result["status"] == "pending"
    assert result["tool_name"] == "test_tool"

    # List pending
    pending = mgr.list_pending()
    assert len(pending) == 1

    # Approve it
    approved = mgr.approve(result["id"], "test reason")
    assert approved is not None
    assert approved["status"] == "approved"
    assert approved["reason"] == "test reason"

    # Check it's no longer pending
    pending = mgr.list_pending()
    assert len(pending) == 0

    # Check history
    history = mgr.list_history()
    assert len(history) == 1


def test_mcp_api_feature_init():
    """Test that MCPAPIFeature can be initialized."""
    feature = MCPAPIFeature()
    assert feature.name == "mcp_api"
    assert feature.description == "MCP server management API endpoints"

    # Check routes are registered
    routes = feature.routes()
    assert len(routes) > 0
    route_paths = [r.path for r in routes]
    assert "/api/mcp/servers" in route_paths
    assert "/api/mcp/connect" in route_paths
    assert "/api/mcp/disconnect" in route_paths


@pytest.mark.asyncio
async def test_mcp_api_health():
    """Test MCP API health check."""
    feature = MCPAPIFeature()
    health = await feature.health()

    assert health["status"] == "ok"
    assert health["feature"] == "mcp_api"
    assert "total_servers" in health
    assert "connected_servers" in health


def test_approval_risk_levels():
    """Test approval risk level handling."""
    mgr = SimpleApprovalManager()

    # Test auto-approve for low risk
    mgr.update_policies({"risk_threshold": "medium"})

    low_risk = mgr.request_approval({
        "tool_name": "safe_tool",
        "risk_level": "low",
        "arguments": {},
    })

    # Should be auto-approved
    assert low_risk["status"] == "approved"
    assert low_risk["approver"] == "auto-policy"

    # High risk should require approval
    high_risk = mgr.request_approval({
        "tool_name": "dangerous_tool",
        "risk_level": "high",
        "arguments": {},
    })

    assert high_risk["status"] == "pending"


def test_approval_policies():
    """Test approval policy management."""
    mgr = SimpleApprovalManager()

    # Get default policies
    policies = mgr.get_policies()
    assert "auto_approve_tools" in policies
    assert "always_deny_tools" in policies
    assert "risk_threshold" in policies

    # Update policies
    mgr.update_policies({
        "auto_approve_tools": ["safe_tool"],
        "always_deny_tools": ["dangerous_tool"],
    })

    # Test auto-approve
    safe = mgr.request_approval({
        "tool_name": "safe_tool",
        "risk_level": "high",
        "arguments": {},
    })
    assert safe["status"] == "approved"

    # Test auto-deny
    dangerous = mgr.request_approval({
        "tool_name": "dangerous_tool",
        "risk_level": "low",
        "arguments": {},
    })
    assert dangerous["status"] == "denied"
