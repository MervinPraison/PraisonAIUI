"""create_replay_app(): the Replay view mounted inside another app, with an optional Run box."""

from __future__ import annotations

import json
import shutil
import threading
import time
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "replay"


@pytest.fixture()
def traces(tmp_path, monkeypatch):
    d = tmp_path / "traces"
    d.mkdir()
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(d))
    monkeypatch.delenv("PRAISON_HOME", raising=False)
    return d


def _host(sub) -> TestClient:
    """A host app with the replay app mounted at /replay, like app.mount() in FastAPI."""
    return TestClient(Starlette(routes=[Mount("/replay", app=sub)]))


def _cfg(page: str) -> dict:
    line = next(l for l in page.splitlines() if l.startswith("render("))
    return json.loads(line[line.index(",") + 1 : line.rindex(")")].strip())


def test_page_mounts_the_view_relative_to_the_mount(traces):
    from praisonaiui.features.replay import create_replay_app

    c = _host(create_replay_app())
    r = c.get("/replay/")
    assert r.status_code == 200
    assert 'from "/replay/replay.js"' in r.text
    cfg = _cfg(r.text)
    assert cfg == {"base": "/replay", "approve": False}  # no run list pin, no Run box
    assert "aiui" not in r.text.lower()  # no dashboard around it
    for name in ("replay.js", "replay-core.js"):
        js = c.get(f"/replay/{name}")
        assert js.status_code == 200 and js.headers["content-type"].startswith("text/javascript")


def test_page_pins_a_valid_run_and_ignores_a_bad_one(traces):
    from praisonaiui.features.replay import create_replay_app

    c = _host(create_replay_app())
    assert _cfg(c.get("/replay/?run=run-abc").text)["run"] == "run-abc"
    page = c.get("/replay/?run=../../etc/passwd").text
    assert "run" not in _cfg(page) and "passwd" not in page


def test_api_routes_answer_under_the_mount(traces):
    from praisonaiui.features.replay import create_replay_app

    shutil.copy(FIXTURES / "team_handoff.jsonl", traces / "team_handoff.jsonl")
    c = _host(create_replay_app())
    rows = c.get("/replay/api/replay/runs").json()
    assert [r["run_id"] for r in rows] == ["team_handoff"]
    assert c.get("/replay/api/replay/runs/team_handoff/events").json()["events"]


def test_events_wait_param_answers_a_missing_run_without_404(traces):
    from praisonaiui.features.replay import create_replay_app

    c = _host(create_replay_app())
    assert c.get("/replay/api/replay/runs/run-later/events").status_code == 404
    r = c.get("/replay/api/replay/runs/run-later/events?wait=1")
    assert r.status_code == 200 and r.json() == {"events": [], "graph": None, "run": None}


def test_no_run_route_without_a_runner(traces):
    from praisonaiui.features.replay import create_replay_app

    c = _host(create_replay_app())
    assert c.post("/replay/api/replay/run", json={"input": "x"}).status_code in (404, 405)


def test_run_box_calls_the_runner_with_a_new_run_id(traces):
    from praisonaiui.features.replay import create_replay_app

    calls = []

    def runner(text, run_id):
        (traces / f"{run_id}.jsonl").write_text(json.dumps({"event_type": "session_start", "sequence_num": 0, "timestamp": time.time()}) + "\n")
        calls.append((text, run_id))

    c = _host(create_replay_app(runner, input="solar sails", placeholder="Topic"))
    cfg = _cfg(c.get("/replay/").text)
    assert cfg["runner"] == {"input": "solar sails", "placeholder": "Topic", "ask": True}
    r = c.post("/replay/api/replay/run", json={"input": "comets"})
    assert r.status_code == 200
    run_id = r.json()["run_id"]
    assert (traces / f"{run_id}.jsonl").is_file(), "answers once the trace exists"
    for _ in range(100):
        if calls:
            break
        time.sleep(0.01)
    assert calls == [("comets", run_id)]
    assert run_id.startswith("run-") and len(run_id) == 16


def test_run_box_without_input_box(traces):
    from praisonaiui.features.replay import create_replay_app

    cfg = _cfg(_host(create_replay_app(lambda t, r: None, input=None)).get("/replay/").text)
    assert cfg["runner"]["ask"] is False


def test_run_rejects_non_json_bad_input_and_a_second_run(traces):
    from praisonaiui.features.replay import MAX_RUN_INPUT, create_replay_app

    gate = threading.Event()
    c = _host(create_replay_app(lambda text, run_id: gate.wait(5)))
    assert c.post("/replay/api/replay/run", data="input=x", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 415
    assert c.post("/replay/api/replay/run", content="input=x", headers={"content-type": "text/plain"}).status_code == 415
    assert c.post("/replay/api/replay/run", json={"input": 3}).status_code == 400
    assert c.post("/replay/api/replay/run", json={"input": "x" * (MAX_RUN_INPUT + 1)}).status_code == 400
    assert c.post("/replay/api/replay/run", json={"input": "a"}).status_code == 200
    busy = c.post("/replay/api/replay/run", json={"input": "b"})
    assert busy.status_code == 409 and "already" in busy.json()["error"]
    gate.set()
    for _ in range(100):  # the lock is released when the runner returns
        r = c.post("/replay/api/replay/run", json={"input": "c"})
        if r.status_code == 200:
            break
        time.sleep(0.02)
    assert r.status_code == 200


def test_a_failing_runner_frees_the_run_box(traces, caplog):
    from praisonaiui.features.replay import create_replay_app

    def boom(text, run_id):
        raise RuntimeError("no key")

    c = _host(create_replay_app(boom))
    assert c.post("/replay/api/replay/run", json={"input": ""}).status_code == 200
    for _ in range(100):
        r = c.post("/replay/api/replay/run", json={"input": ""})
        if r.status_code == 200:
            break
        time.sleep(0.02)
    assert r.status_code == 200


def test_async_runner_is_awaited(traces):
    from praisonaiui.features.replay import create_replay_app

    done = threading.Event()

    async def runner(text, run_id):
        done.set()

    c = _host(create_replay_app(runner))
    assert c.post("/replay/api/replay/run", json={"input": ""}).status_code == 200
    assert done.wait(3)
