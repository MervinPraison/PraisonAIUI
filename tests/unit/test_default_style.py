"""The React app shell is the default style (owner decision, 2026-11-22).

The legacy ``dashboard`` stays one switch away: ``--style dashboard``,
``set_style("dashboard")``, YAML ``style: dashboard`` or ``AIUI_SHELL=legacy``.
"""

import textwrap
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui.cli import app

runner = CliRunner()


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    monkeypatch.delenv("AIUI_LAYOUT", raising=False)
    srv.reset_state()
    yield
    srv.reset_state()


def _style_of(client: TestClient) -> str:
    return client.get("/api/shell/manifest").json()["style"]


def test_create_app_defaults_to_the_app_shell():
    client = TestClient(srv.create_app())
    assert _style_of(client) == "app"
    html = client.get("/").text
    assert 'data-aiui-shell="react"' in html and 'id="aiui-boot"' in html


@pytest.mark.parametrize(
    "how",
    ["set_style", "config", "env"],
)
def test_the_legacy_dashboard_is_still_one_switch_away(how, monkeypatch):
    if how == "set_style":
        srv.set_style("dashboard")
        app_ = srv.create_app()
    elif how == "config":
        app_ = srv.create_app(config={"style": "dashboard"})
    else:
        monkeypatch.setenv("AIUI_SHELL", "legacy")
        app_ = srv.create_app()
    html = TestClient(app_).get("/").text
    assert 'data-aiui-shell="react"' not in html and 'id="aiui-boot"' not in html


def test_an_app_with_pages_is_detected_as_the_app_shell():
    srv.register_page("own", title="Own", handler=lambda: {"_components": []})
    assert srv.detect_style() == "app"


def _run(tmp_path, *extra):
    app_file = tmp_path / "pages_app.py"
    app_file.write_text(
        textwrap.dedent(
            """
            import praisonaiui as aiui

            @aiui.page("own", title="Own")
            async def own():
                return {"_components": []}

            @aiui.reply
            async def on_message(message: str):
                await aiui.say(message)
            """
        ),
        encoding="utf-8",
    )
    with patch("uvicorn.run"):
        result = runner.invoke(app, ["run", str(app_file), "--port", "8133", *extra])
    assert result.exit_code == 0, result.output
    return result.output


def test_aiui_run_of_an_app_with_pages_opens_the_app_shell(tmp_path):
    out = _run(tmp_path)
    assert srv._effective_style == "app"
    assert "legacy UI" not in out


def test_aiui_run_style_dashboard_prints_the_legacy_notice(tmp_path):
    out = _run(tmp_path, "--style", "dashboard")
    assert srv._effective_style == "dashboard"
    assert srv.LEGACY_DASHBOARD_NOTICE in " ".join(out.split())
