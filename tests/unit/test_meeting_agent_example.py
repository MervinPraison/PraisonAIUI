"""Smoke tests for the meeting-agent example (PAI-MEET-UI, issue #260).

Verifies the thin UI example composes existing features via config only:
  - the app builds and the dashboard is reachable without Slack tokens
  - no heavy deps (slack_sdk / openai / chromadb) are imported by loading it
  - the Slack adapter is NOT constructed without tokens
  - the chat system prompt enforces search-before-answer + citation chips
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

EXAMPLE = (
    Path(__file__).resolve().parents[2]
    / "examples"
    / "python"
    / "meeting-agent"
    / "app.py"
)

HEAVY = ("slack_sdk", "openai", "chromadb")


def _load_example():
    before = set(sys.modules)
    spec = importlib.util.spec_from_file_location("meeting_agent_example", EXAMPLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._imported_during_load = set(sys.modules) - before
    return module


@pytest.fixture(scope="module")
def example():
    import os

    saved = {k: os.environ.get(k) for k in ("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN")}
    os.environ.pop("SLACK_BOT_TOKEN", None)
    os.environ.pop("SLACK_APP_TOKEN", None)
    try:
        yield _load_example()
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


def test_app_builds_and_dashboard_reachable(example):
    client = TestClient(example.app)
    assert client.get("/health").status_code == 200
    assert client.get("/api/pages").status_code == 200


def test_meeting_pages_registered(example):
    client = TestClient(example.app)
    ids = {p["id"] for p in client.get("/api/pages").json().get("pages", [])}
    assert {"upload", "meetings", "meeting-detail"} <= ids


def test_no_heavy_deps_imported_by_example(example):
    leaked = [
        m
        for m in example._imported_during_load
        if any(m == h or m.startswith(h + ".") for h in HEAVY)
    ]
    assert leaked == [], f"Heavy deps leaked: {leaked}"


def test_slack_adapter_not_constructed_without_tokens(example):
    assert example._slack_adapter() is None
    assert asyncio.run(example.post_meeting_summary("m-1001", "C123")) is False


def test_summary_id_missing_returns_false(example):
    assert asyncio.run(example.post_meeting_summary("nope", "C123")) is False


def test_system_prompt_enforces_search_and_citations(example):
    prompt = example.CHAT_SYSTEM_PROMPT.lower()
    assert "search_meetings" in prompt
    assert "citation" in prompt


def test_slack_blocks_shape(example):
    blocks = example._summary_blocks(example.SAMPLE_MEETINGS[0])
    assert blocks[0]["type"] == "header"
    assert any(b["type"] == "context" for b in blocks)
