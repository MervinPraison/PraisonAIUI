"""Tests for the opt-in component schema registry.

Closes the gap: there was no typed Python <-> JS contract for custom
components, so component dicts could silently drift.

Design:
- Users call `aiui.register_component_schema("my-type", {...})` to register
  a JSON Schema describing their custom component dict.
- Schemas are published at `GET /api/components/schemas` for client-side
  validators, codegen, and docs.
- Schemas for all 48 built-in components are provided out of the box.

The registry is opt-in: unregistered types continue to work as before.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from praisonaiui import server as srv
from praisonaiui.datastore import MemoryDataStore


@pytest.fixture(autouse=True)
def _clean():
    srv.reset_state()
    srv.set_datastore(MemoryDataStore())
    yield
    srv.reset_state()


@pytest.fixture
def client():
    return TestClient(srv.create_app())


# ── Python API surface ────────────────────────────────────────────

class TestRegisterComponentSchema:
    def test_is_exported_on_package(self):
        import praisonaiui as aiui
        assert callable(aiui.register_component_schema)
        assert callable(aiui.get_component_schemas)

    def test_register_stores_schema(self):
        schema = {
            "type": "object",
            "required": ["type", "events"],
            "properties": {
                "type": {"const": "timeline"},
                "events": {"type": "array"},
            },
        }
        srv.register_component_schema("timeline", schema)
        schemas = srv.get_component_schemas()
        assert "timeline" in schemas
        assert schemas["timeline"]["required"] == ["type", "events"]

    def test_register_multiple(self):
        srv.register_component_schema("a", {"type": "object"})
        srv.register_component_schema("b", {"type": "object"})
        schemas = srv.get_component_schemas()
        assert {"a", "b"}.issubset(schemas)

    def test_reset_state_clears_user_schemas(self):
        srv.register_component_schema("custom-x", {"type": "object"})
        srv.reset_state()
        assert "custom-x" not in srv.get_component_schemas()

    def test_reset_state_preserves_builtins(self):
        """Built-in schemas must remain after reset_state()."""
        srv.reset_state()
        schemas = srv.get_component_schemas()
        # These are built-in Python components
        assert "card" in schemas
        assert "text_input" in schemas


# ── Endpoint ──────────────────────────────────────────────────────

class TestSchemasEndpoint:
    def test_endpoint_returns_schemas(self, client):
        resp = client.get("/api/components/schemas")
        assert resp.status_code == 200
        body = resp.json()
        assert "schemas" in body
        assert isinstance(body["schemas"], dict)

    def test_endpoint_includes_registered(self, client):
        srv.register_component_schema("my-thing", {"type": "object"})
        resp = client.get("/api/components/schemas")
        assert resp.status_code == 200
        assert "my-thing" in resp.json()["schemas"]

    def test_endpoint_includes_builtins(self, client):
        resp = client.get("/api/components/schemas")
        schemas = resp.json()["schemas"]
        # At least a sample of the Python ui.py builders
        for t in ("card", "text", "chart", "text_input"):
            assert t in schemas, f"{t} schema missing"


# ── Built-in schema coverage ──────────────────────────────────────

class TestBuiltinSchemaCoverage:
    def test_all_public_ui_types_have_schema(self):
        """Every component type emitted by praisonaiui.ui.* must have a schema."""
        import re
        from pathlib import Path
        ui_src = (
            Path(__file__).resolve().parents[2]
            / "src" / "praisonaiui" / "ui.py"
        ).read_text()
        py_types = set(re.findall(r'"type":\s*"(\w+)"', ui_src))
        schemas = srv.get_component_schemas()
        missing = py_types - set(schemas)
        assert not missing, (
            f"Built-in component types missing from schema registry: "
            f"{sorted(missing)}"
        )
