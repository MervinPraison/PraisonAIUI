"""What ``create_app`` imports: optional deps and disabled built-ins stay out.

R10: nothing outside ``[project].dependencies`` is imported at module top in a
module ``create_app`` loads (SQLAlchemy is the ``sql`` extra).
R2/R4: a disabled record's feature modules are not imported, by startup or by
a config hot reload.

Each check runs in a fresh interpreter, because other tests import these
modules into this one.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import praisonaiui.config_store as config_store
import praisonaiui.server as srv

SRC = str(Path(__file__).resolve().parents[2] / "src")


def _run(tmp_path: Path, body: str) -> dict:
    """Run *body* in a fresh interpreter; it must print one JSON line last."""
    code = "import json, sys\nimport praisonaiui.server as srv\n" + body
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
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(
    importlib.util.find_spec("sqlalchemy") is None, reason="needs the sql extra installed"
)
def test_create_app_does_not_import_sqlalchemy(tmp_path):
    result = _run(
        tmp_path,
        "srv.create_app()\n"
        "print(json.dumps({'loaded': [m for m in ('sqlalchemy', 'greenlet') if m in sys.modules]}))\n",
    )
    assert result["loaded"] == []


def test_disabled_builtins_import_none_of_their_feature_modules(tmp_path):
    """Every record off: only the required features' modules may load."""
    result = _run(
        tmp_path,
        "from praisonaiui.builtin import BUILTIN_PLUGINS\n"
        "from praisonaiui.plugin_registry import set_extensions\n"
        "set_extensions(disabled=[f'builtin.{p.name}' for p in BUILTIN_PLUGINS])\n"
        "srv.create_app()\n"
        "refs = [r for p in BUILTIN_PLUGINS for r in p.feature_refs]\n"
        "req = {r.module for r in refs if r.required}\n"
        "off = {'praisonaiui.features' + r.module for r in refs if r.module not in req}\n"
        "print(json.dumps({'leaked': sorted(off & set(sys.modules))}))\n",
    )
    assert result["leaked"] == []


def test_video_on_and_jobs_off_does_not_import_jobs(tmp_path):
    """builtin.video used to import features.jobs at module top."""
    result = _run(
        tmp_path,
        "from praisonaiui.plugin_registry import set_extensions\n"
        "set_extensions(enabled=['builtin.video'], disabled=['builtin.jobs'])\n"
        "srv.create_app()\n"
        "print(json.dumps({'video': 'praisonaiui.features.video' in sys.modules,\n"
        "  'jobs': 'praisonaiui.features.jobs' in sys.modules}))\n",
    )
    assert result == {"video": True, "jobs": False}


def test_config_reload_leaves_disabled_builtins_unimported(tmp_path):
    result = _run(
        tmp_path,
        "from praisonaiui.plugin_registry import set_extensions\n"
        "from praisonaiui.features.config_hot_reload import get_config_watcher\n"
        "set_extensions(disabled=['builtin.skills', 'builtin.channels', 'builtin.agents'])\n"
        "srv.create_app()\n"
        "for cb in get_config_watcher()._callbacks:\n"
        "    cb()\n"
        "mods = ('agents', 'channels', 'skills')\n"
        "print(json.dumps({'callbacks': len(get_config_watcher()._callbacks),\n"
        "  'loaded': [m for m in mods if 'praisonaiui.features.' + m in sys.modules]}))\n",
    )
    assert result == {"callbacks": 1, "loaded": []}


def test_disabled_config_builtin_installs_no_watcher(tmp_path):
    result = _run(
        tmp_path,
        "from praisonaiui.plugin_registry import set_extensions\n"
        "set_extensions(disabled=['builtin.config'])\n"
        "srv.create_app()\n"
        "print(json.dumps({'hot_reload': 'praisonaiui.features.config_hot_reload' in sys.modules}))\n",
    )
    assert result == {"hot_reload": False}


# ── in-process: each feature resets its own cache ───────────────────


@pytest.fixture
def _app(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    srv.create_app()
    yield data
    srv.reset_state()


def test_watcher_watches_the_config_store_and_reloads_features(_app):
    from praisonaiui.features.config_hot_reload import (
        get_config_watcher,
        reload_config_and_features,
    )

    watcher = get_config_watcher()
    assert watcher._config_path == config_store.get_config_store().path
    assert watcher._callbacks == [reload_config_and_features]


def test_each_feature_drops_its_own_config_cache(_app):
    from praisonaiui.features import agents, channels, skills
    from praisonaiui.features.config_hot_reload import reload_config_and_features

    reg = agents.get_agent_registry()
    reg.list_all()
    skills._ensure_skills_loaded()
    channels.ChannelsFeature._auto_started = True
    channels._channels["stale"] = {"platform": "x"}

    reload_config_and_features()

    simple = getattr(reg, "_simple", reg)
    assert simple._config_loaded is False
    assert skills._skills_loaded is False
    assert channels.ChannelsFeature._auto_started is False
    assert "stale" not in channels._channels


def test_video_job_states_match_the_jobs_enum():
    from praisonaiui.features import video
    from praisonaiui.features.jobs import JobStatus

    assert (video._QUEUED, video._RUNNING, video._SUCCEEDED, video._FAILED) == (
        JobStatus.QUEUED.value,
        JobStatus.RUNNING.value,
        JobStatus.SUCCEEDED.value,
        JobStatus.FAILED.value,
    )
