"""Unit tests for `_load_env_files` — auto-loading PraisonAI `.env` files.

Regression coverage for issue #286: `env:VAR` channel token references
resolved to empty strings because `aiui run` never loaded the standard
`~/.praisonai/.env` file, so bots showed "Connected" but never replied.
"""

import os

from praisonaiui.cli import _load_env_files


def _write_env(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_loads_home_praisonai_env(tmp_path, monkeypatch):
    """Variables in ~/.praisonai/.env are loaded into the process env."""
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    _write_env(tmp_path / ".praisonai" / ".env", 'TELEGRAM_BOT_TOKEN="123:AAtoken"\n')

    loaded = _load_env_files()

    assert loaded >= 1
    assert os.environ["TELEGRAM_BOT_TOKEN"] == "123:AAtoken"


def test_does_not_override_existing_env(tmp_path, monkeypatch):
    """An already-set process variable is never clobbered by the file."""
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-from-shell")

    _write_env(tmp_path / ".praisonai" / ".env", "SLACK_BOT_TOKEN=xoxb-from-file\n")

    _load_env_files()

    assert os.environ["SLACK_BOT_TOKEN"] == "xoxb-from-shell"


def test_ignores_comments_blanks_and_export_prefix(tmp_path, monkeypatch):
    """Comments/blank lines are skipped and `export ` prefixes are stripped."""
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("FOO", raising=False)
    monkeypatch.delenv("BAR", raising=False)

    _write_env(
        tmp_path / ".praisonai" / ".env",
        "# a comment\n\nexport FOO=foo\nBAR='bar'\n",
    )

    _load_env_files()

    assert os.environ["FOO"] == "foo"
    assert os.environ["BAR"] == "bar"


def test_missing_files_are_harmless(tmp_path, monkeypatch):
    """No env files present → returns 0 and does not raise."""
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)

    assert _load_env_files() == 0
