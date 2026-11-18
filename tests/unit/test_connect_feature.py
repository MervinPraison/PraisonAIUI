"""builtin.connect: /api/connect and /api/connect/tools.

``praisonai_mcp.connect`` is replaced by a fake module, so these tests never
spawn a server, read a real editor config or call an LLM.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.features.connect import ConnectFeature


@dataclass(frozen=True)
class FakeSpec:
    name: str = "praisonai"
    command: str | None = None
    args: tuple = ()
    url: str | None = None

    def to_dict(self):
        return {"name": self.name, "url": self.url} if self.url else {"name": self.name, "command": self.command, "args": list(self.args)}


@dataclass
class FakeResult:
    ok: bool
    tools: int = 0
    server: str = ""
    error: str = ""
    names: list = field(default_factory=list)


@pytest.fixture
def fake_mcp(monkeypatch):
    calls = {"verify": 0}
    catalog = types.ModuleType("praisonai_mcp.connect.catalog")
    catalog.ServerSpec = FakeSpec
    catalog.local_spec = lambda tools=(): FakeSpec(command="/bin/praisonai-mcp", args=("serve", *(["--tools", ",".join(tools)] if tools else [])))
    catalog.export_catalog = lambda spec, home: [
        {"id": "cursor", "label": "Cursor", "group": "editor", "deeplink": f"cursor://x?{' '.join(spec.args) or spec.url}", "snippet": "{}"}
    ]
    catalog.client_for = lambda name: "cursor" if "cursor" in name else None
    probe = types.ModuleType("praisonai_mcp.connect.probe")
    probe.connections = lambda: [{"name": "cursor-vscode", "last_active": 1.0}]

    def verify(spec):
        calls["verify"] += 1
        return FakeResult(True, 2, "praisonai", names=["ask_support", "praisonai.memory.show"])

    probe.verify = verify
    cmd = types.ModuleType("praisonai_mcp.cli.commands.connect")
    cmd.status_rows = lambda home: [
        {"id": "cursor", "status": "connected", "last_active": 1.0, "plaintext_secrets": [], "config_path": "/secret/path"}
    ]
    pkg = types.ModuleType("praisonai_mcp.connect")
    pkg.catalog, pkg.probe = catalog, probe
    for name, mod in {
        "praisonai_mcp": types.ModuleType("praisonai_mcp"),
        "praisonai_mcp.connect": pkg,
        "praisonai_mcp.connect.catalog": catalog,
        "praisonai_mcp.connect.probe": probe,
        "praisonai_mcp.cli": types.ModuleType("praisonai_mcp.cli"),
        "praisonai_mcp.cli.commands": types.ModuleType("praisonai_mcp.cli.commands"),
        "praisonai_mcp.cli.commands.connect": cmd,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)
    monkeypatch.delenv("AIUI_MCP_URL", raising=False)
    return calls


def _client():
    return TestClient(Starlette(routes=ConnectFeature().routes()))


def test_catalog_status_and_connections(fake_mcp):
    body = _client().get("/api/connect").json()
    assert body["available"] and body["scopable"] and body["server"]["transport"] == "stdio"
    assert body["clients"][0]["id"] == "cursor"
    assert body["status"] == {"cursor": {"status": "connected", "last_active": 1.0, "plaintext_secrets": []}}
    assert "config_path" not in body["status"]["cursor"]  # no local paths over HTTP
    assert body["connections"] == [{"name": "cursor-vscode", "last_active": 1.0, "client_id": "cursor"}]


def test_scope_rewrites_the_links(fake_mcp):
    body = _client().get("/api/connect", params={"tools": "ask_*, list_agents"}).json()
    assert body["scope"] == ["ask_*", "list_agents"]
    assert "--tools ask_*,list_agents" in body["clients"][0]["deeplink"]


def test_one_line_url_config(fake_mcp, monkeypatch):
    monkeypatch.setenv("AIUI_MCP_URL", "https://agents.example.com/mcp")
    body = _client().get("/api/connect", params={"tools": "x"}).json()
    assert body["server"]["url"] == "https://agents.example.com/mcp" and body["server"]["transport"] == "http"
    assert not body["scopable"]


def test_tools_are_listed_once_and_cached(fake_mcp):
    c = _client()
    first = c.get("/api/connect/tools").json()
    assert first == {"ok": True, "server": "praisonai", "tools": ["ask_support", "praisonai.memory.show"], "count": 2, "error": ""}
    c.get("/api/connect/tools")
    assert fake_mcp["verify"] == 1


def test_without_praisonai_mcp_the_page_says_how_to_install(monkeypatch):
    monkeypatch.setitem(sys.modules, "praisonai_mcp", None)
    monkeypatch.setitem(sys.modules, "praisonai_mcp.connect", None)
    body = _client().get("/api/connect").json()
    assert body == {"available": False, "install": "pip install praisonai-mcp", "server": None}
    assert _client().get("/api/connect/tools").json()["ok"] is False


def test_routes_require_auth_when_auth_is_on(fake_mcp, monkeypatch):
    """R8: mounted by the host, behind its auth like every /api route."""
    from praisonaiui.server import create_app

    monkeypatch.setenv("AUTH_ENFORCE", "true")
    app = create_app()
    assert {"/api/connect", "/api/connect/tools"} <= {getattr(r, "path", "") for r in app.routes}
    client = TestClient(app, raise_server_exceptions=False)
    for path in ("/api/connect", "/api/connect/tools"):
        assert client.get(path, headers={"Accept": "application/json"}).status_code == 401, path
