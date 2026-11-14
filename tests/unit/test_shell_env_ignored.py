"""AIUI_SHELL=app only switches 'dashboard'; say so when it is ignored."""

from __future__ import annotations

import logging

import pytest
from typer.testing import CliRunner

import praisonaiui.plugin_registry as pr
import praisonaiui.server as srv
from praisonaiui.cli import app as cli_app

APP = """
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say("hi")
"""


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(pr, "_shell_ignored_warned", set())
    srv.reset_state()
    yield
    srv.reset_state()


def test_ignored_shell_env_is_logged_once(monkeypatch, caplog):
    monkeypatch.setenv("AIUI_SHELL", "app")
    with caplog.at_level(logging.WARNING, logger="praisonaiui.plugin_registry"):
        assert pr.resolve_shell_style("chat") == "chat"
        assert pr.resolve_shell_style("chat") == "chat"
    hits = [r for r in caplog.records if "AIUI_SHELL=app ignored" in r.getMessage()]
    assert len(hits) == 1
    assert "'chat'" in hits[0].getMessage() and "--style app" in hits[0].getMessage()


@pytest.mark.parametrize("style,expected", [("dashboard", "app"), ("app", "app")])
def test_switched_styles_do_not_warn(monkeypatch, caplog, style, expected):
    monkeypatch.setenv("AIUI_SHELL", "react")
    with caplog.at_level(logging.WARNING, logger="praisonaiui.plugin_registry"):
        assert pr.resolve_shell_style(style) == expected
    assert not [r for r in caplog.records if "ignored" in r.getMessage()]


def test_no_env_no_warning(monkeypatch, caplog):
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    with caplog.at_level(logging.WARNING, logger="praisonaiui.plugin_registry"):
        assert pr.resolve_shell_style("chat") == "chat"
    assert not caplog.records


def test_aiui_run_banner_explains_the_ignored_env(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_SHELL", "app")
    app_file = tmp_path / "app.py"
    app_file.write_text(APP)
    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)
    result = CliRunner().invoke(
        cli_app, ["run", str(app_file), "--datastore", "memory", "--port", "8207"]
    )
    assert result.exit_code == 0, result.output
    assert "AIUI_SHELL=app is ignored" in result.output
    assert "--style app" in result.output
