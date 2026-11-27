"""Unit tests for YAML parity, CLI parity (notifications/surface/telemetry), and bounded performance."""

from __future__ import annotations

import json
import time
from unittest.mock import patch

import pytest
import yaml
from starlette.testclient import TestClient
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui.a2ui_utils import parse_a2ui_jsonl, v08_to_v09
from praisonaiui.cli import _apply_chat_yaml
from praisonaiui.cli import app as cli_app
from praisonaiui.features.notifications import (
    InMemoryNotificationStore,
    get_notification_store,
    set_notification_store,
)
from praisonaiui.features.surfaces import SurfaceStore, set_surface_store
from praisonaiui.schema.models import ChatConfig


def test_chat_config_schema_supports_preview_alias():
    cfg = ChatConfig(enabled=True, preview={"enabled": True, "surfaceId": "studio", "width": "42%"})
    assert cfg.preview is not None
    assert cfg.preview.enabled is True
    assert cfg.preview.surface_id == "studio"
    assert cfg.preview.width == "42%"


def test_yaml_full_parity_a2ui_surfaces_new_components_notifications_and_dashboard(tmp_path):
    srv.reset_state()
    set_surface_store(SurfaceStore())
    set_notification_store(InMemoryNotificationStore())
    try:
        (tmp_path / "before.txt").write_text("line 1\nold line\n", encoding="utf-8")
        (tmp_path / "after.txt").write_text("line 1\nnew line\n", encoding="utf-8")
        (tmp_path / "seeded.jsonl").write_text(
            "\n".join(
                [
                    json.dumps({"version": "v0.9", "createSurface": {"surfaceId": "seeded", "catalogId": "basic"}}),
                    json.dumps(
                        {
                            "version": "v0.9",
                            "updateComponents": {
                                "surfaceId": "seeded",
                                "components": [{"id": "root", "component": "Text", "text": {"path": "/msg"}}],
                            },
                        }
                    ),
                    json.dumps(
                        {"version": "v0.9", "updateDataModel": {"surfaceId": "seeded", "path": "/", "value": {"msg": "From JSONL"}}}
                    ),
                ]
            ),
            encoding="utf-8",
        )

        app_yaml = tmp_path / "app.yaml"
        app_yaml.write_text(
            """
style: app
dashboard:
  sidebar: true
  pageHeader: false
  modules: [api]
  groups:
    order: [A2UI, Workspace]
chat:
  preview:
    enabled: true
    surfaceId: main
    width: "44%"
surfaces:
  seeded:
    file: seeded.jsonl
notifications:
  max_items: 50
  items:
    - title: "Welcome to YAML App"
      type: success
      category: system
      pinned: true
pages:
  - chat-canvas
  - canvas
  - id: a2ui-yaml
    title: YAML A2UI
    group: A2UI
    surface:
      id: main
      theme:
        primaryColor: "#2563eb"
      sendDataModel: true
      components:
        - id: root
          component: Text
          text: { path: /headline }
          variant: h2
      data:
        headline: "Zero-code A2UI from YAML"
  - id: rich-yaml
    title: Rich Blocks
    group: Workspace
    components:
      - type: stepper
        active: 1
        steps:
          - { title: "Plan" }
          - { title: "Build" }
      - type: timeline
        items:
          - { title: "Deployed", status: success }
      - type: diff_viewer
        title: "Prompt Diff"
        before_file: before.txt
        after_file: after.txt
      - type: tree_view
        nodes:
          - { label: "src", children: [{ label: "app.py" }] }
      - type: copy_field
        label: "API Key"
        value: "sk-demo-123"
        secret: true
      - type: rating_input
        label: "Quality"
        value: 5
""",
            encoding="utf-8",
        )

        cfg = yaml.safe_load(app_yaml.read_text(encoding="utf-8"))
        _apply_chat_yaml(cfg, source_file=app_yaml)
        client = TestClient(srv.create_app())

        # Chat preview & dashboard options applied from YAML
        ui_cfg = client.get("/ui-config.json").json()
        assert ui_cfg["chat"]["preview"] == {"enabled": True, "surfaceId": "main", "width": "44%"}

        # Pre-seeded JSONL surface available immediately via /api/surfaces/{id}
        seeded = client.get("/api/surfaces/seeded").json()
        assert len(seeded["messages"]) == 3
        assert seeded["messages"][2]["updateDataModel"]["value"]["msg"] == "From JSONL"

        # Declarative A2UI surface page serves _surface payload
        a2ui_page = client.get("/api/pages/a2ui-yaml/data").json()
        assert "_surface" in a2ui_page
        assert a2ui_page["_surface"]["id"] == "main"
        assert a2ui_page["_surface"]["messages"][0]["createSurface"]["theme"] == {"primaryColor": "#2563eb"}
        assert a2ui_page["_surface"]["messages"][2]["updateDataModel"]["value"]["headline"] == "Zero-code A2UI from YAML"

        # All 6 new compound UI blocks + safe diff_viewer file resolution work in YAML
        rich = client.get("/api/pages/rich-yaml/data").json()["_components"]
        assert [c["type"] for c in rich] == [
            "stepper",
            "timeline",
            "diff_viewer",
            "tree_view",
            "copy_field",
            "rating_input",
        ]
        assert "old line" in rich[2]["before"]
        assert "new line" in rich[2]["after"]

        # Notifications pre-seeded from YAML with custom max_items
        store = get_notification_store()
        assert isinstance(store, InMemoryNotificationStore)
        assert store._max_items == 50
        listed = client.get("/api/notifications").json()
        assert listed["notifications"][0]["title"] == "Welcome to YAML App"
        assert listed["notifications"][0]["pinned"] is True
    finally:
        srv.reset_state()


def test_cli_parity_notifications_surface_action_and_telemetry():
    runner = CliRunner()

    with (
        patch("praisonaiui.cli._api_get") as mock_get,
        patch("praisonaiui.cli._api_post") as mock_post,
        patch("praisonaiui.cli._api_delete") as mock_del,
    ):
        mock_get.return_value = {
            "notifications": [{"id": "n1", "type": "success", "title": "Ready", "read": False}],
            "unread_count": 1,
        }
        r = runner.invoke(cli_app, ["notifications", "list", "--unread"])
        assert r.exit_code == 0, r.output
        assert "Ready" in r.output

        mock_post.return_value = {"notification": {"id": "n2"}}
        r = runner.invoke(cli_app, ["notifications", "push", "Deploy OK", "--type", "success", "--pinned"])
        assert r.exit_code == 0, r.output
        assert "n2" in r.output

        mock_post.return_value = {"marked": 1}
        assert runner.invoke(cli_app, ["notifications", "read", "n1"]).exit_code == 0
        assert runner.invoke(cli_app, ["notifications", "read-all"]).exit_code == 0

        mock_del.return_value = {"cleared": 1}
        assert runner.invoke(cli_app, ["notifications", "remove", "n1"]).exit_code == 0
        assert runner.invoke(cli_app, ["notifications", "clear", "--read-only"]).exit_code == 0

        mock_post.return_value = {"status": "handled"}
        r = runner.invoke(
            cli_app,
            ["surface", "action", "main", "submit", "--component", "btn-1", "--data", '{"step":2}'],
        )
        assert r.exit_code == 0, r.output
        assert "handled" in r.output

        mock_get.return_value = {
            "total_requests": 42,
            "latency_ms": {"p50": 1.2, "p95": 4.5, "p99": 9.1},
            "rss_mb": 64.0,
        }
        r = runner.invoke(cli_app, ["telemetry", "perf"])
        assert r.exit_code == 0, r.output
        assert "p50=1.2ms" in r.output


@pytest.mark.asyncio
async def test_performance_and_bounded_memory_guarantees():
    # 1. Notification fast-path O(1) push throughput & ring-buffer bound
    nstore = InMemoryNotificationStore(max_items=200)
    t0 = time.perf_counter()
    for i in range(2000):
        nstore.push({"title": f"Event {i}", "type": "info"})
    elapsed_notif = time.perf_counter() - t0
    assert len(nstore.list()) == 200
    assert elapsed_notif < 0.5, f"2000 notification pushes too slow: {elapsed_notif:.3f}s"

    # 2. SurfaceStore bounded deque action queue & bounded message history
    sstore = SurfaceStore(max_action_queue=500, max_surface_messages=100)
    t1 = time.perf_counter()
    for i in range(1000):
        await sstore.queue_action({"action": "tick", "i": i})
    elapsed_actions = time.perf_counter() - t1
    popped = await sstore.pop_actions(limit=1000)
    assert len(popped) == 500
    assert popped[0]["i"] == 500
    assert elapsed_actions < 0.5, f"1000 queued actions too slow: {elapsed_actions:.3f}s"

    await sstore.apply_messages("stream", [{"createSurface": {"surfaceId": "stream", "catalogId": "basic"}}])
    for i in range(150):
        await sstore.apply_messages("stream", [{"updateDataModel": {"surfaceId": "stream", "path": "/n", "value": i}}])
    state = await sstore.get("stream")
    assert state is not None
    assert len(state.messages) == 100
    assert "createSurface" in state.messages[0]

    # 3. JSONL + v0.8 upgrade throughput
    lines = "\n".join(
        json.dumps({"dataModelUpdate": {"surfaceId": "s", "path": "/", "contents": [{"key": "n", "valueNumber": i}]}})
        for i in range(1000)
    )
    t2 = time.perf_counter()
    upgraded = v08_to_v09(parse_a2ui_jsonl(lines))
    elapsed_jsonl = time.perf_counter() - t2
    assert len(upgraded) == 1000
    assert elapsed_jsonl < 0.5, f"1000 v0.8 JSONL upgrades too slow: {elapsed_jsonl:.3f}s"
