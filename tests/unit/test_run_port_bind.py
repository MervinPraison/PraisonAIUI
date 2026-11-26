"""``aiui run`` binds its port before printing the URL and serves that socket.

Two apps started together used to pick the same "free" port: the probe closed
its socket, the URL was printed, and the second app took the port before
uvicorn bound it (``[Errno 48] address already in use``).
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import textwrap
import urllib.request
from pathlib import Path

import pytest
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui import cli


@pytest.fixture
def taken_port():
    """A port another process is listening on."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        yield s.getsockname()[1]


def test_bind_free_port_skips_a_taken_port_and_keeps_the_socket(taken_port):
    sock, port = cli._bind_free_port("127.0.0.1", taken_port)
    try:
        assert port != taken_port
        assert sock.getsockname()[1] == port
        # The port is held: a second app starting now cannot take it.
        assert not cli._can_bind("127.0.0.1", port)
        other, other_port = cli._bind_free_port("127.0.0.1", port)
        other.close()
        assert other_port != port
        # It is listening already, so a client connects (queued until uvicorn serves).
        socket.create_connection(("127.0.0.1", port), timeout=2).close()
    finally:
        sock.close()


def test_bind_free_port_raises_when_the_range_is_full(taken_port):
    with pytest.raises(OSError, match="No available port"):
        cli._bind_free_port("127.0.0.1", taken_port, max_attempts=1)


def test_run_prints_the_port_it_bound_and_hands_uvicorn_that_socket(
    tmp_path, monkeypatch, taken_port
):
    app_file = tmp_path / "app.py"
    app_file.write_text("import praisonaiui as aiui\n", encoding="utf-8")
    served = []

    def fake_run(target, *, sock, **kw):
        # The socket is bound and listening when uvicorn gets it.
        socket.create_connection(("127.0.0.1", sock.getsockname()[1]), timeout=2).close()
        served.append((sock.getsockname()[1], kw["port"]))
        sock.close()

    monkeypatch.setattr(cli, "_run_uvicorn", fake_run)
    try:
        result = CliRunner().invoke(
            cli.app,
            ["run", str(app_file), "--datastore", "memory", "--port", str(taken_port)],
        )
    finally:
        srv.reset_state()
    assert result.exit_code == 0, result.output
    bound, passed = served[-1]
    assert bound == passed != taken_port
    assert f"http://127.0.0.1:{bound}" in result.output
    assert f"Port {taken_port} is already in use" in result.output


def test_run_uvicorn_serves_the_bound_socket(tmp_path):
    """The real uvicorn serves a socket bound before it starts (subprocess, so
    uvicorn owns the main thread's signal handlers)."""
    script = tmp_path / "serve.py"
    script.write_text(
        textwrap.dedent(
            """
            import sys
            from starlette.applications import Starlette
            from starlette.responses import PlainTextResponse
            from starlette.routing import Route
            from praisonaiui.cli import _bind_free_port, _run_uvicorn

            app = Starlette(routes=[Route("/", lambda r: PlainTextResponse("bound"))])
            sock, port = _bind_free_port("127.0.0.1", int(sys.argv[1]))
            print(port, flush=True)
            _run_uvicorn(app, sock=sock, host="127.0.0.1", port=port, log_level="warning")
            """
        ),
        encoding="utf-8",
    )
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        start = s.getsockname()[1]
    src = str(Path(cli.__file__).resolve().parent.parent)
    proc = subprocess.Popen(
        [sys.executable, str(script), str(start)],
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "PYTHONPATH": src},
    )
    try:
        port = int(proc.stdout.readline())
        body = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10).read()
        assert body == b"bound"
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_serve_binds_port_atomically_and_hands_uvicorn_the_socket(
    tmp_path, monkeypatch, taken_port
):
    out_dir = tmp_path / "site"
    out_dir.mkdir()
    (out_dir / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")
    served = []

    def fake_run(target, *, sock, **kw):
        socket.create_connection(("127.0.0.1", sock.getsockname()[1]), timeout=2).close()
        served.append((sock.getsockname()[1], kw["port"]))
        sock.close()

    monkeypatch.setattr(cli, "_run_uvicorn", fake_run)
    result = CliRunner().invoke(
        cli.app,
        ["serve", "--output", str(out_dir), "--port", str(taken_port), "--no-build", "--no-open"],
    )
    assert result.exit_code == 0, result.output
    bound, passed = served[-1]
    assert bound == passed != taken_port
    assert f"http://127.0.0.1:{bound}" in result.output


def test_concurrent_bind_free_port_returns_distinct_ports(taken_port):
    sockets = []
    ports = []
    try:
        for _ in range(4):
            sock, port = cli._bind_free_port("127.0.0.1", taken_port, max_attempts=20)
            sockets.append(sock)
            ports.append(port)
        assert taken_port not in ports
        assert len(set(ports)) == 4
    finally:
        for s in sockets:
            s.close()
