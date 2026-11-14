"""Feature health checks stay cheap: no SDK start, no network, no heavy imports.

``/api/features`` (called by the Overview page) and ``/api/health`` call every
feature's ``health()`` on the event loop. Knowledge's health started the SDK
(chromadb plus a live embedding call), memory's opened its stores, jobs
imported FastAPI, realtime imported openai and video called its engine over
HTTP. On a fresh server that held the loop for 3 to 20 s, so the Overview and
Logs pages showed skeletons until it finished.

The check runs in a fresh interpreter: in this process earlier tests have
already imported the heavy modules and started the singletons.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src"

#: Imported only when a page that needs them is used, never by a health check.
HEAVY_MODULES = (
    "chromadb",
    "litellm",
    "openai",
    "fastapi",
    "praisonaiagents.knowledge",
    "praisonai.jobs.server",
)

#: Generous: these took 3-20 s before the fix and take ~0.2 s after it.
MAX_SECONDS = 2.0

_PROBE = textwrap.dedent(
    """
    import json, socket, sys, time

    from starlette.testclient import TestClient

    from praisonaiui import server as srv

    app = srv.create_app()
    client = TestClient(app)
    client.get("/api/pages")  # run startup outside the measured window

    attempts = []
    _connect = socket.socket.connect

    def _no_network(self, address, *a, **k):
        if self.family in (socket.AF_INET, socket.AF_INET6):
            attempts.append(repr(address))
            raise OSError("network blocked by test")
        return _connect(self, address, *a, **k)

    def _no_dns(*a, **k):
        attempts.append("getaddrinfo%r" % (a[:2],))
        raise OSError("network blocked by test")

    socket.socket.connect = _no_network
    socket.create_connection = lambda address, *a, **k: _no_network(
        socket.socket(), address
    )
    socket.getaddrinfo = _no_dns

    heavy = json.loads(sys.argv[1])
    before = {m for m in heavy if m in sys.modules}
    timings, status = {}, {}
    for path in ("/api/features", "/api/health"):
        t = time.perf_counter()
        r = client.get(path)
        timings[path] = time.perf_counter() - t
        status[path] = r.status_code
    feats = client.get("/api/features").json()
    names = [f["name"] for f in feats.get("features", feats if isinstance(feats, list) else [])]
    print(json.dumps({
        "imported": sorted(m for m in heavy if m in sys.modules and m not in before),
        "network": attempts,
        "timings": timings,
        "status": status,
        "features": names,
    }))
    """
)


def _run_probe(tmp_path: Path) -> dict:
    env = dict(os.environ)
    env.update(
        AIUI_DATA_DIR=str(tmp_path / "data"),
        PRAISONAI_HOME=str(tmp_path / "home"),
        PYTHONPATH=os.pathsep.join([str(SRC), env.get("PYTHONPATH", "")]),
        AIUI_DISABLE_PLUGIN_AUTOLOAD="1",
        # A real key must not turn a health check into a paid API call.
        OPENAI_API_KEY="sk-test-not-a-real-key",
    )
    env.pop("AIUI_SHELL", None)
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE, json.dumps(HEAVY_MODULES)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-4000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_feature_health_is_cheap_on_a_fresh_server(tmp_path):
    result = _run_probe(tmp_path)

    assert result["status"] == {"/api/features": 200, "/api/health": 200}
    # The checks below only mean something if the slow features were there.
    assert {"knowledge", "memory", "jobs"} <= set(result["features"])
    assert result["network"] == [], "a health check reached the network"
    assert result["imported"] == [], "a health check imported a heavy module"
    for path, seconds in result["timings"].items():
        assert seconds < MAX_SECONDS, f"{path} took {seconds:.2f}s"


# ── per-feature: health() reports state, it does not create it ──────


def _boom(*a, **k):
    raise AssertionError("health() must not start this backend")


def test_knowledge_health_does_not_start_the_sdk(monkeypatch):
    from praisonaiui.features.knowledge import SDKKnowledgeManager

    mgr = SDKKnowledgeManager()
    monkeypatch.setattr(mgr, "_get_sdk_knowledge", _boom)
    h = mgr.health()
    assert h["sdk_initialized"] is False
    assert h["status"] in ("ok", "degraded")


def test_memory_health_does_not_start_the_sdk(monkeypatch):
    from praisonaiui.features.memory import SDKMemoryManager

    mgr = SDKMemoryManager()
    monkeypatch.setattr(mgr, "_get_sdk_memory", _boom)
    h = mgr.health()
    assert h["sdk_initialized"] is False
    mgr._sdk_error = "boom"
    assert mgr.health()["status"] == "degraded"  # a failed start still shows


def test_jobs_health_does_not_create_the_store(monkeypatch):
    import asyncio

    from praisonaiui.features import jobs

    monkeypatch.setattr(jobs, "_job_store", None)
    monkeypatch.setattr(jobs, "get_job_store", _boom)
    h = asyncio.run(jobs.JobsFeature().health())
    assert h["status"] == "ok"
    assert jobs._job_store is None


def test_video_feature_health_does_not_call_the_engine(monkeypatch):
    import asyncio

    from praisonaiui.features import video

    monkeypatch.setattr(video, "health", _boom)
    assert asyncio.run(video.VideoFeature().health())["status"] == "ok"
