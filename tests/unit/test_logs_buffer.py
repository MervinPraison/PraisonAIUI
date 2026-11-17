"""One log buffer: GET /api/logs, /stats, /clear and /stream read the same one.

GET /api/logs used to read ``server._log_buffer`` (filled by a server-side
handler) while /api/logs/clear, /stats and /stream used the buffer in
``features/logs.py``, so the Logs page's Clear came back on the next poll.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui.config_store as config_store
import praisonaiui.server as srv

SRC = str(Path(__file__).resolve().parents[2] / "src")


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


def _probe_entries(client: TestClient, marker: str) -> list[dict]:
    body = client.get("/api/logs?limit=500").json()
    return [e for e in body["logs"] if marker in e.get("message", "")]


def test_clear_empties_what_get_api_logs_returns():
    client = TestClient(srv.create_app())
    logging.getLogger("aiui.test.logs").warning("hello-probe-clear")
    assert len(_probe_entries(client, "hello-probe-clear")) == 1
    assert client.get("/api/logs/stats").json()["total"] >= 1

    assert client.post("/api/logs/clear").json() == {"cleared": True, "buffer_size": 0}

    # Other loggers (the HTTP client, the server) may write between requests,
    # so only the probe is counted.
    assert _probe_entries(client, "hello-probe-clear") == []
    from praisonaiui.features.logs import get_log_buffer

    assert not any("hello-probe-clear" in e["message"] for e in get_log_buffer())


def test_each_record_is_captured_once():
    TestClient(srv.create_app())
    names = [type(h).__name__ for h in logging.getLogger().handlers]
    assert "LogBufferHandler" not in names
    assert names.count("WebSocketLogHandler") == 1
    from praisonaiui.features.logs import get_log_buffer

    get_log_buffer().clear()
    logging.getLogger("aiui.test.logs").warning("once-probe")
    assert sum("once-probe" in e["message"] for e in get_log_buffer()) == 1


def test_level_and_limit_filters_still_work():
    client = TestClient(srv.create_app())
    client.post("/api/logs/clear")
    log = logging.getLogger("aiui.test.logs")
    log.warning("w1")
    log.error("e1")
    log.error("e2")
    errors = client.get("/api/logs?level=error&limit=500").json()["logs"]
    ours = [e["message"] for e in errors if e["logger"] == "aiui.test.logs"]
    assert ours == ["aiui.test.logs - e1", "aiui.test.logs - e2"]
    assert all(e["level"] == "ERROR" for e in errors)
    last = client.get("/api/logs?level=error&limit=1").json()["logs"]
    assert len(last) == 1 and last[0]["level"] == "ERROR"
    # A bad limit falls back to the default instead of a 500.
    assert client.get("/api/logs?limit=abc").status_code == 200


def test_server_api_logs_reads_the_feature_buffer():
    from starlette.applications import Starlette
    from starlette.routing import Route

    TestClient(srv.create_app())
    from praisonaiui.features.logs import get_log_buffer

    get_log_buffer().clear()
    logging.getLogger("aiui.test.logs").warning("shim-probe")
    shim = TestClient(Starlette(routes=[Route("/x", srv.api_logs)]))
    assert any("shim-probe" in e["message"] for e in shim.get("/x").json()["logs"])


def test_disabled_logs_installs_no_handler_and_imports_nothing(tmp_path):
    """R2/R4: with builtin.logs off, create_app neither imports nor installs it."""
    code = (
        "import json, logging, sys\n"
        "import praisonaiui.server as srv\n"
        "from praisonaiui.plugin_registry import set_extensions\n"
        "set_extensions(disabled=['builtin.logs'])\n"
        "srv.create_app()\n"
        "print(json.dumps({\n"
        "  'imported': 'praisonaiui.features.logs' in sys.modules,\n"
        "  'handlers': [type(h).__name__ for h in logging.getLogger().handlers],\n"
        "}))\n"
    )
    env = {
        **os.environ,
        "PYTHONPATH": SRC,
        "AIUI_DATA_DIR": str(tmp_path),
        "AIUI_DISABLE_PLUGIN_AUTOLOAD": "1",
    }
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=120
    )
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout.strip().splitlines()[-1])
    assert result["imported"] is False
    assert "WebSocketLogHandler" not in result["handlers"]
    assert "LogBufferHandler" not in result["handlers"]
