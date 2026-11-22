"""tools/preqa netfault.mjs: a connection idle past the limit goes silent; a new one works."""

import shutil
import socket
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

PREQA = Path(__file__).resolve().parents[2] / "tools" / "preqa"
sys.path.insert(0, str(PREQA))

from preqa import netfault  # noqa: E402

pytestmark = pytest.mark.skipif(not (shutil.which("node") and shutil.which("openssl")), reason="needs node and openssl")


class _Ok(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


def _get(sock) -> bytes:
    sock.sendall(b"GET /x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
    buf = b""
    while not buf.endswith(b"ok"):
        chunk = sock.recv(4096)
        if not chunk:
            break
        buf += chunk
    return buf


def test_idle_connection_is_frozen_and_a_new_one_works():
    up = ThreadingHTTPServer(("127.0.0.1", 0), _Ok)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    front = netfault.Front(f"http://127.0.0.1:{up.server_port}", freeze_ms=300)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.set_alpn_protocols(["http/1.1"])

    def connect():
        s = ctx.wrap_socket(socket.create_connection(("127.0.0.1", front.port), timeout=5))
        s.settimeout(2)
        return s

    try:
        a = connect()
        assert _get(a).endswith(b"ok")
        threading.Event().wait(0.8)  # idle past the limit
        with pytest.raises((TimeoutError, socket.timeout)):
            _get(a)  # no answer, no reset: the dead connection the browser cannot see
        b = connect()
        assert _get(b).endswith(b"ok")  # a fresh connection is fine
        assert front.count("freeze") >= 1
        a.close()
        b.close()
    finally:
        front.close()
        up.shutdown()
