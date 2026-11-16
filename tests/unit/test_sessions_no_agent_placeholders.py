"""GET /api/sessions lists conversations only.

Every agent registered with the gateway (each one created on the Agents page
is, through features/agents.py _sync_to_gateway) used to be added to the list
as an empty "agent:<name>" session, which the chat sidebar showed as
"Chat agent:…". Registering an agent must not add a chat session.
"""

import asyncio
from types import SimpleNamespace

import pytest
from starlette.testclient import TestClient

from praisonaiui.datastore import MemoryDataStore
from praisonaiui.features import _gateway_ref


class _Gateway:
    def __init__(self, agents):
        self._agents = agents

    def list_agents(self):
        return list(self._agents)

    def get_agent(self, agent_id):
        return self._agents.get(agent_id)


@pytest.fixture
def client():
    import praisonaiui.server as server

    store = MemoryDataStore()
    asyncio.run(store.create_session("chat-1"))
    original_store, original_gw = server._datastore, _gateway_ref.get_gateway()
    server._datastore = store
    _gateway_ref.set_gateway(_Gateway({"agent_1": SimpleNamespace(name="Researcher")}))
    try:
        yield TestClient(server.create_app())
    finally:
        server._datastore = original_store
        _gateway_ref.set_gateway(original_gw)


def test_registered_agents_are_not_listed_as_sessions(client):
    body = client.get("/api/sessions").json()
    ids = [s["id"] for s in body["sessions"]]
    assert "chat-1" in ids
    assert not [i for i in ids if i.startswith("agent:")], ids
    assert body["count"] == len(ids)
