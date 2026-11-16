"""aiui.canvas: explicit artifacts from Python and agent tools.

The element shape (the browser's derive.ts reads it), session routing through
the run's channel, server-side versions that match the browser's numbering,
reads that see user edits, the agent tools, and a WS run end to end.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Dict, List

import pytest

from praisonaiui import canvas
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

TABLE_V1 = "| Algorithm | Average |\n|---|---|\n| Quicksort | O(n log n) |\n| Bubble | O(n^2) |"
TABLE_V2 = (
    "| Algorithm | Average | Stable |\n|---|---|---|\n"
    "| Quicksort | O(n log n) | No |\n| Bubble | O(n^2) | Yes |"
)


@pytest.fixture
def store(tmp_path, monkeypatch):
    """The artifacts feature on (registered), its store under tmp_path."""
    from praisonaiui import features
    from praisonaiui.features import artifacts

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("PRAISONAI_HOME", raising=False)
    monkeypatch.setattr(artifacts, "_store", None)
    monkeypatch.setitem(features._features, "artifacts", artifacts.ArtifactsFeature())
    return artifacts.get_artifact_store()


@pytest.fixture
def no_store(monkeypatch):
    from praisonaiui import features

    monkeypatch.delitem(features._features, "artifacts", raising=False)


@pytest.fixture
def channel():
    ch, token = canvas.bind("s1")
    yield ch
    canvas.unbind(token)


# ── the element ─────────────────────────────────────────────────────


def test_element_shape_and_kind_inference():
    assert canvas.artifact_element("sorting", TABLE_V1, title="Sorting") == {
        "type": "artifact",
        "key": "sorting",
        "kind": "table",
        "title": "Sorting",
        "action": "upsert",
        "content": TABLE_V1,
    }
    assert canvas.artifact_element("app.py", "print(1)")["kind"] == "code"
    assert canvas.artifact_element("x", "print(1)", language="python")["language"] == "python"
    assert canvas.artifact_element("notes.md", "# Notes\n\n| a | b |\n|---|---|")["kind"] == "markdown"
    assert canvas.artifact_element("plan", "Just text")["kind"] == "markdown"
    # A "markdown table" is a table; a document with a table in it stays a document.
    assert canvas.artifact_element("t", TABLE_V1, kind="markdown")["kind"] == "table"
    assert canvas.artifact_element("d", "# Doc\n\n" + TABLE_V1, kind="markdown")["kind"] == "markdown"
    # A table whose newlines a model left escaped (as in JSON).
    escaped = TABLE_V1.replace("\n", "\\n")
    assert canvas.artifact_element("t", escaped, kind="table")["content"] == TABLE_V1
    assert canvas.artifact_element("t", escaped)["kind"] == "table"
    # One line of code with a "\n" in it stays as it is.
    assert canvas.artifact_element("a.py", 'print("a\\nb")')["content"] == 'print("a\\nb")'
    el = canvas.artifact_element("chart", url="/files/c.png", mime_type="image/png")
    assert (el["kind"], el["url"], el["mimeType"]) == ("image", "/files/c.png", "image/png")
    assert "content" not in el


@pytest.mark.parametrize(
    "kwargs, match",
    [
        ({"key": "", "content": "x"}, "key"),
        ({"key": "k" * 301, "content": "x"}, "key"),
        ({"key": "a\nb", "content": "x"}, "key"),
        ({"key": "k", "content": "x", "kind": "html"}, "kind"),
        ({"key": "k", "content": "  ", "kind": "code"}, "needs content"),
        ({"key": "k", "content": "no table here", "kind": "table"}, "markdown table"),
        ({"key": "k", "kind": "image"}, "needs a url"),
        ({"key": "k", "content": "x" * (512 * 1024 + 1)}, "larger"),
    ],
)
def test_bad_writes_are_refused(kwargs, match):
    with pytest.raises(canvas.CanvasError, match=match):
        canvas.artifact_element(**kwargs)


def test_limits_match_the_artifacts_feature():
    from praisonaiui.features import artifacts

    assert canvas.MAX_CONTENT == artifacts.MAX_CONTENT
    assert canvas.MAX_KEY == artifacts.MAX_KEY
    assert canvas.MAX_TITLE == artifacts.MAX_TITLE
    assert set(canvas.KINDS) == set(artifacts.KINDS) - {"a2ui"}


# ── routing ─────────────────────────────────────────────────────────


def test_write_goes_to_the_bound_run_from_any_thread(no_store, channel):
    saved = canvas.write("sorting", TABLE_V1)
    assert saved["version"] is None and saved["sessionId"] == "s1"
    # A tool in an agent's worker thread inherits the run's context.
    ctx = __import__("contextvars").copy_context()
    t = threading.Thread(target=ctx.run, args=(canvas.write, "app.py", "print(1)"))
    t.start()
    t.join()
    assert canvas.open("sorting") is True
    assert [(e["key"], e["action"]) for e in channel.drain()] == [
        ("sorting", "upsert"),
        ("app.py", "upsert"),
        ("sorting", "open"),
    ]
    assert channel.drain() == []


def test_write_for_another_session_is_not_shown_in_this_run(store, channel):
    saved = canvas.write("other", TABLE_V1, session_id="s2")
    assert saved["version"] == 1 and saved["sessionId"] == "s2"
    assert channel.drain() == []
    assert canvas.open("other", session_id="s2") is False


def test_outside_a_run_nothing_is_shown_and_reads_need_a_session(store):
    assert canvas.open("sorting") is False
    assert canvas.read("sorting") is None and canvas.artifacts() == []
    canvas.write("sorting", TABLE_V1, session_id="s9")
    assert canvas.read("sorting", session_id="s9")["content"] == TABLE_V1


def test_url_artifacts_need_the_canvas(no_store):
    with pytest.raises(canvas.CanvasError, match="builtin.artifacts"):
        canvas.write("chart", url="/c.png", session_id="s1")


# ── versions and reads ──────────────────────────────────────────────


def test_versions_match_the_browser_rules(store, channel):
    assert canvas.write("sorting", TABLE_V1, title="Sorting algorithms")["version"] == 1
    # The same content again adds no version (derive.ts does the same).
    assert canvas.write("sorting", TABLE_V1)["version"] == 1
    assert canvas.update("sorting", TABLE_V2)["version"] == 2
    latest = canvas.read("sorting")
    assert latest["content"] == TABLE_V2 and latest["kind"] == "table"
    assert latest["title"] == "Sorting algorithms"  # kept by update
    assert canvas.read("sorting", version=1)["content"] == TABLE_V1
    assert [a["key"] for a in canvas.artifacts()] == ["sorting"]
    # Both writes are shown (the browser dedupes the repeat): v1, v1, v2.
    assert [e.get("content") == TABLE_V2 for e in channel.drain()] == [False, False, True]


def test_read_sees_the_users_edit_and_the_agent_builds_on_it(store, channel):
    canvas.write("sorting", TABLE_V1)
    edited = TABLE_V1.replace("Bubble", "Bubble sort")
    store.put("s1", "sorting", {"kind": "table", "content": edited, "edited": True})
    assert canvas.read("sorting")["content"] == edited
    assert "edited by the user" in canvas.canvas_read("sorting").splitlines()[0]
    # The agent's next version is numbered after the edit, like the canvas does.
    assert canvas.update("sorting", TABLE_V2)["version"] == 3


def test_a_stored_url_is_normalised_and_shown_as_stored(store, channel):
    canvas.write("chart", url="  /files/c.png", mime_type="image/png")
    assert channel.drain()[0]["url"] == "/files/c.png"
    with pytest.raises(canvas.CanvasError, match="scheme"):
        canvas.write("bad", url="javascript:alert(1)", kind="file")


# ── agent tools ─────────────────────────────────────────────────────


def test_tools_are_plain_functions_that_never_raise(store, channel):
    assert [t.__name__ for t in canvas.tools()] == ["canvas_write", "canvas_update", "canvas_read", "canvas_list"]
    assert canvas.canvas_list() == "The canvas is empty."
    assert "no artifact named 'x'" in canvas.canvas_read("x")
    assert canvas.canvas_write("sorting", TABLE_V1, title="Sorting").startswith(
        "Saved 'sorting' to the canvas (table, version 1)"
    )
    assert canvas.canvas_write("t", "oops", kind="table").startswith("Error: table content")
    assert "version 2" in canvas.canvas_update("sorting", TABLE_V2)
    assert canvas.canvas_read("sorting") == (
        "Artifact 'sorting' (table, version 2, written by the agent), titled 'Sorting'. "
        "Its full content is everything after this line:\n" + TABLE_V2
    )
    assert canvas.canvas_list() == "- sorting (table, v2): Sorting"


def test_attach_tools_only_with_a_canvas(no_store, monkeypatch, store):
    class A:
        def __init__(self):
            def canvas_read(name: str) -> str:  # the app's own wins
                return name

            self.tools = [canvas_read]

    a = A()
    assert canvas.attach_tools(a) is True
    assert [t.__name__ for t in a.tools] == ["canvas_read", "canvas_write", "canvas_update", "canvas_list"]
    assert a.tools[0] is not canvas.canvas_read
    from praisonaiui import features

    monkeypatch.delitem(features._features, "artifacts")
    b = A()
    assert canvas.attach_tools(b) is False and len(b.tools) == 1


def test_provider_attaches_tools_only_when_asked(monkeypatch, store):
    from praisonaiui.providers import PraisonAIProvider

    class Agent:
        name = "A"
        tools: List[Any] = []

    agent = Agent()
    PraisonAIProvider(agent=agent)  # default: untouched
    p = PraisonAIProvider(agent=agent, canvas_tools=True)
    assert p._canvas_tools is True and "canvas_tools" not in p._agent_kwargs


# ── a WS run end to end ─────────────────────────────────────────────


class _WS:
    def __init__(self) -> None:
        self.frames: List[Dict[str, Any]] = []

    async def send_text(self, data: str) -> None:
        self.frames.append(json.loads(data))


@pytest.mark.asyncio
async def test_a_ws_run_sends_and_saves_the_writes_in_order(monkeypatch, store, tmp_path):
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)
    ds = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", ds)
    monkeypatch.setattr(chat_mod, "_chat_manager", chat_mod.ChatManager())

    class Writes(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Analyst")
            canvas.write("sorting", TABLE_V1)
            # A tool thread, as an agent SDK runs it.
            await asyncio.to_thread(canvas.update, "sorting", TABLE_V2)
            yield RunEvent(type=RunEventType.RUN_CONTENT, token="Done.")
            canvas.open("sorting")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Done.")

    monkeypatch.setattr(server, "get_provider", lambda: Writes())
    ws = _WS()
    chat_mod.get_chat_manager().add_ws_client("c", ws)
    await ds.create_session("s-canvas")
    await chat_mod._run_and_broadcast("table please", "s-canvas", None, None)

    kinds = [f["type"] for f in ws.frames]
    els = [f["element"] for f in ws.frames if f["type"] == "message_element"]
    assert [(e["action"], e.get("content")) for e in els] == [
        ("upsert", TABLE_V1),
        ("upsert", TABLE_V2),
        ("open", None),
    ]
    # Every element precedes the reply's end, so the canvas has them live.
    assert kinds.index("run_completed") > max(i for i, k in enumerate(kinds) if k == "message_element")
    assert all(f["session_id"] == "s-canvas" and f["run_id"] for f in ws.frames if f["type"] == "message_element")
    saved = (await ds.get_messages("s-canvas"))[-1]
    assert [e["action"] for e in saved["elements"]] == ["upsert", "upsert", "open"]
    assert [a["version"] for a in store.session("s-canvas")] == [1, 2]
    assert canvas._channel.get() is None  # unbound after the run
