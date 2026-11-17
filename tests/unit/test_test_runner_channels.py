"""``aiui test features`` creates channels with an env ref, never an inline token (#425)."""

import pytest
import typer

from praisonaiui import test_runner as tr
from praisonaiui.features.channels import _validate_config_security


def test_channel_create_uses_env_ref(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    monkeypatch.setattr(tr, "_check_server", lambda s: True)
    monkeypatch.setattr(tr.time, "sleep", lambda s: None)
    monkeypatch.setattr(tr, "_get", lambda s, p: {})
    monkeypatch.setattr(tr, "_delete", lambda s, p: {})
    monkeypatch.setattr(tr, "_wait_for_response", lambda *a, **k: [])
    bodies = []

    def fake_post(server, path, body=None):
        if path == "/api/channels":
            bodies.append(body)
        return {}

    monkeypatch.setattr(tr, "_post", fake_post)
    with pytest.raises(typer.Exit):  # other checks fail against the empty fakes
        tr.test_features("http://x")

    assert len(bodies) == 1
    config = bodies[0]["config"]
    assert config == {"bot_token": "env:TELEGRAM_BOT_TOKEN"}
    assert _validate_config_security(config) is None
