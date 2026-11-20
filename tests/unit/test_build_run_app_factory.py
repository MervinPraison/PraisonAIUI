"""``aiui run`` should honour app.py ``create_app()`` factories (issue #574)."""

from pathlib import Path

from starlette.testclient import TestClient

from praisonaiui._run_factory import build_run_app
from praisonaiui.cli import _load_user_module


def test_build_run_app_registers_agents_from_user_factory(tmp_path: Path) -> None:
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
    response = client.get("/agents", headers={"Accept": "application/json"})
    assert response.status_code == 200
    payload = response.json()
    agent_ids = {row.get("agent_id") for row in payload.get("agents", [])}
    assert "assistant" in agent_ids