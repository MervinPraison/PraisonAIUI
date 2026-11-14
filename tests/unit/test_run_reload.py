"""``aiui run --reload`` must hand uvicorn an import string, not an app.

uvicorn exits with "You must pass the application as an import string to
enable 'reload'" when given an app object, so --reload never worked.
"""

from __future__ import annotations

import json

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui import _run_factory
from praisonaiui.cli import app as cli_app

APP = """
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say("hi")
"""


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    # setenv first so teardown also removes the value the CLI writes.
    monkeypatch.setenv(_run_factory.SPEC_ENV, "")
    monkeypatch.delenv(_run_factory.SPEC_ENV)
    srv.reset_state()
    yield
    srv.reset_state()


def test_reload_passes_the_factory_import_string(tmp_path, monkeypatch):
    app_file = tmp_path / "app.py"
    app_file.write_text(APP)
    calls = []

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda target, **kw: calls.append((target, kw)))
    result = CliRunner().invoke(
        cli_app,
        ["run", str(app_file), "--reload", "--datastore", "memory", "--port", "8203"],
    )
    assert result.exit_code == 0, result.output
    target, kw = calls[-1]
    assert target == "praisonaiui._run_factory:create"
    assert kw["factory"] is True and kw["reload"] is True
    assert kw["reload_dirs"] == [str(app_file.resolve().parent)]
    import os

    spec = json.loads(os.environ[_run_factory.SPEC_ENV])
    assert spec["app_file"] == str(app_file.resolve())
    assert spec["datastore"] == "memory"
    assert spec["style"] == "chat"


def test_without_reload_the_app_object_is_passed(tmp_path, monkeypatch):
    app_file = tmp_path / "app.py"
    app_file.write_text(APP)
    calls = []

    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda target, **kw: calls.append((target, kw)))
    result = CliRunner().invoke(
        cli_app, ["run", str(app_file), "--datastore", "memory", "--port", "8203"]
    )
    assert result.exit_code == 0, result.output
    target, kw = calls[-1]
    assert not isinstance(target, str)
    assert "reload" not in kw


def test_factory_rebuilds_the_app(tmp_path, monkeypatch):
    app_file = tmp_path / "app.py"
    app_file.write_text(APP)
    monkeypatch.setenv(
        _run_factory.SPEC_ENV,
        _run_factory.encode_spec(
            app_file=app_file,
            is_yaml=False,
            style="chat",
            datastore="memory",
            static_dir=None,
            config_path=None,
        ),
    )
    app = _run_factory.create()
    assert "reply" in srv._callbacks or "on:reply" in srv._callbacks
    assert srv.get_style() == "chat"
    cfg = TestClient(app).get("/ui-config.json").json()
    assert cfg["style"] == "chat"


def test_factory_without_spec_explains_itself():
    with pytest.raises(RuntimeError, match="aiui run --reload"):
        _run_factory.create()
