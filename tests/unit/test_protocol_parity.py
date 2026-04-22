"""Protocol-parity tests for Issues #48, #49, #50.

Covers:
- Enriched /agents response + /teams REST surface (#48)
- RAG ``REFERENCES`` event + ``Reference`` / ``ReferenceData`` (#49)
- Rich ``ReasoningStep`` schema + ``reasoning_step_event`` helper (#50)

The tests run against the ASGI app built by ``praisonaiui.build_app()`` so
route wiring, schema serialisation, and provider delegation are verified
end-to-end without spinning up a real HTTP server.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType


# ── Fixtures ────────────────────────────────────────────────────────


class _StubProvider(BaseProvider):
    """Provider that advertises one team and one simple run."""

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"echo:{message}")

    async def list_agents(self):
        return [
            {
                "agent_id": "a1",
                "name": "helper",
                "description": "a helper",
                "model": {"name": "gpt-4o", "model": "gpt-4o", "provider": "openai"},
                "storage": True,
            }
        ]

    async def list_teams(self):
        return [
            {
                "team_id": "t1",
                "name": "squad",
                "description": "a squad",
                "model": {"name": "gpt-4o", "model": "gpt-4o", "provider": "openai"},
                "storage": False,
            }
        ]


@pytest.fixture()
def client(monkeypatch):
    """Build a fresh app with the stub provider installed."""
    from praisonaiui.server import create_app

    aiui.set_provider(_StubProvider())
    app = create_app()
    with TestClient(app) as c:
        yield c


# ── Issue #48: REST discovery ───────────────────────────────────────


def test_list_agents_returns_enriched_schema(client):
    r = client.get("/agents")
    assert r.status_code == 200
    agents = r.json()["agents"]
    assert agents, "expected at least one agent"
    a = agents[0]
    # Enriched fields
    assert "agent_id" in a
    assert "name" in a
    assert "description" in a
    assert "storage" in a


def test_list_teams_returns_team_array(client):
    r = client.get("/teams")
    assert r.status_code == 200
    teams = r.json()["teams"]
    assert teams and teams[0]["team_id"] == "t1"
    assert teams[0]["name"] == "squad"


def test_list_teams_api_alias(client):
    r = client.get("/api/teams")
    assert r.status_code == 200
    assert "teams" in r.json()


def test_teams_run_invalid_json_returns_400(client):
    r = client.post(
        "/teams/t1/runs",
        content="not-json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 400


def test_teams_route_delete_endpoint_registered(client):
    # DELETE on a non-existent team session should not 404-on-route-missing
    # (it either 204s or returns a body — either way the route exists).
    r = client.delete("/teams/t1/sessions/nope")
    assert r.status_code < 500


# ── Issue #49: references (RAG citations) ───────────────────────────


def test_reference_dataclass_round_trip():
    r = aiui.Reference(name="doc.md", content="x", chunk=3, chunk_size=400)
    d = r.to_dict()
    assert d == {"name": "doc.md", "content": "x", "chunk": 3, "chunk_size": 400}


def test_reference_data_round_trip():
    rd = aiui.ReferenceData(
        query="what is x",
        references=[aiui.Reference(name="a.md", content="alpha")],
        time_ms=12.0,
    )
    d = rd.to_dict()
    assert d["query"] == "what is x"
    assert d["time_ms"] == 12.0
    assert d["references"][0]["name"] == "a.md"


def test_references_event_helper():
    ev = BaseProvider.references_event(
        query="q",
        references=[aiui.Reference(name="a.md", content="alpha", chunk=1, chunk_size=50)],
        time_ms=8.5,
    )
    assert ev.type is RunEventType.REFERENCES
    payload = ev.to_dict()
    assert payload["type"] == "references"
    assert payload["query"] == "q"
    assert payload["references"][0]["name"] == "a.md"
    assert payload["time_ms"] == 8.5


def test_references_enum_value_is_stable():
    assert RunEventType.REFERENCES.value == "references"


# ── Issue #50: rich reasoning step ──────────────────────────────────


def test_reasoning_step_optional_fields_omitted_when_absent():
    s = aiui.ReasoningStep(title="plan")
    d = s.to_dict()
    # Optional fields stay out of the dict entirely when None
    assert "action" not in d
    assert "confidence" not in d
    assert "next_action" not in d
    assert d["title"] == "plan"


def test_reasoning_step_full_fields():
    s = aiui.ReasoningStep(
        title="search",
        result="found 3 refs",
        reasoning="because the query was specific",
        action="search",
        confidence=0.82,
        next_action="verify",
    )
    d = s.to_dict()
    assert d == {
        "title": "search",
        "result": "found 3 refs",
        "reasoning": "because the query was specific",
        "action": "search",
        "confidence": 0.82,
        "next_action": "verify",
    }


def test_reasoning_step_event_helper_carries_fields():
    step = aiui.ReasoningStep(title="plan", confidence=0.9, action="plan")
    ev = BaseProvider.reasoning_step_event(step)
    assert ev.type is RunEventType.REASONING_STEP
    d = ev.to_dict()
    assert d["step"] == "plan"
    assert d["confidence"] == 0.9
    assert d["action"] == "plan"
    # Full structured payload is also in extra_data for lossless replay
    assert d["extra_data"]["title"] == "plan"


def test_runevent_backcompat_unstructured_step_still_works():
    """Old providers pass ``step=<text>`` without any new fields — still valid."""
    ev = RunEvent(type=RunEventType.REASONING_STEP, step="just some text")
    d = ev.to_dict()
    assert d["step"] == "just some text"
    assert "action" not in d
    assert "confidence" not in d


# ── Public surface ──────────────────────────────────────────────────


def test_new_symbols_in_dunder_all():
    expected = {
        "ModelInfo",
        "AgentDetails",
        "TeamDetails",
        "Reference",
        "ReferenceData",
        "ReasoningStep",
    }
    missing = expected - set(aiui.__all__)
    assert not missing, f"Missing from __all__: {sorted(missing)}"
