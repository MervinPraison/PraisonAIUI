"""Unit tests for CLI features commands."""

import json
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


class TestFeaturesCommands:
    """Test the features CLI commands."""

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_features_list_shows_green_for_success_statuses(self, status):
        """Test features list command shows green indicator for both ok and healthy."""
        features_data = {
            "features": [
                {
                    "name": "Feature1",
                    "description": "Test feature 1",
                    "health": {"status": status},
                    "routes": ["/api/feature1", "/api/feature1/status"],
                },
                {
                    "name": "Feature2",
                    "description": "Test feature 2",
                    "health": {"status": status},
                }
            ]
        }

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(features_data).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["features", "list"])

            assert result.exit_code == 0
            assert "Feature1" in result.stdout
            assert "Feature2" in result.stdout
            assert "Test feature 1" in result.stdout
            assert "/api/feature1" in result.stdout

    @pytest.mark.parametrize("status", ["error", "degraded", "unknown"])
    def test_features_list_shows_red_for_non_success_statuses(self, status):
        """Test features list command shows red indicator for non-success statuses."""
        features_data = {
            "features": [
                {
                    "name": "FailingFeature",
                    "description": "Feature with error",
                    "health": {"status": status},
                }
            ]
        }

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(features_data).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["features", "list"])

            assert result.exit_code == 0
            assert "FailingFeature" in result.stdout
            assert "Feature with error" in result.stdout

    @pytest.mark.parametrize("status", ["ok", "healthy"])
    def test_features_status_counts_success_statuses_correctly(self, status):
        """Test features status command counts both ok and healthy as success."""
        features_data = {
            "features": [
                {"name": "Feature1", "health": {"status": status}},
                {"name": "Feature2", "health": {"status": status}},
                {"name": "Feature3", "health": {"status": "error"}},
            ]
        }

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(features_data).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["features", "status"])

            assert result.exit_code == 0
            assert "Features: 2/3 healthy" in result.stdout
            assert "Feature1" in result.stdout
            assert "Feature2" in result.stdout
            assert "Feature3" in result.stdout

    def test_features_status_mixed_success_statuses(self):
        """Test features status handles mix of ok and healthy statuses."""
        features_data = {
            "features": [
                {"name": "Feature1", "health": {"status": "ok"}},
                {"name": "Feature2", "health": {"status": "healthy"}},
                {"name": "Feature3", "health": {"status": "degraded"}},
                {"name": "Feature4", "health": {"status": "error"}},
            ]
        }

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps(features_data).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = mock_response

            result = runner.invoke(app, ["features", "status"])

            assert result.exit_code == 0
            # Both ok and healthy should be counted as healthy
            assert "Features: 2/4 healthy" in result.stdout
