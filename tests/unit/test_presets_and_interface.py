"""Tests for clean page presets (minimal/agent/ops) and 5-line aiui.interface() sugar."""

from __future__ import annotations

import asyncio
import json

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui import server as srv
from praisonaiui.cli import _apply_pages_flag
from praisonaiui.features import attachments as att_mod


def _manifest_ids(tmp_path, monkeypatch) -> set[str]:
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    with TestClient(srv.create_app()) as client:
        return {p["id"] for p in client.get("/api/shell/manifest").json()["pages"]}


class TestPagePresets:
    def test_minimal_preset_keeps_chat_and_user_pages_only(self, tmp_path, monkeypatch):
        srv.reset_state()

        @aiui.page("mine", title="Mine")
        def mine():
            return aiui.layout([aiui.text("hi")])

        aiui.set_pages("minimal")
        ids = _manifest_ids(tmp_path, monkeypatch)
        assert ids == {"chat", "mine"}

    def test_agent_preset_includes_core_agent_pages(self, tmp_path, monkeypatch):
        srv.reset_state()
        aiui.set_pages("agent")
        ids = _manifest_ids(tmp_path, monkeypatch)
        assert {"chat", "sessions", "approvals", "usage", "memory"} <= ids
        assert "training" not in ids
        assert "code-studio" not in ids

    def test_ops_preset_matches_all(self, tmp_path, monkeypatch):
        srv.reset_state()
        aiui.set_pages("ops")
        assert srv._all_pages_listed is True
        ids = _manifest_ids(tmp_path, monkeypatch)
        assert len(ids) > 25

    def test_unknown_preset_raises_value_error(self):
        srv.reset_state()
        with pytest.raises(ValueError, match="preset"):
            aiui.set_pages("unknown-preset")

    def test_cli_apply_pages_flag_accepts_presets_and_csv(self):
        srv.reset_state()
        _apply_pages_flag("agent")
        assert srv._enabled_pages == set(aiui.PAGE_PRESETS["agent"])
        assert srv._pages_configured is True

        _apply_pages_flag("chat,logs")
        assert srv._enabled_pages == {"chat", "logs"}


class TestInterfaceSugar:
    def test_sync_interface_with_shorthand_inputs(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
        srv.reset_state()

        def greet(name: str, excited: bool = False):
            return f"Hello **{name}**{'!' if excited else '.'}"

        pid = aiui.interface(
            greet,
            inputs=["text", "checkbox"],
            title="Greeter",
            description="Say hi",
        )
        assert pid == "greeter"

        with TestClient(srv.create_app()) as client:
            initial = client.get("/api/pages/greeter/data")
            assert initial.status_code == 200
            comps = initial.json()["_components"]
            assert comps[0]["type"] == "caption"
            assert comps[1]["type"] == "form_action"
            assert [c["name"] for c in comps[1]["children"]] == ["name", "excited"]

            post = client.post("/api/pages/greeter/action", json={"name": "Ada", "excited": True})
            assert post.status_code == 200
            out = post.json()["_components"]
            assert out[-1] == {"type": "markdown_text", "content": "Hello **Ada**!"}
            # Form preserves submitted value for quick re-runs.
            assert out[1]["children"][0]["value"] == "Ada"
            assert out[1]["children"][1]["checked"] is True

    def test_async_generator_interface_streams_ndjson(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
        srv.reset_state()

        async def stream_summary(topic: str):
            text = ""
            for part in ("Summary of ", topic):
                text += part
                await asyncio.sleep(0)
                yield text

        aiui.interface(stream_summary, inputs="text", title="Live Writer")

        with TestClient(srv.create_app()) as client:
            res = client.post("/api/pages/live-writer/action", json={"topic": "Agents"})
            assert res.status_code == 200
            assert res.headers["content-type"].startswith("application/x-ndjson")
            frames = [json.loads(line) for line in res.text.splitlines() if line.strip()]
            assert len(frames) == 2
            assert frames[0]["_components"][-1]["content"] == "Summary of "
            assert frames[1]["_components"][-1]["content"] == "Summary of Agents"

    def test_interface_resolves_uploaded_file_and_formats_table_output(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
        srv.reset_state()
        mgr = att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))
        monkeypatch.setattr(att_mod, "_attachment_manager", mgr)
        meta = mgr.upload(b"a,b\n1,2\n", "rows.csv", "text/csv")

        def inspect_csv(doc):
            assert doc["filename"] == "rows.csv"
            with open(doc["path"], "r", encoding="utf-8") as f:
                lines = f.read().strip().splitlines()
            return [{"line": i + 1, "content": line} for i, line in enumerate(lines)]

        aiui.interface(
            inspect_csv,
            inputs=[aiui.file_upload("CSV File", name="doc", accept=".csv")],
            title="CSV Inspector",
        )

        with TestClient(srv.create_app()) as client:
            res = client.post(
                "/api/pages/csv-inspector/action",
                json={"doc": {"id": meta["id"], "filename": "rows.csv"}},
            )
            assert res.status_code == 200
            body = res.json()
            table_block = body["_components"][-1]
            assert table_block["type"] == "table"
            assert table_block["headers"] == ["line", "content"]
            assert len(table_block["rows"]) == 2
            # Hydrated file_upload preserves safe handle (id/filename/size) without leaking path.
            form_children = body["_components"][0]["children"]
            hydrated_upload = form_children[0]
            assert hydrated_upload["value"]["id"] == meta["id"]
            assert "path" not in hydrated_upload["value"]

    def test_interface_blocks_forged_file_upload_path_injection(self, tmp_path, monkeypatch):
        """A client forging ``{id: '../../etc/hosts', path: '/etc/hosts'}`` must receive None, never the forged dict."""
        monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
        srv.reset_state()
        mgr = att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))
        monkeypatch.setattr(att_mod, "_attachment_manager", mgr)

        seen = []

        def inspect_file(doc):
            seen.append(doc)
            return "no file" if doc is None else f"got {doc}"

        aiui.interface(
            inspect_file,
            inputs=[aiui.file_upload("Doc", name="doc")],
            title="Safe Inspector",
        )

        with TestClient(srv.create_app()) as client:
            res = client.post(
                "/api/pages/safe-inspector/action",
                json={"doc": {"id": "../../etc/hosts", "path": "/etc/hosts", "filename": "hosts"}},
            )
            assert res.status_code == 200
            assert seen == [None]
            assert res.json()["_components"][-1]["content"] == "no file"
            # Forged handle is not hydrated back into the form either.
            assert "value" not in res.json()["_components"][0]["children"][0]
