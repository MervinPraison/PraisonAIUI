"""Unit tests for `aiui run` propagating --port/--host to gateway main()."""

import os
import textwrap
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from praisonaiui.cli import app

runner = CliRunner()


def _write_gateway_app(tmp_path):
    app_file = tmp_path / "app.py"
    app_file.write_text(
        textwrap.dedent(
            """
            from praisonaiui.integration import AIUIGateway


            async def main():
                pass
            """
        ),
        encoding="utf-8",
    )
    return app_file


def _invoke(tmp_path):
    app_file = _write_gateway_app(tmp_path)
    captured = {}

    def fake_run(coro):
        coro.close()
        captured["PORT"] = os.environ.get("PORT")
        captured["HOST"] = os.environ.get("HOST")

    with patch("socket.socket") as mock_socket:
        mock_socket.return_value.__enter__.return_value.bind.return_value = None
        with patch(
            "praisonaiui.integration.AIUIGateway", return_value=MagicMock()
        ), patch(
            "praisonaiui.integration.check_praisonai_available", return_value=True
        ), patch("asyncio.run", side_effect=fake_run):
            result = runner.invoke(
                app,
                ["run", str(app_file), "--backend", "praisonai", "--port", "8101"],
            )
    return result, captured


def test_run_sets_port_env_before_gateway_main(tmp_path, monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.delenv("HOST", raising=False)

    result, captured = _invoke(tmp_path)

    assert result.exit_code == 0, result.stdout
    assert captured["PORT"] == "8101"
    assert captured["HOST"] == "127.0.0.1"


def test_explicit_port_env_overrides_cli_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("PORT", "9000")
    monkeypatch.delenv("HOST", raising=False)

    result, captured = _invoke(tmp_path)

    assert result.exit_code == 0, result.stdout
    assert captured["PORT"] == "9000"
    assert os.environ["PORT"] == "9000"
