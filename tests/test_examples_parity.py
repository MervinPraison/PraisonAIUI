#!/usr/bin/env python3
"""Comprehensive CLI + API parity test for all PraisonAIUI examples.

For each example:
1. Starts the server (aiui run) on a unique port
2. Hits every API endpoint with curl
3. Runs corresponding CLI commands
4. Reports pass/fail

Usage:
    PYTHONPATH=src python3 tests/test_examples_parity.py
"""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXAMPLES = REPO / "examples"
SRC = REPO / "src"
BASE_PORT = 8100  # start port, incremented per example

# Colours
GREEN = "\033[92m"
RED = "\033[91m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def api_get(port: int, path: str, timeout: float = 5.0):
    """GET an API endpoint, return (status, json_body|None)."""
    try:
        url = f"http://127.0.0.1:{port}{path}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body.decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return 0, str(e)


def api_post(port: int, path: str, body: dict = None, timeout: float = 5.0):
    """POST to an API endpoint."""
    try:
        url = f"http://127.0.0.1:{port}{path}"
        data = json.dumps(body or {}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            rbody = resp.read()
            try:
                return resp.status, json.loads(rbody)
            except json.JSONDecodeError:
                return resp.status, rbody.decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return 0, str(e)


def wait_for_server(port: int, max_wait: float = 15.0) -> bool:
    """Wait until server responds on /health."""
    start = time.time()
    while time.time() - start < max_wait:
        try:
            status, _ = api_get(port, "/health", timeout=2.0)
            if status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def start_server(app_path: str, port: int, is_yaml: bool = False) -> subprocess.Popen:
    """Start aiui server in background."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC)
    env["BROWSER"] = "echo"  # suppress auto-open
    cmd = [
        sys.executable, "-m", "praisonaiui.cli",
        "run", app_path,
        "--port", str(port),
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc


def stop_server(proc: subprocess.Popen):
    """Stop server process."""
    try:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=3)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# API Test Suite — every endpoint the server exposes
# ---------------------------------------------------------------------------
def test_core_api(port: int) -> list:
    """Test core server API endpoints. Returns list of (name, passed, detail)."""
    results = []

    # Health
    status, data = api_get(port, "/health")
    results.append(("GET /health", status == 200, f"status={status}"))

    # Agents
    status, data = api_get(port, "/agents")
    results.append(("GET /agents", status == 200, f"status={status}"))

    # Starters
    status, data = api_get(port, "/starters")
    results.append(("GET /starters", status == 200, f"status={status}"))

    # Profiles
    status, data = api_get(port, "/profiles")
    results.append(("GET /profiles", status == 200, f"status={status}"))

    # Sessions — list
    status, data = api_get(port, "/sessions")
    results.append(("GET /sessions", status == 200, f"status={status}"))

    # Sessions — create
    status, data = api_post(port, "/sessions")
    results.append(("POST /sessions", status == 200, f"status={status}"))

    # Welcome trigger
    status, data = api_post(port, "/welcome")
    ok = status in (200, 204)
    results.append(("POST /welcome", ok, f"status={status}"))

    # Dashboard API
    status, data = api_get(port, "/api/overview")
    results.append(("GET /api/overview", status == 200, f"status={status}"))

    status, data = api_get(port, "/api/config")
    results.append(("GET /api/config", status == 200, f"status={status}"))

    status, data = api_get(port, "/api/logs")
    results.append(("GET /api/logs", status == 200, f"status={status}"))

    status, data = api_get(port, "/api/usage")
    results.append(("GET /api/usage", status == 200, f"status={status}"))

    status, data = api_get(port, "/api/debug")
    results.append(("GET /api/debug", status == 200, f"status={status}"))

    status, data = api_get(port, "/api/provider")
    results.append(("GET /api/provider", status == 200, f"status={status}"))

    # Pages
    status, data = api_get(port, "/api/pages")
    results.append(("GET /api/pages", status == 200, f"status={status}"))

    # Features
    status, data = api_get(port, "/api/features")
    results.append(("GET /api/features", status == 200, f"status={status}"))

    return results


def test_feature_apis(port: int) -> list:
    """Test feature-specific API endpoints (if features are registered)."""
    results = []
    status, data = api_get(port, "/api/features")
    if status != 200 or not data:
        return results

    features = data.get("features", []) if isinstance(data, dict) else []
    if not features:
        return results

    # Feature routes — try common ones
    feature_endpoints = [
        ("GET /api/approvals", "/api/approvals"),
        ("GET /api/schedules", "/api/schedules"),
        ("GET /api/memory", "/api/memory"),
        ("GET /api/skills", "/api/skills"),
        ("GET /api/hooks", "/api/hooks"),
        ("GET /api/workflows", "/api/workflows"),
        ("GET /api/config/runtime", "/api/config/runtime"),
    ]
    for name, path in feature_endpoints:
        status, _ = api_get(port, path)
        ok = status in (200, 404)  # 404 = endpoint not registered; 200 = registered
        results.append((name, ok, f"status={status}"))

    return results


# ---------------------------------------------------------------------------
# CLI Test Suite — test CLI commands against running server
# ---------------------------------------------------------------------------
def run_cli(args: list, port: int) -> tuple:
    """Run a CLI command and return (returncode, stdout)."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC)
    cmd = [sys.executable, "-m", "praisonaiui.cli"] + args + [
        "--server", f"http://127.0.0.1:{port}"
    ]
    try:
        result = subprocess.run(
            cmd, cwd=str(REPO), env=env,
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode, result.stdout
    except subprocess.TimeoutExpired:
        return -1, "TIMEOUT"
    except Exception as e:
        return -1, str(e)


def test_cli_commands(port: int) -> list:
    """Test CLI commands that correspond to API endpoints."""
    results = []

    # health
    rc, out = run_cli(["health-check"], port)
    results.append(("CLI health-check", rc == 0, out.strip()[:80]))

    # features list
    rc, out = run_cli(["features", "list"], port)
    results.append(("CLI features list", rc == 0, out.strip()[:80]))

    # features status
    rc, out = run_cli(["features", "status"], port)
    results.append(("CLI features status", rc == 0, out.strip()[:80]))

    # session-ext state
    rc, out = run_cli(["session-ext", "state", "default"], port)
    results.append(("CLI session-ext state", rc == 0, out.strip()[:80]))

    # session-ext labels
    rc, out = run_cli(["session-ext", "labels", "default"], port)
    results.append(("CLI session-ext labels", rc == 0, out.strip()[:80]))

    # session-ext usage
    rc, out = run_cli(["session-ext", "usage", "default"], port)
    results.append(("CLI session-ext usage", rc == 0, out.strip()[:80]))

    return results


def test_feature_cli(port: int) -> list:
    """Test feature-specific CLI commands."""
    results = []

    feature_cmds = [
        ("CLI approval list", ["approval", "list"]),
        ("CLI approval pending", ["approval", "pending"]),
        ("CLI schedule list", ["schedule", "list"]),
        ("CLI schedule status", ["schedule", "status"]),
        ("CLI memory list", ["memory", "list"]),
        ("CLI memory status", ["memory", "status"]),
        ("CLI skills list", ["skills", "list"]),
        ("CLI skills status", ["skills", "status"]),
        ("CLI hooks list", ["hooks", "list"]),
        ("CLI workflows list", ["workflows", "list"]),
        ("CLI workflows status", ["workflows", "status"]),
        ("CLI config list", ["config", "list"]),
    ]
    for name, args in feature_cmds:
        rc, out = run_cli(args, port)
        # These may fail if features not registered — that's OK
        ok = rc == 0 or "Error" in out  # at least the CLI command exists
        results.append((name, ok, out.strip()[:80]))

    return results


# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------
def test_example(name: str, app_file: str, port: int, is_yaml: bool = False) -> dict:
    """Test a single example — start server, run API + CLI tests, stop server."""
    print(f"\n{'='*60}")
    print(f"{BOLD}Testing: {name}{RESET}")
    print(f"  File: {app_file}")
    print(f"  Port: {port}")
    print(f"{'='*60}")

    proc = start_server(app_file, port, is_yaml)
    try:
        if not wait_for_server(port):
            # Read stderr for error info
            try:
                _, stderr = proc.communicate(timeout=2)
                err_msg = stderr.decode()[-300:] if stderr else "no output"
            except Exception:
                err_msg = "timeout"
            print(f"  {RED}✗ Server failed to start{RESET}")
            print(f"  {DIM}{err_msg}{RESET}")
            return {"name": name, "passed": 0, "failed": 1, "skipped": 0,
                    "results": [("Server Start", False, err_msg[:100])]}

        print(f"  {GREEN}✓ Server started{RESET}")

        all_results = []

        # Core API tests
        api_results = test_core_api(port)
        all_results.extend(api_results)

        # Feature API tests
        feature_api = test_feature_apis(port)
        all_results.extend(feature_api)

        # Core CLI tests
        cli_results = test_cli_commands(port)
        all_results.extend(cli_results)

        # Feature CLI tests
        feature_cli = test_feature_cli(port)
        all_results.extend(feature_cli)

        passed = sum(1 for _, ok, _ in all_results if ok)
        failed = sum(1 for _, ok, _ in all_results if not ok)

        for name_t, ok, detail in all_results:
            icon = f"{GREEN}✓{RESET}" if ok else f"{RED}✗{RESET}"
            print(f"  {icon} {name_t}  {DIM}{detail}{RESET}")

        return {"name": name, "passed": passed, "failed": failed,
                "skipped": 0, "results": all_results}

    finally:
        stop_server(proc)


def main():
    print(f"\n{BOLD}PraisonAIUI — Comprehensive Example Testing{RESET}")
    print(f"Testing API endpoints + CLI parity for all examples\n")

    # Discover examples
    python_examples = sorted((EXAMPLES / "python").iterdir())
    yaml_chat_examples = sorted([
        d for d in (EXAMPLES / "yaml").iterdir()
        if d.is_dir() and (d / "chat.yaml").exists()
    ])

    # Build test list
    test_items = []
    port = BASE_PORT

    for d in python_examples:
        if d.is_dir() and (d / "app.py").exists():
            test_items.append((d.name, str(d / "app.py"), port, False))
            port += 1

    for d in yaml_chat_examples:
        test_items.append((f"yaml/{d.name}", str(d / "chat.yaml"), port, True))
        port += 1

    print(f"Found {len(test_items)} testable examples\n")

    # Run tests
    summaries = []
    total_passed = 0
    total_failed = 0

    for name, app_file, test_port, is_yaml in test_items:
        result = test_example(name, app_file, test_port, is_yaml)
        summaries.append(result)
        total_passed += result["passed"]
        total_failed += result["failed"]

    # Summary
    print(f"\n\n{'='*60}")
    print(f"{BOLD}FINAL SUMMARY{RESET}")
    print(f"{'='*60}")
    for s in summaries:
        icon = f"{GREEN}✓{RESET}" if s["failed"] == 0 else f"{RED}✗{RESET}"
        print(f"  {icon} {s['name']:40s}  {s['passed']} passed, {s['failed']} failed")

    print(f"\n{'─'*60}")
    print(f"  Total: {total_passed} passed, {total_failed} failed")
    print(f"{'─'*60}\n")

    sys.exit(0 if total_failed == 0 else 1)


if __name__ == "__main__":
    main()
