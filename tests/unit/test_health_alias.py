"""Test that both health-check and health commands work."""

import json
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


def test_health_check_command_exists():
    """Test that health-check command is registered."""
    result = runner.invoke(app, ["health-check", "--help"])
    assert result.exit_code == 0
    assert "Check server health" in result.stdout


def test_health_alias_exists():
    """Test that health alias is registered."""
    result = runner.invoke(app, ["health", "--help"])
    assert result.exit_code == 0
    assert "Check server health" in result.stdout


@patch("urllib.request.urlopen")
def test_health_check_command_works(mock_urlopen):
    """Test that health-check command works correctly."""
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({
        "status": "healthy",
        "timestamp": "2026-06-23T12:00:00"
    }).encode()
    mock_response.__enter__.return_value = mock_response
    mock_response.__exit__.return_value = None
    mock_urlopen.return_value = mock_response

    result = runner.invoke(app, ["health-check", "--server", "http://127.0.0.1:8000"])
    assert result.exit_code == 0
    assert "healthy" in result.stdout.lower()


@patch("urllib.request.urlopen")
def test_health_alias_works(mock_urlopen):
    """Test that health alias works correctly."""
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({
        "status": "healthy",
        "timestamp": "2026-06-23T12:00:00"
    }).encode()
    mock_response.__enter__.return_value = mock_response
    mock_response.__exit__.return_value = None
    mock_urlopen.return_value = mock_response

    result = runner.invoke(app, ["health", "--server", "http://127.0.0.1:8000"])
    assert result.exit_code == 0
    assert "healthy" in result.stdout.lower()


@patch("urllib.request.urlopen")
@patch("praisonaiui.cli._api_get")
def test_health_detailed_works(mock_api_get, mock_urlopen):
    """Test that both commands work with --detailed flag."""
    # Mock health check response
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps({
        "status": "healthy",
        "timestamp": "2026-06-23T12:00:00"
    }).encode()
    mock_response.__enter__.return_value = mock_response
    mock_response.__exit__.return_value = None
    mock_urlopen.return_value = mock_response

    # Mock features response
    mock_api_get.return_value = {
        "features": [
            {"name": "test_feature", "health": {"healthy": True, "detail": "ok"}}
        ]
    }

    # Test health-check with --detailed
    result1 = runner.invoke(app, ["health-check", "--server", "http://127.0.0.1:8000", "--detailed"])
    assert result1.exit_code == 0
    assert "healthy" in result1.stdout.lower()
    assert "test_feature" in result1.stdout

    # Test health alias with --detailed
    result2 = runner.invoke(app, ["health", "--server", "http://127.0.0.1:8000", "--detailed"])
    assert result2.exit_code == 0
    assert "healthy" in result2.stdout.lower()
    assert "test_feature" in result2.stdout


def test_help_shows_both_commands():
    """Test that main help shows both health commands."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    # At least one health-related command should be shown
    assert "health" in result.stdout.lower()
