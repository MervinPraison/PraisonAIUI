"""Optional HTTP proxy: aiui ``/api/jobs/*`` → external ``/api/v1/runs/*``."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from urllib.parse import parse_qsl, quote, urlencode

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

if TYPE_CHECKING:  # httpx is only needed when the proxy is configured and used
    import httpx

logger = logging.getLogger(__name__)

_jobs_proxy_url: Optional[str] = None
_jobs_proxy_token: Optional[str] = None

_HOP_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)

# aiui's own credentials: they authenticate the caller to this server and are
# never sent upstream (ARCHITECTURE R8). ``set_jobs_proxy(url, token=...)``
# supplies the upstream credential instead.
_CREDENTIAL_HEADERS = frozenset({"authorization", "cookie", "x-api-key"})
_CREDENTIAL_HEADER_PREFIXES = ("proxy-", "x-auth-request-")
_CREDENTIAL_QUERY_KEYS = frozenset({"token", "api_key", "ticket"})

# RFC 3986 pchar minus "/": what a path segment may hold unescaped.
_SEGMENT_SAFE = "-._~!$&'()*+,;=:@"


def set_jobs_proxy(url: str | None, *, token: str | None = None) -> None:
    """Forward ``/api/jobs/*`` to ``{url}/api/v1/runs/*`` (split jobs server).

    The caller's aiui credentials (``Authorization``, cookies, ``X-API-Key``,
    ``?token=``) are not forwarded. Pass *token* to send
    ``Authorization: Bearer <token>`` to the jobs server.
    """
    global _jobs_proxy_url, _jobs_proxy_token
    _jobs_proxy_url = url.rstrip("/") if url else None
    _jobs_proxy_token = token if url else None


def get_jobs_proxy_url() -> Optional[str]:
    return _jobs_proxy_url


def _normalize_job(raw: Dict[str, Any]) -> Dict[str, Any]:
    job_id = raw.get("id") or raw.get("job_id")
    if job_id and "id" not in raw:
        raw = {**raw, "id": job_id}
    if job_id and "job_id" not in raw:
        raw = {**raw, "job_id": job_id}
    return raw


def _normalize_payload(data: Any) -> Any:
    if isinstance(data, dict):
        if "jobs" in data and isinstance(data["jobs"], list):
            data = {
                **data,
                "jobs": [_normalize_job(j) if isinstance(j, dict) else j for j in data["jobs"]],
            }
        elif "job_id" in data or ("id" in data and "status" in data):
            data = _normalize_job(data)
    return data


def _forward_headers(request: Request) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key, value in request.headers.items():
        low = key.lower()
        if (
            low in _HOP_HEADERS
            or low in _CREDENTIAL_HEADERS
            or low.startswith(_CREDENTIAL_HEADER_PREFIXES)
        ):
            continue
        out[key] = value
    if _jobs_proxy_token:
        out["Authorization"] = f"Bearer {_jobs_proxy_token}"
    return out


def _upstream_suffix(path: str) -> Optional[str]:
    """The part after ``/api/jobs``, re-encoded segment by segment.

    ``None`` when a segment is ``.`` or ``..`` (or holds a backslash), which
    would move the request off ``/api/v1/runs`` on the upstream host.
    Starlette has already percent-decoded the path, so ``%2e%2e`` arrives as
    ``..`` and ``%2F`` as ``/``.
    """
    suffix = path.removeprefix("/api/jobs")
    if not suffix:
        return ""
    if not suffix.startswith("/"):
        return None
    segments = suffix[1:].split("/")
    if any(seg in (".", "..") or "\\" in seg for seg in segments):
        return None
    return "/" + "/".join(quote(seg, safe=_SEGMENT_SAFE) for seg in segments)


def _upstream_query(query: str) -> str:
    """The query string without aiui credentials (unchanged when it has none)."""
    pairs = parse_qsl(query, keep_blank_values=True)
    if not any(k in _CREDENTIAL_QUERY_KEYS for k, _ in pairs):
        return query
    return urlencode([(k, v) for k, v in pairs if k not in _CREDENTIAL_QUERY_KEYS])


def _response_headers(response: httpx.Response) -> Dict[str, str]:
    return {
        k: v
        for k, v in response.headers.items()
        if k.lower() not in _HOP_HEADERS and k.lower() != "content-encoding"
    }


async def _proxy_jobs(request: Request) -> Response:
    upstream = _jobs_proxy_url
    if not upstream:
        return JSONResponse({"error": "Jobs proxy not configured"}, status_code=503)

    # scope["path"] is the decoded path; request.url.path would re-split it at a decoded "?".
    suffix = _upstream_suffix(request.scope["path"])
    if suffix is None:
        return JSONResponse({"error": "Invalid job path"}, status_code=400)
    target = f"{upstream}/api/v1/runs{suffix}"
    query = _upstream_query(request.scope.get("query_string", b"").decode("latin-1"))
    if query:
        target = f"{target}?{query}"

    try:
        import httpx  # lazy: a plain `pip install aiui` does not ship httpx
    except ImportError:
        return JSONResponse(
            {"error": "Jobs proxy needs the httpx package: pip install httpx"},
            status_code=501,
        )

    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream_resp = await client.request(
                request.method,
                target,
                headers=_forward_headers(request),
                content=body if body else None,
            )
    except httpx.HTTPError as exc:
        logger.warning("Jobs proxy upstream error: %s", exc)
        return JSONResponse({"error": f"Jobs upstream unreachable: {exc}"}, status_code=502)

    content_type = upstream_resp.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            payload = upstream_resp.json()
            payload = _normalize_payload(payload)
            return JSONResponse(
                payload,
                status_code=upstream_resp.status_code,
                headers=_response_headers(upstream_resp),
            )
        except json.JSONDecodeError:
            pass

    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers=_response_headers(upstream_resp),
        media_type=content_type or None,
    )


def jobs_proxy_routes() -> List[Route]:
    """Return proxy routes when ``set_jobs_proxy`` was called."""
    if not _jobs_proxy_url:
        return []
    return [
        Route("/api/jobs", _proxy_jobs, methods=["GET", "POST", "HEAD", "OPTIONS"]),
        Route("/api/jobs/{path:path}", _proxy_jobs, methods=["GET", "POST", "DELETE", "HEAD", "OPTIONS"]),
    ]
