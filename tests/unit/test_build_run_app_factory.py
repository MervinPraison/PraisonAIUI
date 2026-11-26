"""``aiui run`` should honour app.py ``create_app()`` factories (issue #574)."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from praisonaiui._run_factory import build_run_app
from praisonaiui.cli import _load_user_module


@pytest.fixture(autouse=True)
def _cleanup_registered_agents():
    """Keep global agent registry isolated across tests."""
    from praisonaiui import server as _server

    before = dict(_server._agents)
    yield
    _server._agents.clear()
    _server._agents.update(before)


def test_build_run_app_registers_agents_and_serves_ui(tmp_path: Path) -> None:
    app_py = tmp_path / "app.py"
    app_py.write_text(
        """
import praisonaiui as aiui

def create_app():
    aiui.register_agent("assistant", object())
    from praisonaiui.server import create_app as _create_app
    return _create_app()
""",
        encoding="utf-8",
    )

    user_module = _load_user_module(app_py)
    assert user_module is not None

    client = TestClient(build_run_app(user_module, static_dir=None, config_path=None))

    agents_res = client.get("/agents", headers={"Accept": "application/json"})
    assert agents_res.status_code == 200
    agent_ids = {row.get("agent_id") for row in agents_res.json().get("agents", [])}
    assert "assistant" in agent_ids

    home_res = client.get("/")
    assert home_res.status_code == 200
    assert "text/html" in home_res.headers.get("content-type", "")


def test_build_run_app_preserves_config_path_with_zero_arg_factory(tmp_path: Path) -> None:
    app_py = tmp_path / "app.py"
    app_py.write_text(
        """
import praisonaiui as aiui

def create_app():
    aiui.register_agent("assistant", object())
    from praisonaiui.server import create_app as _create_app
    return _create_app()
""",
        encoding="utf-8",
    )
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text(
        "auth:\n  requireAuth: true\n",
        encoding="utf-8",
    )

    user_module = _load_user_module(app_py)
    assert user_module is not None

    app = build_run_app(user_module, static_dir=None, config_path=cfg)
    client = TestClient(app)

    # Zero-arg factory still registered its agent, AND --config auth.requireAuth was NOT dropped
    unauth = client.get("/agents", headers={"Accept": "application/json"})
    assert unauth.status_code == 401


def test_build_run_app_ignores_imported_server_create_app(tmp_path: Path) -> None:
    app_py = tmp_path / "app.py"
    app_py.write_text(
        """
from praisonaiui.server import create_app
""",
        encoding="utf-8",
    )
    cfg = tmp_path / "aiui.yaml"
    cfg.write_text("auth:\n  requireAuth: true\n", encoding="utf-8")

    user_module = _load_user_module(app_py)
    assert user_module is not None

    app = build_run_app(user_module, static_dir=None, config_path=cfg)
    client = TestClient(app)
    assert client.get("/agents", headers={"Accept": "application/json"}).status_code == 401
