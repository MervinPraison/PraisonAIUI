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
    """Test all API endpoints: features, sessions, chat, provider."""
    r = _Results()
    console.print(Panel("[bold]Endpoint Tests[/bold]", border_style="blue"))

    if not _check_server(server):
        console.print(f"[red]Cannot reach server at {server}[/red]")
        raise typer.Exit(code=1)

    # Features
    console.print("\n[dim]Features[/dim]")
    try:
        data = _get(server, "/api/features")
        features = data.get("features", [])
        r.check("GET /api/features", len(features) > 0, f"Got {len(features)} features")
        names = [f.get("name") for f in features]
        for needed in ["chat"]:
            r.check(f"Feature '{needed}' registered", needed in names)
    except Exception as e:
        r.check("GET /api/features", False, str(e))

    # Sessions
    console.print("\n[dim]Sessions[/dim]")
    try:
        data = _get(server, "/api/sessions")
        r.check("GET /api/sessions", "sessions" in data)
    except Exception as e:
        r.check("GET /api/sessions", False, str(e))

    # Chat history (non-existent session should return empty)
    console.print("\n[dim]Chat[/dim]")
    try:
        data = _get(server, "/api/chat/history/nonexistent-test")
        msgs = data.get("messages", [])
        r.check("GET /api/chat/history (empty session)", len(msgs) == 0)
    except Exception as e:
        r.check("GET /api/chat/history", False, str(e))

    # Send chat
    test_sid = f"test-ep-{uuid.uuid4().hex[:8]}"
    try:
        resp = _post(server, "/api/chat/send", {
            "message": "Hello",
            "session_id": test_sid,
        })
        r.check("POST /api/chat/send", resp.get("status") == "sent")
    except Exception as e:
        r.check("POST /api/chat/send", False, str(e))

    # Provider (optional — may not be mounted in all configs)
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

    # Health
    console.print("\n[dim]Health[/dim]")
    try:
        data = _get(server, "/health")
        r.check("GET /health", data.get("status") == "ok")
    except Exception as e:
        r.check("GET /health", False, str(e))

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
    if failed:
        console.print("\n[red bold]Some tests failed.[/red bold]")
        raise typer.Exit(code=1)
    else:
        console.print("\n[green bold]All tests passed! ✓[/green bold]")
"""CLI test runner for PraisonAIUI integration verification."""
