"""Tests for declarative, dynamically-reloaded YAML UI pages."""

from __future__ import annotations

import os

from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.cli import _apply_chat_yaml
from praisonaiui.yaml_pages import apply_yaml_pages


def test_string_only_pages_keep_exact_set_pages_behavior():
    srv.reset_state()
    try:
        reg = apply_yaml_pages(["chat", "logs"])
        assert reg == []
        assert srv._enabled_pages == {"chat", "logs"}
    finally:
        srv.reset_state()


def test_declarative_yaml_pages_render_blocks_and_badges_and_reload_dynamically(tmp_path):
    srv.reset_state()
    try:
        doc = tmp_path / "runbook.md"
        doc.write_text("## Setup\n\nInitial text.\n", encoding="utf-8")

        app_yaml = tmp_path / "app.yaml"
        app_yaml.write_text(
            """
style: app
pages:
  - chat
  - id: analytics
    title: Analytics
    icon: bar-chart-2
    group: Workspace
    badge: "3"
    refresh_every: 15
    components:
      - type: metric
        label: Visitors
        value: "12.4k"
      - type: table
        columns:
          - { key: "name", label: "Channel", type: "text" }
          - { key: "lift", label: "Lift", type: "number", format: "multiplier", tone_above: 1.0 }
        rows:
          - { name: "Ada", lift: 2.4 }
      - type: page_link
        text: "Open Runbook"
        page: runbook
        params:
          section: setup
      - type: custom_plugin_block
        greeting: "hi"
  - id: runbook
    title: Runbook
    icon: book-open
    group: Docs
    markdown_file: runbook.md
    toc: true
""",
            encoding="utf-8",
        )

        import yaml

        cfg = yaml.safe_load(app_yaml.read_text(encoding="utf-8"))
        _apply_chat_yaml(cfg, source_file=app_yaml)

        app = srv.create_app()
        client = TestClient(app)

        # Manifest lists built-in chat + declarative YAML pages with badge.
        manifest = client.get("/api/shell/manifest").json()
        by_id = {p["id"]: p for p in manifest["pages"]}
        assert "chat" in by_id
        assert by_id["analytics"]["kind"] == "blocks"
        assert by_id["analytics"]["badge"] == "3"
        assert by_id["analytics"]["group"] == "Workspace"
        assert by_id["runbook"]["kind"] == "blocks"

        # Page data serves declared component tree + normalized table/page_link + custom plugin blocks.
        data = client.get("/api/pages/analytics/data").json()
        assert data["_refresh_every"] == 15
        assert [c["type"] for c in data["_components"]] == ["metric", "table", "link", "custom_plugin_block"]
        assert data["_components"][1]["headers"] == ["Channel", "Lift"]
        assert data["_components"][1]["rows"] == [["Ada", 2.4]]
        assert data["_components"][2]["href"] == "/runbook?section=setup"
        assert data["_components"][3]["greeting"] == "hi"

        # Markdown file page renders with TOC enabled.
        rb = client.get("/api/pages/runbook/data").json()
        assert rb["_components"][0]["type"] == "markdown_text"
        assert rb["_components"][0]["toc"] is True
        assert "Initial text." in rb["_components"][0]["content"]

        # Dynamically editing app.yaml and runbook.md updates data & badge without restart.
        doc.write_text("## Setup\n\nUpdated text.\n", encoding="utf-8")
        app_yaml.write_text(
            app_yaml.read_text(encoding="utf-8").replace('badge: "3"', 'badge: "9"').replace("12.4k", "19.8k"),
            encoding="utf-8",
        )
        st = app_yaml.stat()
        os.utime(app_yaml, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))

        data2 = client.get("/api/pages/analytics/data").json()
        assert data2["_components"][0]["value"] == "19.8k"
        manifest2 = client.get("/api/shell/manifest").json()
        by_id2 = {p["id"]: p for p in manifest2["pages"]}
        assert by_id2["analytics"]["badge"] == "9"
        rb2 = client.get("/api/pages/runbook/data").json()
        assert "Updated text." in rb2["_components"][0]["content"]
    finally:
        srv.reset_state()


def test_markdown_file_blocks_path_traversal(tmp_path):
    srv.reset_state()
    try:
        secret = tmp_path / "secret.md"
        secret.write_text("TOP SECRET", encoding="utf-8")
        sub = tmp_path / "app"
        sub.mkdir()
        app_yaml = sub / "app.yaml"
        app_yaml.write_text("pages: []\n", encoding="utf-8")

        apply_yaml_pages(
            [{"id": "escape", "title": "Escape", "markdown_file": "../secret.md"}],
            source_file=app_yaml,
        )
        client = TestClient(srv.create_app())
        body = client.get("/api/pages/escape/data").json()
        assert "TOP SECRET" not in str(body)
        assert body["_components"][0]["type"] == "alert"
    finally:
        srv.reset_state()


def test_modular_ref_included_yaml_page_reloads_dynamically(tmp_path):
    srv.reset_state()
    try:
        from praisonaiui.schema.loader import load_config_file

        pages_dir = tmp_path / "pages"
        pages_dir.mkdir()
        overview = pages_dir / "overview.yaml"
        overview.write_text(
            """
id: overview
title: Overview
badge: "1"
components:
  - type: doc_viewer
    title: "Release Notes"
    content: "## Highlights\\n\\nInitial."
""",
            encoding="utf-8",
        )
        app_yaml = tmp_path / "app.yaml"
        app_yaml.write_text(
            """
style: app
pages:
  - $ref: ./pages/overview.yaml
""",
            encoding="utf-8",
        )

        cfg = load_config_file(app_yaml)
        _apply_chat_yaml(cfg, source_file=app_yaml)
        client = TestClient(srv.create_app())

        first = client.get("/api/pages/overview/data").json()
        assert first["_components"][0]["type"] == "markdown_text"
        assert first["_components"][0]["toc"] is True
        assert first["_components"][0]["title"] == "Release Notes"
        assert "Initial." in first["_components"][0]["content"]

        # Edit only the $ref-included file and bump mtime_ns -> reloads live.
        overview.write_text(
            overview.read_text(encoding="utf-8").replace('badge: "1"', 'badge: "7"').replace("Initial.", "Refreshed."),
            encoding="utf-8",
        )
        st = overview.stat()
        os.utime(overview, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))

        second = client.get("/api/pages/overview/data").json()
        assert "Refreshed." in second["_components"][0]["content"]
        manifest = client.get("/api/shell/manifest").json()
        by_id = {p["id"]: p for p in manifest["pages"]}
        assert by_id["overview"]["badge"] == "7"
    finally:
        srv.reset_state()


def test_schema_config_accepts_mixed_pages_list():
    from praisonaiui.schema.models import Config

    cfg = Config.model_validate(
        {
            "schemaVersion": 1,
            "site": {"title": "Demo"},
            "pages": [
                "chat",
                {"id": "kpi", "title": "KPI", "components": [{"type": "metric", "label": "Uptime", "value": "99.9%"}]},
            ],
        }
    )
    assert len(cfg.pages) == 2
    assert cfg.pages[0] == "chat"
    assert isinstance(cfg.pages[1], dict) and cfg.pages[1]["id"] == "kpi"
