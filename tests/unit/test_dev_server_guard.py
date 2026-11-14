"""``aiui dev`` writes example YAML files: it must not be drivable cross-site.

It bound every interface and its POST /api/yaml accepted a ``text/plain``
body from any Origin (no CORS preflight), so any web page could rewrite an
example file.
"""

from __future__ import annotations

import socketserver

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import _dev_request_refusal
from praisonaiui.cli import app as cli_app

LOCAL = ("127.0.0.1", 8205)


def _h(**headers):
    return [(k.replace("_", "-"), v) for k, v in headers.items()]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("AIUI_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("AIUI_ALLOWED_ORIGINS", raising=False)


def test_cross_site_text_plain_post_refused():
    r = _dev_request_refusal(
        "POST",
        "/api/yaml",
        _h(Host="127.0.0.1:8205", Origin="https://evil.example", Content_Type="text/plain"),
        LOCAL,
    )
    assert r is not None and r[0] == 403


def test_same_origin_post_must_be_json():
    same = dict(Host="127.0.0.1:8205", Origin="http://127.0.0.1:8205")
    assert _dev_request_refusal("POST", "/api/yaml", _h(**same, Content_Type="text/plain"), LOCAL)[0] == 415
    assert (
        _dev_request_refusal(
            "POST", "/api/yaml", _h(**same, Content_Type="application/json; charset=utf-8"), LOCAL
        )
        is None
    )


def test_cross_site_get_of_the_api_refused_but_pages_load():
    hdrs = _h(Host="127.0.0.1:8205", Sec_Fetch_Site="cross-site")
    assert _dev_request_refusal("GET", "/api/switch", hdrs, LOCAL)[0] == 403
    assert _dev_request_refusal("GET", "/site/", hdrs, LOCAL) is None
    same = _h(Host="localhost:8205", Sec_Fetch_Site="same-origin")
    assert _dev_request_refusal("GET", "/api/yaml", same, LOCAL) is None


def test_rebound_host_refused():
    hdrs = _h(Host="rebind.attacker.example:8205", Origin="http://rebind.attacker.example:8205")
    assert _dev_request_refusal("GET", "/api/yaml", hdrs, LOCAL)[0] == 400


def test_curl_without_origin_still_works():
    hdrs = _h(Host="127.0.0.1:8205", Content_Type="application/json")
    assert _dev_request_refusal("POST", "/api/yaml", hdrs, LOCAL) is None


def test_dev_binds_loopback_by_default(tmp_path, monkeypatch):
    ex = tmp_path / "examples" / "one"
    ex.mkdir(parents=True)
    (ex / "aiui.template.yaml").write_text("schemaVersion: 1\nsite:\n  title: T\n")
    bound = []

    class _FakeServer:
        def __init__(self, address, handler):
            bound.append(address)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def serve_forever(self):
            raise KeyboardInterrupt

    monkeypatch.setattr(socketserver, "TCPServer", _FakeServer)
    monkeypatch.setattr("webbrowser.open", lambda *a, **k: True)
    monkeypatch.setattr("subprocess.run", lambda *a, **k: type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})())
    result = CliRunner().invoke(cli_app, ["dev", "--examples", str(tmp_path / "examples"), "--port", "8205"])
    assert result.exit_code == 0, result.output
    assert bound and bound[0][0] == "127.0.0.1"
