"""Unit tests for surface CLI commands (mocked API)."""

import json
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()
SERVER = "http://127.0.0.1:8099"


@patch("praisonaiui.cli._api_get")
def test_surface_list_empty(mock_get):
    mock_get.return_value = {"surfaces": []}
    result = runner.invoke(app, ["surface", "list", "--server", SERVER])
    assert result.exit_code == 0
    assert "No surfaces yet" in result.output


@patch("praisonaiui.cli._api_get")
def test_surface_list_with_data(mock_get):
    mock_get.return_value = {"surfaces": [{"id": "main", "message_count": 2}]}
    result = runner.invoke(app, ["surface", "list", "--server", SERVER])
    assert result.exit_code == 0
    assert "main" in result.output


@patch("praisonaiui.cli._api_get")
def test_surface_get_empty(mock_get):
    mock_get.return_value = {"id": "main", "messages": []}
    result = runner.invoke(app, ["surface", "get", "main", "--server", SERVER])
    assert result.exit_code == 0
    assert "Messages: 0" in result.output


@patch("praisonaiui.cli._api_post")
def test_surface_push(mock_post, tmp_path: Path):
    payload = {
        "messages": [
            {"updateComponents": {"components": [{"component": "Button", "text": {"literal": "Go"}}]}}
        ]
    }
    f = tmp_path / "ui.json"
    f.write_text(json.dumps(payload), encoding="utf-8")
    mock_post.return_value = {"id": "main", "message_count": 1}
    result = runner.invoke(
        app,
        ["surface", "push", "main", "--file", str(f), "--server", SERVER],
    )
    assert result.exit_code == 0
    mock_post.assert_called_once()
    assert "Pushed to main" in result.output


@patch("praisonaiui.cli._api_delete")
def test_surface_clear(mock_delete):
    mock_delete.return_value = {"status": "deleted", "id": "main"}
    result = runner.invoke(app, ["surface", "clear", "main", "--server", SERVER])
    assert result.exit_code == 0
    assert "Cleared surface" in result.output


@patch("praisonaiui.cli._api_get")
def test_surface_status(mock_get):
    mock_get.return_value = {"surfaces": [{"id": "main", "message_count": 3}]}
    result = runner.invoke(app, ["surface", "status", "--server", SERVER])
    assert result.exit_code == 0
    assert "Surfaces: 1" in result.output
    assert "Total messages: 3" in result.output
