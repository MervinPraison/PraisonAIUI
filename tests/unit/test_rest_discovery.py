"""Tests for REST discovery parity — agent/team endpoints.

This module tests the enhanced /agents response and new /teams endpoints
that provide full discovery capabilities for third-party frontends.

Test coverage:
- GET /agents response shape with agent_id, model, storage fields
- GET /teams endpoint
- POST /teams/{team_id}/runs
- DELETE /teams/{team_id}/sessions/{session_id}
- Backward compatibility for existing list_agents consumers
- 404 handling for non-existent teams
"""

import json
from unittest.mock import AsyncMock, Mock, patch

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse

from praisonaiui.app.protocols import AgentDetails, ModelInfo, TeamDetails
from praisonaiui.provider import BaseProvider
from praisonaiui.server import create_team_run, delete_team_session, list_agents, list_teams


class MockProvider(BaseProvider):
    """Mock provider for testing."""

    def __init__(self):
        self._agents = [
            AgentDetails(
                agent_id="agent-1",
                name="Test Agent",
                description="A test agent",
                model=ModelInfo(name="GPT-4", model="gpt-4", provider="openai"),
                storage=True
            ),
            AgentDetails(
                agent_id="agent-2",
                name="Simple Agent",
                description="",
                model=None,
                storage=False
            )
        ]
        self._teams = [
            TeamDetails(
                team_id="team-1",
                name="Test Team",
                description="A test team",
                model=ModelInfo(name="Claude", model="claude-3", provider="anthropic"),
                storage=True
            )
        ]

    async def run(self, message, **kwargs):
        yield

    async def list_agents(self):
        return [
            {
                "agent_id": agent.agent_id,
                "name": agent.name,
                "description": agent.description,
                "model": agent.model.to_dict() if agent.model else None,
                "storage": agent.storage,
                "created_at": "2024-01-01T00:00:00Z"  # Backward compatibility
            }
            for agent in self._agents
        ]

    async def list_teams(self):
        return [
            {
                "team_id": team.team_id,
                "name": team.name,
                "description": team.description,
                "model": team.model.to_dict() if team.model else None,
                "storage": team.storage,
                "created_at": "2024-01-01T00:00:00Z"
            }
            for team in self._teams
        ]


@pytest.fixture
def mock_provider():
    return MockProvider()


@pytest.fixture
def mock_request():
    return Mock(spec=Request)


class TestAgentDiscovery:
    """Test enhanced /agents endpoint."""

    @pytest.mark.asyncio
    async def test_list_agents_response_shape(self, mock_request, mock_provider):
        """Test that /agents response includes all required fields."""
        with patch('praisonaiui.server.get_provider', return_value=mock_provider):
            with patch('praisonaiui.server._agents', {}):
                response = await list_agents(mock_request)

        assert isinstance(response, JSONResponse)
        data = json.loads(response.body)

        assert "agents" in data
        agents = data["agents"]
        assert len(agents) == 2

        # Check first agent (fully specified)
        agent1 = agents[0]
        assert agent1["agent_id"] == "agent-1"
        assert agent1["name"] == "Test Agent"
        assert agent1["description"] == "A test agent"
        assert agent1["model"]["name"] == "GPT-4"
        assert agent1["model"]["model"] == "gpt-4"
        assert agent1["model"]["provider"] == "openai"
        assert agent1["storage"] is True
        assert "created_at" in agent1  # Backward compatibility

        # Check second agent (minimal)
        agent2 = agents[1]
        assert agent2["agent_id"] == "agent-2"
        assert agent2["name"] == "Simple Agent"
        assert agent2["description"] == ""
        assert agent2["model"] is None
        assert agent2["storage"] is False
        assert "created_at" in agent2  # Backward compatibility

    @pytest.mark.asyncio
    async def test_list_agents_backward_compatibility(self, mock_request, mock_provider):
        """Test that existing consumers reading name/created_at still work."""
        with patch('praisonaiui.server.get_provider', return_value=mock_provider):
            with patch('praisonaiui.server._agents', {}):
                response = await list_agents(mock_request)

        data = json.loads(response.body)
        agents = data["agents"]

        # Legacy consumers expect these fields
        for agent in agents:
            assert "name" in agent
            assert "created_at" in agent
            # New fields should also be present
            assert "agent_id" in agent
            assert "model" in agent  # May be None
            assert "storage" in agent


class TestTeamDiscovery:
    """Test new /teams endpoint."""

    @pytest.mark.asyncio
    async def test_list_teams_response_shape(self, mock_request, mock_provider):
        """Test that /teams response has correct shape."""
        with patch('praisonaiui.server.get_provider', return_value=mock_provider):
            response = await list_teams(mock_request)

        assert isinstance(response, JSONResponse)
        data = json.loads(response.body)

        assert "teams" in data
        teams = data["teams"]
        assert len(teams) == 1

        team = teams[0]
        assert team["team_id"] == "team-1"
        assert team["name"] == "Test Team"
        assert team["description"] == "A test team"
        assert team["model"]["name"] == "Claude"
        assert team["model"]["model"] == "claude-3"
        assert team["model"]["provider"] == "anthropic"
        assert team["storage"] is True

    @pytest.mark.asyncio
    async def test_list_teams_empty_when_no_teams(self, mock_request):
        """Test that /teams returns empty list when provider has no teams."""
        provider = Mock(spec=BaseProvider)
        provider.list_teams = AsyncMock(return_value=[])

        with patch('praisonaiui.server.get_provider', return_value=provider):
            response = await list_teams(mock_request)

        data = json.loads(response.body)
        assert data == {"teams": []}


class TestTeamRuns:
    """Test team run endpoints."""

    @pytest.mark.asyncio
    async def test_create_team_run_404_for_nonexistent_team(self, mock_provider):
        """Test that POST /teams/{team_id}/runs returns 404 for unknown team."""
        from starlette.responses import Response

        # Mock request with path params
        request = Mock(spec=Request)
        request.path_params = {"team_id": "nonexistent"}
        request.json = AsyncMock(return_value={"message": "Hello"})

        with patch('praisonaiui.server.get_provider', return_value=mock_provider):
            response = await create_team_run(request)

        assert isinstance(response, Response)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_team_session_success(self, mock_provider):
        """Test that DELETE /teams/{team_id}/sessions/{session_id} returns 204."""
        from starlette.responses import Response

        request = Mock(spec=Request)
        request.path_params = {"team_id": "team-1", "session_id": "session-1"}

        with patch('praisonaiui.server.get_provider', return_value=mock_provider):
            response = await delete_team_session(request)

        assert isinstance(response, Response)
        assert response.status_code == 204


class TestDataclassIntegration:
    """Test dataclass serialization and protocol integration."""

    def test_agent_details_to_dict(self):
        """Test AgentDetails.to_dict() method."""
        model = ModelInfo(name="GPT-4", model="gpt-4-turbo", provider="openai")
        agent = AgentDetails(
            agent_id="test-1",
            name="Test Agent",
            description="Test description",
            model=model,
            storage=True
        )

        result = agent.to_dict()
        expected = {
            "agent_id": "test-1",
            "name": "Test Agent",
            "description": "Test description",
            "model": {
                "name": "GPT-4",
                "model": "gpt-4-turbo",
                "provider": "openai"
            },
            "storage": True
        }
        assert result == expected

    def test_team_details_to_dict(self):
        """Test TeamDetails.to_dict() method."""
        team = TeamDetails(
            team_id="test-team",
            name="Test Team",
            description="Test team description",
            model=None,
            storage=False
        )

        result = team.to_dict()
        expected = {
            "team_id": "test-team",
            "name": "Test Team",
            "description": "Test team description",
            "model": None,
            "storage": False
        }
        assert result == expected

    def test_model_info_to_dict(self):
        """Test ModelInfo.to_dict() method."""
        model = ModelInfo(name="Claude", model="claude-3-sonnet", provider="anthropic")

        result = model.to_dict()
        expected = {
            "name": "Claude",
            "model": "claude-3-sonnet",
            "provider": "anthropic"
        }
        assert result == expected
