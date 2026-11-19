"""Chat thumbs feedback is kept by every data store the app can select.

The default store when the agents package is installed (``SDKFileDataStore``)
and any store that does not override the feedback methods used to drop votes;
the JSON file store rewrote one array per vote. Votes are now appended as
JSON lines and read back by ``list_feedback``.
"""

import asyncio
import json
from typing import Any, Optional

from starlette.testclient import TestClient

from praisonaiui.datastore import BaseDataStore, JSONFileDataStore
from praisonaiui.datastore_sdk import SDKFileDataStore
from praisonaiui.server import create_app, get_datastore, set_datastore, set_feedback_enabled


def _sdk_store(folder) -> SDKFileDataStore:
    """An SDK store over *folder* without the agents package (feedback needs only the folder)."""
    store = SDKFileDataStore.__new__(SDKFileDataStore)
    store._session_dir = str(folder)
    return store


class _SessionsOnlyStore(BaseDataStore):
    """A custom store that implements only the abstract session methods."""

    async def list_sessions(self) -> list[dict[str, Any]]:
        return []

    async def get_session(self, session_id: str) -> Optional[dict[str, Any]]:
        return None

    async def create_session(self, session_id: Optional[str] = None) -> dict[str, Any]:
        return {"id": session_id or "s"}

    async def delete_session(self, session_id: str) -> bool:
        return False

    async def add_message(self, session_id: str, message: dict[str, Any]) -> None:
        return None

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return []


def _vote_twice(store: BaseDataStore) -> None:
    asyncio.run(store.record_feedback("s1", "m1", 1, "good"))
    asyncio.run(store.record_feedback("s2", "m2", -1))


def test_sdk_store_keeps_feedback_next_to_its_sessions(tmp_path):
    _vote_twice(_sdk_store(tmp_path))

    again = _sdk_store(tmp_path)  # a restarted server reads the same folder
    rows = asyncio.run(again.list_feedback())
    assert [(r["session_id"], r["message_id"], r["value"], r["comment"]) for r in rows] == [
        ("s1", "m1", 1, "good"),
        ("s2", "m2", -1, None),
    ]
    assert [r["message_id"] for r in asyncio.run(again.list_feedback("s2"))] == ["m2"]
    assert (tmp_path / "feedback" / "feedback.jsonl").is_file()
    assert not list(tmp_path.glob("*.json"))  # no file the session list would pick up


def test_store_without_feedback_methods_persists_under_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    _vote_twice(_SessionsOnlyStore())

    rows = asyncio.run(_SessionsOnlyStore().list_feedback("s1"))
    assert [(r["message_id"], r["value"]) for r in rows] == [("m1", 1)]
    assert (tmp_path / "feedback" / "feedback.jsonl").is_file()


def test_json_store_appends_one_line_per_vote(tmp_path):
    store = JSONFileDataStore(str(tmp_path))
    _vote_twice(store)

    lines = (tmp_path / "feedback" / "feedback.jsonl").read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["message_id"] for line in lines] == ["m1", "m2"]
    assert len(asyncio.run(JSONFileDataStore(str(tmp_path)).list_feedback())) == 2


def test_json_store_moves_an_older_feedback_array_into_the_log(tmp_path):
    folder = tmp_path / "feedback"
    folder.mkdir()
    old = [{"id": "a", "session_id": "s0", "message_id": "m0", "value": 1, "comment": None}]
    (folder / "feedback.json").write_text(json.dumps(old), encoding="utf-8")

    store = JSONFileDataStore(str(tmp_path))
    asyncio.run(store.record_feedback("s1", "m1", -1))

    assert [r["message_id"] for r in asyncio.run(store.list_feedback())] == ["m0", "m1"]
    assert not (folder / "feedback.json").exists()


def test_a_torn_last_line_is_skipped(tmp_path):
    from praisonaiui.datastore import read_jsonl

    path = tmp_path / "feedback.jsonl"
    path.write_text('{"message_id": "m1"}\n{"message_id": "m', encoding="utf-8")
    assert read_jsonl(path) == [{"message_id": "m1"}]


def test_thumbs_route_round_trips_through_the_sdk_store(tmp_path):
    previous = get_datastore()
    set_datastore(_sdk_store(tmp_path))
    set_feedback_enabled(True)
    try:
        client = TestClient(create_app())
        posted = client.post(
            "/api/feedback", json={"session_id": "s1", "message_id": "m1", "value": -1}
        )
        assert posted.status_code == 200
        data = client.get("/api/feedback").json()
        assert [(r["message_id"], r["value"]) for r in data["feedback"]] == [("m1", -1)]
        assert data["summary"]["negative"] == 1
    finally:
        set_datastore(previous)
