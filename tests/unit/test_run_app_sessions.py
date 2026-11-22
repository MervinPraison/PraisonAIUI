"""``aiui run app.py`` keeps each app's chat history in its own folder.

The old default (the SDK store in ~/.praisonai/sessions) listed the chats of
every app and agent on the machine in every app's sidebar.
"""

import textwrap
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui.cli import app, app_sessions_dir

runner = CliRunner()


@pytest.fixture
def run_app(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("AIUI_NO_BROWSER", "1")
    srv.reset_state()

    def _run(*extra, name="app.py"):
        folder = tmp_path / name.replace(".py", "")
        folder.mkdir(exist_ok=True)
        app_file = folder / name
        app_file.write_text(
            textwrap.dedent(
                """
                import praisonaiui as aiui

                @aiui.reply
                async def on_message(message: str):
                    await aiui.say(message)
                """
            ),
            encoding="utf-8",
        )
        with patch("praisonaiui.cli._run_uvicorn"):
            result = runner.invoke(app, ["run", str(app_file), "--port", "8131", *extra])
        assert result.exit_code == 0, result.output
        return app_file, srv.get_datastore()

    yield _run
    srv.reset_state()


def _session_dir(store):
    return str(getattr(store, "_session_dir", None) or getattr(store, "_data_dir"))


def test_each_app_gets_its_own_sessions_folder(run_app, tmp_path):
    first, store = run_app()
    expected = app_sessions_dir(first)
    assert _session_dir(store) == str(expected)
    assert expected.is_relative_to(tmp_path / "data" / "apps")
    other, other_store = run_app(name="other.py")
    assert _session_dir(other_store) != _session_dir(store)


def test_the_folder_is_stable_per_app_file(tmp_path):
    f = tmp_path / "own_app.py"
    assert app_sessions_dir(f) == app_sessions_dir(f)
    assert app_sessions_dir(f).parent.name.startswith("own_app-")


def test_datastore_flag_keeps_the_shared_store(run_app, tmp_path):
    _, store = run_app("--datastore", f"json:{tmp_path / 'shared'}")
    assert _session_dir(store) == str(tmp_path / "shared")
