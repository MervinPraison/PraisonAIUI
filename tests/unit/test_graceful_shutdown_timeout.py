"""`aiui run` bounds graceful shutdown, so an open browser tab cannot keep a
stopped server alive (uvicorn otherwise waits at "Waiting for connections to
close" forever)."""

from __future__ import annotations

import uvicorn
from typer.testing import CliRunner

from praisonaiui import cli


def test_run_passes_a_graceful_shutdown_timeout(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    app_file = tmp_path / "app.py"
    app_file.write_text("import praisonaiui as aiui\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append(k))

    result = CliRunner().invoke(cli.app, ["run", str(app_file), "--port", "8765"])

    assert result.exit_code == 0, result.output
    assert calls and calls[0].get("timeout_graceful_shutdown") == getattr(
        cli, "GRACEFUL_SHUTDOWN_SECONDS", None
    )
    assert 0 < cli.GRACEFUL_SHUTDOWN_SECONDS <= 10
