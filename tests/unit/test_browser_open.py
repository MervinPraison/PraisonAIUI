"""aiui opens a browser only for a person at a terminal (praisonaiui/browser.py).

Scripts, CI and coding agents start `aiui serve` / `aiui dev` too; each start
used to pop a browser window on the user's screen.
"""

import pytest

from praisonaiui import browser


@pytest.fixture
def opened(monkeypatch):
    calls = []
    monkeypatch.setattr("webbrowser.open", lambda url: calls.append(url) or True)
    for name in ("AIUI_NO_BROWSER", *browser._CI_VARS):
        monkeypatch.delenv(name, raising=False)
    return calls


def _tty(monkeypatch, value):
    monkeypatch.setattr("sys.stdout.isatty", lambda: value, raising=False)
    # pytest sets this while a test runs; clear it so only the test's own setting counts.
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)


def test_terminal_with_no_flag_opens(monkeypatch, opened):
    _tty(monkeypatch, True)
    assert browser.open_url("http://x/") is True
    assert opened == ["http://x/"]


def test_no_terminal_with_no_flag_does_not_open(monkeypatch, opened):
    _tty(monkeypatch, False)
    assert browser.open_url("http://x/") is False
    assert opened == []


@pytest.mark.parametrize("var", ["CI", "GITHUB_ACTIONS", "PYTEST_CURRENT_TEST"])
def test_ci_or_test_runner_does_not_open(monkeypatch, opened, var):
    _tty(monkeypatch, True)
    monkeypatch.setenv(var, "1")
    assert browser.open_url("http://x/") is False


def test_env_switch_wins_over_open_flag(monkeypatch, opened):
    _tty(monkeypatch, True)
    monkeypatch.setenv("AIUI_NO_BROWSER", "1")
    assert browser.open_url("http://x/", True) is False
    assert opened == []


def test_no_open_flag_wins(monkeypatch, opened):
    _tty(monkeypatch, True)
    assert browser.open_url("http://x/", False) is False


def test_open_flag_opens_without_terminal(monkeypatch, opened):
    _tty(monkeypatch, False)
    assert browser.open_url("http://x/", True) is True
    assert opened == ["http://x/"]


def test_serve_never_calls_webbrowser_directly():
    """Every browser open goes through browser.open_url, so the rule holds everywhere."""
    from pathlib import Path

    import praisonaiui

    pkg = Path(praisonaiui.__file__).parent
    for name in ("cli.py", "dev_server.py"):
        src = (pkg / name).read_text(encoding="utf-8")
        assert "webbrowser.open(" not in src, name
