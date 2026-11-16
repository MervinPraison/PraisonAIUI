"""`aiui test sessions` checks the server's datastore, not a guessed disk path (#377)."""

from __future__ import annotations

import pytest
import typer

from praisonaiui import test_runner


def _patch(monkeypatch, stored, gets):
    monkeypatch.setattr(test_runner, "_check_server", lambda server: True)
    monkeypatch.setattr(test_runner, "_post", lambda server, path, body=None: {})
    monkeypatch.setattr(
        test_runner,
        "_wait_for_response",
        lambda server, sid: [{"role": "user"}, {"role": "assistant"}],
    )

    def fake_get(server, path):
        gets.append(path)
        if path.startswith("/sessions/"):
            if stored is None:
                raise OSError("HTTP Error 404: Not Found")
            return {"id": path.rsplit("/", 1)[1], "messages": stored}
        return {"messages": [{"role": "user"}, {"role": "assistant"}]}

    monkeypatch.setattr(test_runner, "_get", fake_get)


def test_passes_when_datastore_has_session_and_no_file(monkeypatch, tmp_path):
    # Nothing under HOME: the old check looked at ~/.praisonaiui/sessions/ and failed.
    monkeypatch.setenv("HOME", str(tmp_path))
    gets: list[str] = []
    _patch(monkeypatch, [{"role": "user", "content": "hi"}], gets)
    test_runner.test_sessions(server="http://x")  # no typer.Exit
    assert any(p.startswith("/sessions/test-persist-") for p in gets)


def test_fails_when_datastore_lacks_session(monkeypatch):
    # History API still answers (in-memory fallback), but the datastore does not.
    _patch(monkeypatch, None, [])
    with pytest.raises(typer.Exit):
        test_runner.test_sessions(server="http://x")
