"""Optional HTTP proxy: aiui ``/api/jobs/*`` → external ``/api/v1/runs/*``."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

logger = logging.getLogger(__name__)

_jobs_proxy_url: Optional[str] = None

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


def set_jobs_proxy(url: str | None) -> None:
    """Forward ``/api/jobs/*`` to ``{url}/api/v1/runs/*`` (split jobs server)."""
    global _jobs_proxy_url
    _jobs_proxy_url = url.rstrip("/") if url else None


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
        if key.lower() not in _HOP_HEADERS:
            out[key] = value
    return out


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

    suffix = request.url.path.removeprefix("/api/jobs") or ""
    target = f"{upstream}/api/v1/runs{suffix}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

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
