"""Approval mutation auth (#311): remote callers must present credentials."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from praisonaiui.features.approvals import _require_approval_mutation_auth


async def _empty_receive():
    return {"type": "http.request", "body": b"", "more_body": False}


def _request(
    *,
    client_host: str = "203.0.113.7",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/approvals/abc/approve",
        "headers": headers or [],
        "query_string": b"",
        "client": (client_host, 44000),
    }
    return Request(scope, _empty_receive)


@pytest.mark.anyio
async def test_local_client_skips_auth():
    assert await _require_approval_mutation_auth(_request(client_host="127.0.0.1")) is None
    assert await _require_approval_mutation_auth(_request(client_host="testclient")) is None


@pytest.mark.anyio
async def test_remote_without_credentials_returns_401():
    resp = await _require_approval_mutation_auth(_request())
    assert resp is not None
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_remote_with_url_token_bearer_allowed(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "gate-secret")
    headers = [(b"authorization", b"Bearer gate-secret")]
    assert await _require_approval_mutation_auth(_request(headers=headers)) is None


@pytest.mark.anyio
async def test_remote_with_api_key_allowed():
    from praisonaiui.features.auth import _auth_config, generate_api_key

    key = generate_api_key()
    _auth_config["api_keys"][key] = {"name": "test", "created_at": 0}
    headers = [(b"x-api-key", key.encode())]
    assert await _require_approval_mutation_auth(_request(headers=headers)) is None
