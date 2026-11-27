"""Regression tests for #661 (AG-UI agent resolution & health) and #662 (reflection kwarg)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui import server as srv
from praisonaiui.features import agui as agui_mod
from praisonaiui.features.agui import AguiFeature, _agent_available, _resolve_agent


class _FakeGateway:
    def __init__(self, agents: dict[str, object]) -> None:
        self._agents = agents

    def list_agents(self) -> list[str]:
        return list(self._agents.keys())

    def get_agent(self, agent_id: str):
        return self._agents.get(agent_id)


class _DummyAgent:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeProvider:
    def __init__(self, created: object | None = None) -> None:
        self._agent = None
        self._agents: list[object] = []
        self.create_calls: list[str | None] = []
        self._created = created

    def _find_existing_agent(self, agent_name: str | None = None, session_id: str | None = None):
        return self._agent

    def _get_or_create_agent(self, agent_name: str | None = None, session_id: str | None = None):
        self.create_calls.append(agent_name)
        return self._created


def test_agui_resolves_gateway_agent_and_reports_healthy(monkeypatch):
    """When gateway has active agents, AG-UI resolves them and reports status ok (#661)."""
    gw_agent = _DummyAgent("Researcher")
    gw = _FakeGateway({"researcher": gw_agent})

    monkeypatch.setattr(srv, "_agents", {})
    monkeypatch.setattr(srv, "get_provider", lambda: _FakeProvider())
    monkeypatch.setattr(agui_mod, "sdk_installed", lambda: False)
    monkeypatch.setattr("praisonaiui.features._gateway_ref.get_gateway", lambda: gw)

    assert _resolve_agent(create=False) is gw_agent
    assert _resolve_agent("Researcher", create=False) is gw_agent
    assert _resolve_agent("researcher", create=False) is gw_agent
    assert _agent_available() is True

    feat = AguiFeature()
    h = asyncio.run(feat.health())
    assert h["status"] == "ok"
    assert h["agent_available"] is True
    assert h["gateway_connected"] is True
    assert h["gateway_agent_count"] == 1

    app = Starlette(routes=feat.routes())
    with TestClient(app) as client:
        r = client.get("/agui/status")
        assert r.status_code == 200
        assert r.json() == {"status": "available", "agent_registered": True}


def test_agui_health_is_lazy_and_resolves_provider_on_demand(monkeypatch):
    """Health/status never constructs an Agent, while POST /agui lazily creates one (#661)."""
    lazy_agent = _DummyAgent("Assistant")
    provider = _FakeProvider(created=lazy_agent)

    monkeypatch.setattr(srv, "_agents", {})
    monkeypatch.setattr(srv, "get_provider", lambda: provider)
    monkeypatch.setattr("praisonaiui.features._gateway_ref.get_gateway", lambda: None)
    monkeypatch.setattr(agui_mod, "sdk_installed", lambda: True)

    # Health check and /agui/status see provider capability without constructing an Agent
    feat = AguiFeature()
    h = asyncio.run(feat.health())
    assert h["status"] == "ok"
    assert h["agent_available"] is True
    assert provider.create_calls == []

    # Actual run resolution builds the agent lazily
    assert _resolve_agent("Assistant", create=True) is lazy_agent
    assert provider.create_calls == ["Assistant"]

    # Without SDK and without registered/gateway agents, health is degraded
    monkeypatch.setattr(agui_mod, "sdk_installed", lambda: False)
    h_off = asyncio.run(feat.health())
    assert h_off["status"] == "degraded"
    assert h_off["agent_available"] is False


def test_no_deprecated_self_reflect_kwarg_in_source_or_gateway_example():
    """Guard against praisonaiagents 1.8+ incompatible ``self_reflect=`` kwarg (#662)."""
    repo_root = Path(__file__).resolve().parents[2]
    targets = [
        repo_root / "src" / "praisonaiui" / "integration.py",
        repo_root / "src" / "praisonaiui" / "features" / "media_analysis.py",
        repo_root / "examples" / "python" / "16-gateway-integration" / "app.py",
    ]
    for path in targets:
        text = path.read_text(encoding="utf-8")
        assert "self_reflect=" not in text, f"Deprecated self_reflect= found in {path}"


def test_praisonaiagents_agent_accepts_reflection_kwarg(monkeypatch):
    """Runtime verification with installed praisonaiagents (#662)."""
    praisonaiagents = pytest.importorskip("praisonaiagents")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-placeholder")
    agent = praisonaiagents.Agent(
        name="GatewaySmoke",
        instructions="Be concise.",
        llm="gpt-4o-mini",
        reflection=False,
    )
    assert agent.name == "GatewaySmoke"
