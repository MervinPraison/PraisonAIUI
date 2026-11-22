"""The SDK schedule tools (``schedule_add``/``schedule_list``/``schedule_remove``)
run against aiui's config.yaml store when an agent schedules from chat.

praisonaiagents scopes every lookup to an owner (``principal=``). The store
must accept that keyword, or every chat schedule request fails with
``unexpected keyword argument 'principal'``.
"""

import pytest

from praisonaiui import config_store
from praisonaiui.features import schedules

schedule_tools = pytest.importorskip("praisonaiagents.tools.schedule_tools")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(
        config_store, "_config_store", config_store.YAMLConfigStore(tmp_path / "config.yaml")
    )
    monkeypatch.setattr(schedules, "_schedule_store", None)
    st = schedules._get_schedule_store()
    yield st
    schedule_tools.set_store(None)


def test_sdk_tools_add_list_remove(store):
    added = schedule_tools.schedule_add(
        name="daily-hello", schedule="every day at 21:05", message="hello"
    )
    assert "added" in added, added
    assert [j["name"] for j in store.list()] == ["daily-hello"]

    listed = schedule_tools.schedule_list()
    assert "daily-hello" in listed, listed

    dup = schedule_tools.schedule_add(name="daily-hello", schedule="daily", message="x")
    assert "already exists" in dup, dup

    removed = schedule_tools.schedule_remove(name="daily-hello")
    assert "Error" not in removed, removed
    assert store.list() == []


def test_principal_scopes_lookups(store):
    store.add({"id": "a", "name": "mine", "principal": "alice"})
    store.add({"id": "b", "name": "theirs", "principal": "bob"})
    store.add({"id": "c", "name": "global"})

    assert {j["id"] for j in store.list()} == {"a", "b", "c"}
    assert [j["id"] for j in store.list(principal="alice")] == ["a"]
    assert store.get_by_name("theirs", principal="alice") is None
    assert store.get_by_name("mine", principal="alice")["id"] == "a"
    assert store.get_by_name("theirs")["id"] == "b"
    assert store.remove_by_name("theirs", principal="alice") is False
    assert store.remove_by_name("theirs", principal="bob") is True


def test_list_filters_by_agent(store):
    store.add({"id": "a", "name": "x", "agent_id": "writer"})
    store.add({"id": "b", "name": "y", "agent_id": "coder"})
    assert [j["id"] for j in store.list(agent_id="writer")] == ["a"]


def test_dashboard_job_shows_in_sdk_list(store):
    store.add(
        {
            "id": "d1",
            "name": "from-dashboard",
            "schedule": {"kind": "cron", "cron_expr": "0 9 * * *"},
            "message": "brief",
            "enabled": True,
            "agent_name": "Writer",
        }
    )
    assert "from-dashboard" in schedule_tools.schedule_list()


def test_startup_wires_store_into_sdk_tools(tmp_path, monkeypatch):
    from praisonaiui.features import lifecycle

    monkeypatch.setattr(
        config_store, "_config_store", config_store.YAMLConfigStore(tmp_path / "config.yaml")
    )
    monkeypatch.setattr(schedules, "_schedule_store", None)
    monkeypatch.setattr(schedules, "_ensure_scheduler_started", lambda: None)
    monkeypatch.setattr(lifecycle, "_startup_hooks", [])
    schedules.SchedulesFeature().routes()
    try:
        for hook in lifecycle._startup_hooks:
            hook()
        assert "added" in schedule_tools.schedule_add(name="x", schedule="daily", message="m")
        assert [j["name"] for j in schedules._get_schedule_store().list()] == ["x"]
    finally:
        schedule_tools.set_store(None)
