"""Compressed static files without compressing on the event loop each time.

``gzip_static`` wraps a static ASGI app in Starlette's ``GZipMiddleware``,
which compresses every response again, inside the event loop.
``CachedGzipStaticFiles`` serves a file's gzip bytes from a small in-process
cache keyed by (path, mtime, size), compressed once in a worker thread, so a
cold page load costs a dict lookup per chunk instead of 10-20 ms of CPU.
Its responses carry ``Content-Encoding``, which ``GZipMiddleware`` passes
through untouched, so the two can be stacked.
"""

from __future__ import annotations

import gzip
import os
import threading
from collections import OrderedDict
from typing import Any

from starlette.datastructures import Headers
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

#: Responses smaller than this are sent as they are (same as GZipMiddleware).
MIN_SIZE = 1024
#: Upper bound of the cache (the whole bundle is about 3 MB gzipped).
MAX_CACHE_BYTES = 64 * 1024 * 1024

_COMPRESSIBLE = (
    "text/",
    "application/javascript",
    "application/json",
    "application/manifest+json",
    "application/xml",
    "image/svg+xml",
)

_cache: "OrderedDict[tuple[str, int, int], bytes]" = OrderedDict()
_cache_bytes = 0
_lock = threading.Lock()


def accepts_gzip(scope: dict) -> bool:
    return "gzip" in Headers(scope=scope).get("accept-encoding", "")


def compressible(media_type: str | None) -> bool:
    return bool(media_type) and media_type.startswith(_COMPRESSIBLE)


def gzip_file(path: str, mtime_ns: int, size: int) -> bytes:
    """The gzip bytes of *path*, compressed once per (path, mtime, size)."""
    global _cache_bytes
    key = (path, mtime_ns, size)
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    with open(path, "rb") as fh:
        body = gzip.compress(fh.read(), compresslevel=6, mtime=0)
    with _lock:
        if key not in _cache:
            _cache[key] = body
            _cache_bytes += len(body)
            while _cache_bytes > MAX_CACHE_BYTES and len(_cache) > 1:
                _, old = _cache.popitem(last=False)
                _cache_bytes -= len(old)
    return body


def clear_cache() -> None:
    global _cache_bytes
    with _lock:
        _cache.clear()
        _cache_bytes = 0


class CachedGzipStaticFiles(StaticFiles):
    """``StaticFiles`` that answers ``Accept-Encoding: gzip`` from the cache.

    Only a full ``200`` GET of a compressible file of at least ``MIN_SIZE``
    bytes is compressed. ``304``, ``HEAD`` and ``Range`` requests (``206``
    bodies must match ``Content-Range`` in the identity encoding) go through
    ``StaticFiles`` unchanged, and ETag / Last-Modified / Cache-Control are
    kept.
    """

    async def get_response(self, path: str, scope: Any) -> Response:
        response = await super().get_response(path, scope)
        return await gzip_file_response(response, scope)


class NoCacheStaticFiles(CachedGzipStaticFiles):
    """A built site's files: fixed names change on every build, so revalidate."""

    def file_response(self, full_path, stat_result, scope, status_code: int = 200) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response


async def gzip_file_response(response: Response, scope: Any) -> Response:
    """Swap a ``FileResponse`` for its cached gzip bytes when the client takes them."""
    if not (
        isinstance(response, FileResponse)
        and response.status_code == 200
        and scope.get("method") == "GET"
        and response.stat_result is not None
        and response.stat_result.st_size >= MIN_SIZE
        and compressible(response.media_type)
        and "range" not in Headers(scope=scope)
        and accepts_gzip(scope)
    ):
        return response
    from starlette.concurrency import run_in_threadpool

    st = response.stat_result
    body = await run_in_threadpool(gzip_file, os.fspath(response.path), st.st_mtime_ns, st.st_size)
    headers = {
        k: v for k, v in response.headers.items() if k not in ("content-length", "accept-ranges")
    }
    headers["content-encoding"] = "gzip"
    headers["vary"] = "Accept-Encoding"
    return Response(body, status_code=200, headers=headers, media_type=response.media_type)


def gzip_body(scope: dict, response: Response) -> Response:
    """Compress a small dynamic HTML/JSON response in place (never SSE).

    For handlers that build their body in memory (the page HTML, the shell
    manifest, ``/api/pages``); a few kB compress in well under a millisecond.
    """
    body = getattr(response, "body", None)
    if (
        not body
        or len(body) < MIN_SIZE
        or "content-encoding" in response.headers
        or not compressible(response.media_type)
        or not accepts_gzip(scope)
    ):
        return response
    response.body = gzip.compress(body, compresslevel=6, mtime=0)
    response.headers["content-length"] = str(len(response.body))
    response.headers["content-encoding"] = "gzip"
    response.headers["vary"] = "Accept-Encoding"
    return response


def gzip_static(app: Any, minimum_size: int = MIN_SIZE, compresslevel: int = 6) -> Any:
    """Wrap a static-file ASGI app so its responses are gzip-compressed.

    Only static mounts are wrapped (``/assets``, ``/plugins``, ``aiui
    serve``), so SSE and WebSocket routes are never touched on any Starlette
    version. Range requests pass through uncompressed: a ``206`` body must
    match its ``Content-Range`` in the identity encoding. Responses that are
    already compressed (``CachedGzipStaticFiles``) pass through as they are.
    """
    from starlette.middleware.gzip import GZipMiddleware

    gz = GZipMiddleware(app, minimum_size=minimum_size, compresslevel=compresslevel)

    async def _gzip_static_app(scope, receive, send):
        if scope["type"] == "http" and not any(
            k.lower() == b"range" for k, _ in scope.get("headers", ())
        ):
            await gz(scope, receive, send)
        else:
            await app(scope, receive, send)

    _gzip_static_app.inner = app  # type: ignore[attr-defined]
    return _gzip_static_app
