"""POST /api/agents/duplicate/{id}: the copy is a stored, editable definition."""

import asyncio
import json

from praisonaiui.features import agents


class _Req:
    def __init__(self, agent_id):
        self.path_params = {"agent_id": agent_id}


def test_duplicate_of_gateway_agent_drops_source(monkeypatch):
    created = {}

    def fake_create(**kw):
        created.update(kw)
        return {"id": "agent_copy", **kw}

    gateway_agent = {"id": "gw1", "name": "Helper", "model": "gpt-4o-mini", "source": "gateway", "status": "active"}
    monkeypatch.setattr(agents, "get_agent", lambda _id: gateway_agent)
    monkeypatch.setattr(agents, "create_agent", fake_create)

    res = asyncio.run(agents.AgentsCrudFeature()._duplicate(_Req("gw1")))

    assert res.status_code == 201
    body = json.loads(res.body)
    assert "source" not in created and "source" not in body
    assert created["name"] == "Helper (Copy)"
