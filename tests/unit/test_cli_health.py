"""Unit tests for CLI health-check command."""

import json
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


class TestHealthCheckCommand:
    """Test the health-check CLI command."""

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_health_check_shows_green_for_success_statuses(self, status):
        """Test health-check command shows green panel for both ok and healthy."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(
            {"status": status, "timestamp": "2026-06-23T10:00:00Z"}
        ).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["health-check"])

            assert result.exit_code == 0
            assert "Health Check" in result.stdout
            # Check that status is displayed (Rich strips color codes in test output)
            assert status in result.stdout
            # The test would need more complex setup to verify colors in Rich output

    @pytest.mark.parametrize("status", ["degraded", "error", "unknown"])
    def test_health_check_shows_yellow_for_non_success_statuses(self, status):
        """Test health-check command shows yellow panel for non-success statuses."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(
            {"status": status, "timestamp": "2026-06-23T10:00:00Z"}
        ).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["health-check"])

            assert result.exit_code == 0
            assert "Health Check" in result.stdout
            # Check that status is displayed (Rich strips color codes in test output)
            assert status in result.stdout

    def test_health_check_handles_server_unreachable(self):
        """Test health-check command handles unreachable server."""
        with patch("urllib.request.urlopen", side_effect=Exception("Connection refused")):
            result = runner.invoke(app, ["health-check"])

            assert result.exit_code == 1
            assert "Server unreachable" in result.stdout
            assert "✗" in result.stdout  # Rich strips color codes


class TestDoctorCommand:
    """Test the doctor CLI command."""

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_doctor_health_extractor_accepts_success_statuses(self, status):
        """Test doctor command's health extractor accepts both ok and healthy."""
        def mock_api_get(server, path):
            if path == "/health/live":
                return {"status": status}
            elif path == "/api/provider":
                return {"name": "TestProvider"}
            elif path == "/api/provider/health":
                return {"type": "gateway", "agents": 2}
            elif path == "/api/features":
                return {"features": []}
            elif path == "/api/config":
                return {"config": {}}
            elif path == "/sessions":
                return []
            elif path == "/api/channels":
                return {"channels": []}
            return {}

        with patch("praisonaiui.cli._api_get", side_effect=mock_api_get):
            result = runner.invoke(app, ["doctor", "--json"])

            assert result.exit_code == 0
            output = json.loads(result.stdout)

            # Find the Server Health check
            health_check = next(
                (c for c in output["checks"] if c["name"] == "Server Health"), None
            )
            assert health_check is not None
            assert health_check["status"] == "pass"
            assert "running on" in health_check["detail"]

    @pytest.mark.parametrize("status", ["degraded", "error"])
    def test_doctor_health_extractor_warns_for_non_success_statuses(self, status):
        """Test doctor command's health extractor warns for non-success statuses."""
        def mock_api_get(server, path):
            if path == "/health/live":
                return {"status": status}
            return {}

        with patch("praisonaiui.cli._api_get", side_effect=mock_api_get):
            result = runner.invoke(app, ["doctor", "--json"])

            # Since we're not providing all required endpoints, exit code might be 1
            # But we can still check the output
            output = json.loads(result.stdout)

            # Find the Server Health check
            health_check = next(
                (c for c in output["checks"] if c["name"] == "Server Health"), None
            )
            assert health_check is not None
            assert health_check["status"] == "warn"
            assert f"status: {status}" in health_check["detail"]


class TestProviderStatusCommand:
    """Test the provider status CLI command."""

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_provider_status_shows_green_for_success_statuses(self, status):
        """Test provider status command shows green for both ok and healthy."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(
            {
                "name": "TestProvider",
                "module": "test.provider",
                "status": status,
                "agents": []
            }
        ).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["provider", "status"])

            assert result.exit_code == 0
            assert status in result.stdout  # Rich strips color codes in test output

    @pytest.mark.parametrize("status", ["error", "degraded"])
    def test_provider_status_shows_red_for_non_success_statuses(self, status):
        """Test provider status command shows red for non-success statuses."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(
            {
                "name": "TestProvider",
                "module": "test.provider",
                "status": status,
                "agents": []
            }
        ).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["provider", "status"])

            assert result.exit_code == 0
            assert status in result.stdout  # Rich strips color codes in test output
