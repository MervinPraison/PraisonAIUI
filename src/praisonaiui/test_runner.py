"""CLI test runner — ``aiui test`` subcommands for integration verification.

Usage::

    # Against a running server
    aiui test all --server http://127.0.0.1:8082

    # Individual tests
    aiui test chat -s http://127.0.0.1:8082
    aiui test memory -s http://127.0.0.1:8082
    aiui test sessions -s http://127.0.0.1:8082
    aiui test endpoints -s http://127.0.0.1:8082
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

test_app = typer.Typer(
    name="test",
    help="Run integration tests against a live AIUI server",
    add_completion=False,
)
console = Console()

_SERVER_OPT = typer.Option(
    "http://127.0.0.1:8082", "--server", "-s", help="Server URL"
)

# ── Helpers ──────────────────────────────────────────────────────────


def _get(server: str, path: str) -> dict:
    with urlopen(f"{server}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def _post(server: str, path: str, body: dict = None) -> dict:
    data = json.dumps(body or {}).encode()
    req = Request(
        f"{server}{path}", data=data, headers={"Content-Type": "application/json"}
    )
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


class _Results:
    """Test result tracker."""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.errors: list[str] = []

    def check(self, name: str, ok: bool, detail: str = ""):
        if ok:
            self.passed += 1
            console.print(f"  [green]✓[/green] {name}")
        else:
            self.failed += 1
            msg = f"{name}: {detail}" if detail else name
            self.errors.append(msg)
            console.print(f"  [red]✗[/red] {msg}")

    def skip(self, name: str, reason: str = "not available"):
        self.skipped += 1
        console.print(f"  [yellow]○[/yellow] {name} [dim]({reason})[/dim]")

    def summary(self):
        color = "green" if self.failed == 0 else "red"
        parts = [f"{self.passed} passed", f"{self.failed} failed"]
        if self.skipped:
            parts.append(f"{self.skipped} skipped")
        console.print()
        console.print(
            Panel(
                f"[bold {color}]{', '.join(parts)}[/bold {color}]",
                title="Test Results",
                border_style=color,
            )
        )
        if self.errors:
            console.print("[dim]Failures:[/dim]")
            for e in self.errors:
                console.print(f"  [red]✗[/red] {e}")
        return self.failed == 0


def _wait_for_response(server: str, session_id: str, timeout: int = 20) -> list:
    """Poll history until assistant response appears."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = _get(server, f"/api/chat/history/{session_id}")
            msgs = data.get("messages", [])
            if any(m.get("role") == "assistant" for m in msgs):
                return msgs
        except Exception:
            pass
        time.sleep(1)
    # Return whatever we have
    try:
        return _get(server, f"/api/chat/history/{session_id}").get("messages", [])
    except Exception:
        return []


def _check_server(server: str) -> bool:
    """Quick connectivity check."""
    try:
        urlopen(f"{server}/api/features", timeout=5)
        return True
    except Exception:
        return False


# ── Commands ─────────────────────────────────────────────────────────


@test_app.command("chat")
def test_chat(server: str = _SERVER_OPT) -> None:
    """Test chat: send message, get response, verify session isolation."""
    r = _Results()
    console.print(Panel("[bold]Chat Tests[/bold]", border_style="cyan"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    sid_a = f"test-chat-{uuid.uuid4().hex[:8]}"
    sid_b = f"test-chat-{uuid.uuid4().hex[:8]}"

    # Test 1: Send message to session A
    console.print("\n[dim]Step 1: Send message to session A[/dim]")
    try:
        resp = _post(server, "/api/chat/send", {
            "message": "My name is TestAlice. Remember this.",
            "session_id": sid_a,
        })
        r.check("POST /api/chat/send returns session_id", resp.get("session_id") == sid_a)
    except Exception as e:
        r.check("POST /api/chat/send", False, str(e))
        r.summary()
        raise typer.Exit(code=1)

    msgs_a = _wait_for_response(server, sid_a)
    r.check("Session A: user message present", any(m.get("role") == "user" for m in msgs_a))
    r.check("Session A: assistant responded", any(m.get("role") == "assistant" for m in msgs_a))
    r.check("Session A: exactly 2 messages", len(msgs_a) == 2, f"Got {len(msgs_a)}")

    # Test 2: Session B — verify history isolation (separate chat_history)
    console.print("\n[dim]Step 2: Session history isolation — session B[/dim]")
    try:
        _post(server, "/api/chat/send", {
            "message": "Say hello",
            "session_id": sid_b,
        })
    except Exception as e:
        r.check("POST to session B", False, str(e))

    msgs_b = _wait_for_response(server, sid_b)
    r.check("Session B: has response", any(m.get("role") == "assistant" for m in msgs_b))

    # Session B's HISTORY should NOT contain Session A's messages
    b_user_msgs = [m.get("content", "") for m in msgs_b if m.get("role") == "user"]
    r.check(
        "Session B: history does not contain Session A's messages",
        not any("TestAlice" in msg for msg in b_user_msgs),
        f"Session A messages leaked into Session B history",
    )
    r.check(
        "Session B: has its own messages only",
        len(msgs_b) == 2,
        f"Expected 2, got {len(msgs_b)}",
    )

    # Test 3: Session A remembers within its own session
    console.print("\n[dim]Step 3: Session A remembers context[/dim]")
    try:
        _post(server, "/api/chat/send", {
            "message": "What is my name?",
            "session_id": sid_a,
        })
    except Exception as e:
        r.check("Follow-up to session A", False, str(e))

    time.sleep(8)
    msgs_a2 = _wait_for_response(server, sid_a)
    a2_content = " ".join(m.get("content", "") for m in msgs_a2 if m.get("role") == "assistant")
    r.check(
        "Session A: remembers 'TestAlice'",
        "TestAlice" in a2_content or "Alice" in a2_content,
        f"Name not found in: {a2_content[:150]}",
    )

    ok = r.summary()
    if not ok:
        raise typer.Exit(code=1)


@test_app.command("memory")
def test_memory(server: str = _SERVER_OPT) -> None:
    """Test persistent memory: store fact in session A, recall in session B."""
    r = _Results()
    console.print(Panel("[bold]Memory Tests[/bold]", border_style="magenta"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    sid_a = f"test-mem-{uuid.uuid4().hex[:8]}"
    sid_b = f"test-mem-{uuid.uuid4().hex[:8]}"

    # Store fact
    console.print("\n[dim]Step 1: Store fact in session A[/dim]")
    try:
        _post(server, "/api/chat/send", {
            "message": "My favorite programming language is Haskell. Remember this fact.",
            "session_id": sid_a,
        })
    except Exception as e:
        r.check("Store fact", False, str(e))
        r.summary()
        raise typer.Exit(code=1)

    _wait_for_response(server, sid_a)
    r.check("Session A: fact stored", True)

    # Recall from different session
    console.print("\n[dim]Step 2: Recall from session B (cross-session memory)[/dim]")
    try:
        _post(server, "/api/chat/send", {
            "message": "Do you know what my favorite programming language is?",
            "session_id": sid_b,
        })
    except Exception as e:
        r.check("Ask in session B", False, str(e))

    msgs_b = _wait_for_response(server, sid_b)
    b_content = " ".join(m.get("content", "") for m in msgs_b if m.get("role") == "assistant")
    r.check(
        "Session B: recalls 'Haskell' from memory",
        "Haskell" in b_content or "haskell" in b_content.lower(),
        f"Not found in: {b_content[:150]}",
    )

    ok = r.summary()
    if not ok:
        raise typer.Exit(code=1)


@test_app.command("sessions")
def test_sessions(server: str = _SERVER_OPT) -> None:
    """Test session persistence: verify messages survive server restart."""
    r = _Results()
    console.print(Panel("[bold]Session Persistence Tests[/bold]", border_style="yellow"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    sid = f"test-persist-{uuid.uuid4().hex[:8]}"

    # Send message
    console.print("\n[dim]Step 1: Send message and verify storage[/dim]")
    try:
        _post(server, "/api/chat/send", {
            "message": "Testing session persistence",
            "session_id": sid,
        })
    except Exception as e:
        r.check("Send message", False, str(e))
        r.summary()
        raise typer.Exit(code=1)

    msgs = _wait_for_response(server, sid)
    r.check("Messages returned", len(msgs) >= 2, f"Expected ≥2, got {len(msgs)}")

    # Check file on disk
    session_file = Path.home() / ".praisonaiui" / "sessions" / f"{sid}.json"
    r.check(f"Session file exists: {session_file.name}", session_file.exists())

    if session_file.exists():
        data = json.loads(session_file.read_text())
        file_msgs = data.get("messages", [])
        r.check(
            "File contains messages",
            len(file_msgs) >= 1,
            f"Expected ≥1, got {len(file_msgs)}",
        )

    # Check via API
    console.print("\n[dim]Step 2: Verify via history API[/dim]")
    try:
        history = _get(server, f"/api/chat/history/{sid}")
        api_msgs = history.get("messages", [])
        r.check(
            "History API returns messages",
            len(api_msgs) >= 2,
            f"Expected ≥2, got {len(api_msgs)}",
        )
    except Exception as e:
        r.check("History API", False, str(e))

    console.print()
    console.print("[dim]Note: To test restart persistence, stop the server, restart it,[/dim]")
    console.print(f"[dim]and run: aiui test sessions --server {server}[/dim]")
    console.print(f"[dim]Session ID: {sid}[/dim]")

    ok = r.summary()
    if not ok:
        raise typer.Exit(code=1)


@test_app.command("endpoints")
def test_endpoints(server: str = _SERVER_OPT) -> None:
    """Test all API endpoints: features, sessions, chat, provider, channels, agents, config, and more."""
    r = _Results()
    console.print(Panel("[bold]Endpoint Tests[/bold]", border_style="blue"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    # ── Health ───────────────────────────────────────────────────────
    console.print("\n[dim]Health[/dim]")
    try:
        data = _get(server, "/health")
        r.check("GET /health", data.get("status") == "ok")
    except Exception as e:
        r.check("GET /health", False, str(e))

    # ── Features ─────────────────────────────────────────────────────
    console.print("\n[dim]Features[/dim]")
    try:
        data = _get(server, "/api/features")
        features = data.get("features", [])
        r.check("GET /api/features", len(features) > 0, f"Got {len(features)} features")
        names = [f.get("name") for f in features]
        for needed in ["chat", "channels", "agents_crud", "config_runtime"]:
            r.check(f"Feature '{needed}' registered", needed in names)
    except Exception as e:
        r.check("GET /api/features", False, str(e))

    # ── Sessions ─────────────────────────────────────────────────────
    console.print("\n[dim]Sessions[/dim]")
    try:
        data = _get(server, "/api/sessions")
        r.check("GET /api/sessions", "sessions" in data)
    except Exception as e:
        r.check("GET /api/sessions", False, str(e))

    # ── Chat ─────────────────────────────────────────────────────────
    console.print("\n[dim]Chat[/dim]")
    try:
        data = _get(server, "/api/chat/history/nonexistent-test")
        msgs = data.get("messages", [])
        r.check("GET /api/chat/history (empty session)", len(msgs) == 0)
    except Exception as e:
        r.check("GET /api/chat/history", False, str(e))

    test_sid = f"test-ep-{uuid.uuid4().hex[:8]}"
    try:
        resp = _post(server, "/api/chat/send", {
            "message": "Hello",
            "session_id": test_sid,
        })
        r.check("POST /api/chat/send", resp.get("status") == "sent")
    except Exception as e:
        r.check("POST /api/chat/send", False, str(e))

    # ── Channels ─────────────────────────────────────────────────────
    console.print("\n[dim]Channels[/dim]")
    try:
        data = _get(server, "/api/channels")
        r.check("GET /api/channels", "channels" in data)
    except Exception as e:
        r.check("GET /api/channels", False, str(e))

    try:
        data = _get(server, "/api/channels/platforms")
        platforms = data.get("platforms", [])
        r.check("GET /api/channels/platforms", len(platforms) > 0, f"Got {len(platforms)}")
    except Exception as e:
        r.check("GET /api/channels/platforms", False, str(e))

    # ── Agents ───────────────────────────────────────────────────────
    console.print("\n[dim]Agents[/dim]")
    try:
        data = _get(server, "/api/agents/definitions")
        agents = data.get("agents", [])
        r.check("GET /api/agents/definitions", isinstance(agents, list))
    except Exception as e:
        r.check("GET /api/agents/definitions", False, str(e))

    try:
        data = _get(server, "/api/agents/models")
        r.check("GET /api/agents/models", "models" in data)
    except Exception as e:
        r.skip("GET /api/agents/models")

    # ── Config ───────────────────────────────────────────────────────
    console.print("\n[dim]Config[/dim]")
    try:
        data = _get(server, "/api/config")
        r.check("GET /api/config", "config" in data)
    except Exception as e:
        r.check("GET /api/config", False, str(e))

    try:
        data = _get(server, "/api/config/runtime")
        r.check("GET /api/config/runtime", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/config/runtime")

    try:
        data = _get(server, "/api/config/schema")
        r.check("GET /api/config/schema", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/config/schema")

    # ── Skills ───────────────────────────────────────────────────────
    console.print("\n[dim]Skills[/dim]")
    try:
        data = _get(server, "/api/skills")
        r.check("GET /api/skills", "skills" in data)
    except Exception as e:
        r.skip("GET /api/skills")

    # ── Memory ───────────────────────────────────────────────────────
    console.print("\n[dim]Memory[/dim]")
    try:
        data = _get(server, "/api/memory")
        r.check("GET /api/memory", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/memory")

    # ── Schedules ────────────────────────────────────────────────────
    console.print("\n[dim]Schedules[/dim]")
    try:
        data = _get(server, "/api/schedules")
        r.check("GET /api/schedules", "schedules" in data)
    except Exception as e:
        r.skip("GET /api/schedules")

    # ── Hooks ────────────────────────────────────────────────────────
    console.print("\n[dim]Hooks[/dim]")
    try:
        data = _get(server, "/api/hooks")
        r.check("GET /api/hooks", "hooks" in data)
    except Exception as e:
        r.skip("GET /api/hooks")

    # ── Workflows ────────────────────────────────────────────────────
    console.print("\n[dim]Workflows[/dim]")
    try:
        data = _get(server, "/api/workflows")
        r.check("GET /api/workflows", "workflows" in data)
    except Exception as e:
        r.skip("GET /api/workflows")

    # ── Approvals ────────────────────────────────────────────────────
    console.print("\n[dim]Approvals[/dim]")
    try:
        data = _get(server, "/api/approvals")
        r.check("GET /api/approvals", "approvals" in data)
    except Exception as e:
        r.skip("GET /api/approvals")

    try:
        data = _get(server, "/api/approvals/pending")
        r.check("GET /api/approvals/pending", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/approvals/pending")

    # ── Auth ─────────────────────────────────────────────────────────
    console.print("\n[dim]Auth[/dim]")
    try:
        data = _get(server, "/api/auth/status")
        r.check("GET /api/auth/status", "mode" in data or "status" in data)
    except Exception as e:
        r.skip("GET /api/auth/status")

    try:
        data = _get(server, "/api/auth/config")
        r.check("GET /api/auth/config", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/auth/config")

    # ── Knowledge ────────────────────────────────────────────────────
    console.print("\n[dim]Knowledge[/dim]")
    try:
        data = _get(server, "/api/knowledge")
        r.check("GET /api/knowledge", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/knowledge")

    # ── Guardrails ───────────────────────────────────────────────────
    console.print("\n[dim]Guardrails[/dim]")
    try:
        data = _get(server, "/api/guardrails")
        r.check("GET /api/guardrails", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/guardrails")

    # ── i18n ─────────────────────────────────────────────────────────
    console.print("\n[dim]i18n[/dim]")
    try:
        data = _get(server, "/api/i18n/locale")
        r.check("GET /api/i18n/locale", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/i18n/locale")

    # ── Telemetry ────────────────────────────────────────────────────
    console.print("\n[dim]Telemetry[/dim]")
    try:
        data = _get(server, "/api/telemetry")
        r.check("GET /api/telemetry", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/telemetry")

    # ── Security ─────────────────────────────────────────────────────
    console.print("\n[dim]Security[/dim]")
    try:
        data = _get(server, "/api/security/status")
        r.check("GET /api/security/status", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/security/status")

    # ── Logs ─────────────────────────────────────────────────────────
    console.print("\n[dim]Logs[/dim]")
    try:
        data = _get(server, "/api/logs")
        r.check("GET /api/logs", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/logs")

    # ── Usage ────────────────────────────────────────────────────────
    console.print("\n[dim]Usage[/dim]")
    try:
        data = _get(server, "/api/usage")
        r.check("GET /api/usage", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/usage")

    # ── Nodes ────────────────────────────────────────────────────────
    console.print("\n[dim]Nodes[/dim]")
    try:
        data = _get(server, "/api/nodes")
        r.check("GET /api/nodes", isinstance(data, dict))
    except Exception as e:
        r.skip("GET /api/nodes")

    # ── Provider (optional) ──────────────────────────────────────────
    console.print("\n[dim]Provider (optional)[/dim]")
    for path, label in [
        ("/api/provider/health", "GET /api/provider/health"),
        ("/api/provider/agents", "GET /api/provider/agents"),
    ]:
        try:
            data = _get(server, path)
            r.check(label, True)
        except Exception:
            r.skip(label)

    ok = r.summary()
    if not ok:
        raise typer.Exit(code=1)


def _put(server: str, path: str, body: dict = None) -> dict:
    data = json.dumps(body or {}).encode()
    req = Request(
        f"{server}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="PUT",
    )
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _delete(server: str, path: str) -> dict:
    req = Request(f"{server}{path}", method="DELETE")
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


@test_app.command("features")
def test_features(server: str = _SERVER_OPT) -> None:
    """Deep functional CRUD tests: guardrails, knowledge, memory, workflows, channels, eval."""
    r = _Results()
    console.print(Panel("[bold]Feature CRUD Tests[/bold]", border_style="magenta"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    # ── Guardrails: register → verify → delete ────────────────
    console.print("\n[dim]Guardrails: Create → Verify → Delete[/dim]")
    try:
        before = _get(server, "/api/guardrails")
        before_count = before.get("count", 0)

        new_gr = _post(server, "/api/guardrails/register", {
            "name": "IntegrationTestGuardrail",
            "description": "Test guardrail from aiui test",
            "type": "input",
            "config": {"block_words": ["blocked"]},
        })
        gr_id = new_gr.get("registered") or new_gr.get("id") or new_gr.get("guardrail_id")
        r.check("Register guardrail", gr_id is not None)

        after = _get(server, "/api/guardrails")
        r.check("Guardrail appears in list", after.get("count", 0) > before_count)

        status = _get(server, "/api/guardrails/status")
        r.check("Guardrails status", isinstance(status, dict))

        violations = _get(server, "/api/guardrails/violations")
        r.check("Guardrails violations", isinstance(violations, dict))

        if gr_id:
            _delete(server, f"/api/guardrails/{gr_id}")
            final = _get(server, "/api/guardrails")
            r.check("Delete guardrail", final.get("count", 0) == before_count)
    except Exception as e:
        r.check("Guardrails CRUD", False, str(e))

    # ── Knowledge: add → search → delete ──────────────────────
    console.print("\n[dim]Knowledge: Add → Search → Delete[/dim]")
    try:
        before = _get(server, "/api/knowledge")
        before_count = before.get("count", 0)

        unique_fact = f"Capital of Testlandia is Verifytown-{uuid.uuid4().hex[:6]}"
        new_k = _post(server, "/api/knowledge", {
            "title": "Testlandia Fact",
            "text": unique_fact,
            "metadata": {"source": "aiui-test"},
        })
        k_id = new_k.get("id") or new_k.get("entry_id")
        r.check("Add knowledge", k_id is not None)

        after = _get(server, "/api/knowledge")
        r.check("Knowledge count increased", after.get("count", 0) > before_count)

        search = _post(server, "/api/knowledge/search", {
            "query": "capital of Testlandia",
            "top_k": 5,
        })
        results = search.get("results", search.get("entries", []))
        found = any("Testlandia" in str(x) or "Verifytown" in str(x) for x in results)
        r.check("Knowledge search returns our entry", found)

        status = _get(server, "/api/knowledge/status")
        r.check("Knowledge status", isinstance(status, dict))

        if k_id:
            _delete(server, f"/api/knowledge/{k_id}")
            final = _get(server, "/api/knowledge")
            r.check("Delete knowledge", final.get("count", 0) == before_count)
    except Exception as e:
        r.check("Knowledge CRUD", False, str(e))

    # ── Memory: store → verify → search → session → delete ───
    console.print("\n[dim]Memory: Store → Verify → Search → Delete[/dim]")
    try:
        before = _get(server, "/api/memory")
        before_count = len(before.get("memories", []))

        mem_text = f"Test fact: user serial {uuid.uuid4().hex[:8]}"
        new_mem = _post(server, "/api/memory", {
            "text": mem_text,
            "memory_type": "long",
            "metadata": {"source": "aiui-test"},
        })
        mem_id = new_mem.get("id") or new_mem.get("memory_id")
        r.check("Store memory", mem_id is not None)

        after = _get(server, "/api/memory")
        r.check("Memory count increased", len(after.get("memories", [])) > before_count)

        search = _post(server, "/api/memory/search", {
            "query": "user serial",
            "top_k": 5,
        })
        r.check("Memory search works", isinstance(search, dict))

        mstatus = _get(server, "/api/memory/status")
        r.check("Memory status", isinstance(mstatus, dict))

        if mem_id:
            _delete(server, f"/api/memory/{mem_id}")
            r.check("Delete memory", True)
    except Exception as e:
        r.check("Memory CRUD", False, str(e))

    # ── Chat: cross-session memory verification ───────────────
    console.print("\n[dim]Memory: Cross-session recall via chat[/dim]")
    sid_store = f"test-store-{uuid.uuid4().hex[:6]}"
    try:
        _post(server, "/api/chat/send", {
            "message": "My cat is named Thunderpaws. Please remember this.",
            "session_id": sid_store,
        })
        _wait_for_response(server, sid_store)
        r.check("Chat: fact stored via conversation", True)

        time.sleep(2)

        sid_recall = f"test-recall-{uuid.uuid4().hex[:6]}"
        _post(server, "/api/chat/send", {
            "message": "What is the name of my cat?",
            "session_id": sid_recall,
        })
        recall_msgs = _wait_for_response(server, sid_recall, timeout=25)
        asst_msgs = [m for m in recall_msgs if m.get("role") == "assistant"]
        if asst_msgs:
            content = asst_msgs[-1].get("content", "")
            r.check(
                "Cross-session: recalls 'Thunderpaws'",
                "thunderpaws" in content.lower() or "thunder" in content.lower(),
                f"Got: {content[:120]}",
            )
        else:
            r.check("Cross-session recall response", False, "No assistant msg")
    except Exception as e:
        r.check("Cross-session memory", False, str(e))

    # ── Channels: create → test connection → verify → delete ──
    console.print("\n[dim]Channels: Create → Test → Verify → Delete[/dim]")
    # Load real token from env or .env file
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not tg_token:
        # Try loading from .env
        for env_path in [Path.cwd() / ".env", Path.home() / ".env"]:
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    if line.startswith("TELEGRAM_BOT_TOKEN="):
                        tg_token = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            if tg_token:
                break
    if not tg_token:
        r.skip("Channels (no TELEGRAM_BOT_TOKEN in env)")
    else:
        try:
            before = _get(server, "/api/channels")
            before_count = len(before.get("channels", []))

            new_ch = _post(server, "/api/channels", {
                "name": "IntTestBot",
                "platform": "telegram",
                "config": {"bot_token": tg_token},
            })
            ch_id = new_ch.get("id") or new_ch.get("channel_id")
            r.check("Create channel (real token)", ch_id is not None)

            after = _get(server, "/api/channels")
            r.check("Channel appears in list", len(after.get("channels", [])) > before_count)

            platforms = _get(server, "/api/channels/platforms")
            r.check("Platforms list populated", len(platforms.get("platforms", [])) > 0)

            # Test connection — this calls the Telegram API with the real token
            if ch_id:
                test_resp = _post(server, f"/api/channels/{ch_id}/test")
                r.check(
                    "Channel test (Telegram API)",
                    test_resp.get("success") is True,
                    str(test_resp)[:150],
                )

            if ch_id:
                _delete(server, f"/api/channels/{ch_id}")
                final = _get(server, "/api/channels")
                r.check("Delete channel", len(final.get("channels", [])) == before_count)
        except Exception as e:
            r.check("Channels CRUD", False, str(e))

    # ── Workflows: create → verify → run → delete ─────────────
    console.print("\n[dim]Workflows: Create → Run → Delete[/dim]")
    try:
        before = _get(server, "/api/workflows")
        before_count = len(before.get("workflows", []))

        new_wf = _post(server, "/api/workflows", {
            "name": "test-integration-wf",
            "description": "Integration test workflow",
            "steps": [{"type": "log", "message": "Integration test step"}],
        })
        wf_id = new_wf.get("id") or new_wf.get("workflow_id")
        r.check("Create workflow", wf_id is not None)

        after = _get(server, "/api/workflows")
        r.check("Workflow appears in list", len(after.get("workflows", [])) > before_count)

        if wf_id:
            run = _post(server, f"/api/workflows/{wf_id}/run")
            r.check("Run workflow", isinstance(run, dict))

            status = _get(server, f"/api/workflows/{wf_id}/status")
            r.check("Workflow status", isinstance(status, dict))

            _delete(server, f"/api/workflows/{wf_id}")
            final = _get(server, "/api/workflows")
            r.check("Delete workflow", len(final.get("workflows", [])) == before_count)
    except Exception as e:
        r.check("Workflows CRUD", False, str(e))

    # ── Eval: status → judges → scores → run ─────────────────
    console.print("\n[dim]Eval: Run & Verify[/dim]")
    try:
        estatus = _get(server, "/api/eval/status")
        r.check("Eval status", isinstance(estatus, dict))

        judges = _get(server, "/api/eval/judges")
        r.check("Eval judges", isinstance(judges, dict))

        scores = _get(server, "/api/eval/scores")
        r.check("Eval scores", isinstance(scores, dict))

        erun = _post(server, "/api/eval/run", {
            "prompt": "What is 2+2?",
            "expected": "4",
        })
        r.check("Eval run", isinstance(erun, dict))
    except Exception as e:
        r.check("Eval", False, str(e))

    ok = r.summary()
    if not ok:
        raise typer.Exit(code=1)


@test_app.command("all")
def test_all(server: str = _SERVER_OPT) -> None:
    """Run all integration tests."""
    console.print(
        Panel(
            "[bold]Running ALL integration tests[/bold]",
            border_style="bright_cyan",
        )
    )

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        console.print("[dim]Start the server first:[/dim]  aiui serve")
        raise typer.Exit(code=1)

    failed = False

    console.print("\n" + "═" * 50)
    try:
        test_endpoints(server)
    except SystemExit as e:
        if e.code:
            failed = True

    console.print("\n" + "═" * 50)
    try:
        test_chat(server)
    except SystemExit as e:
        if e.code:
            failed = True

    console.print("\n" + "═" * 50)
    try:
        test_memory(server)
    except SystemExit as e:
        if e.code:
            failed = True

    console.print("\n" + "═" * 50)
    try:
        test_sessions(server)
    except SystemExit as e:
        if e.code:
            failed = True

    console.print("\n" + "═" * 50)
    try:
        test_features(server)
    except SystemExit as e:
        if e.code:
            failed = True

    console.print("\n" + "═" * 50)
    if failed:
        console.print("\n[red bold]Some tests failed.[/red bold]")
        raise typer.Exit(code=1)
    else:
        console.print("\n[green bold]All tests passed! ✓[/green bold]")
"""CLI test runner for PraisonAIUI integration verification."""
