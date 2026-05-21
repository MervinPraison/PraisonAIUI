"""HTTP + subprocess client for PraisonAI Video engine."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from praisonaiui.video_config import get_engine_token, get_engine_url

logger = logging.getLogger(__name__)


class VideoEngineError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 502,
        detail: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    token = get_engine_token()
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _request_urllib(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> Any:
    url = f"{get_engine_url()}{path}"
    data = json.dumps(json_body).encode("utf-8") if json_body is not None else None
    req = Request(url, data=data, headers=_headers(), method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        payload: dict[str, Any] | None = None
        try:
            payload = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            payload = None
        msg = payload.get("error", raw[:500]) if isinstance(payload, dict) else raw[:500]
        raise VideoEngineError(
            f"Video engine error {exc.code}: {msg}", exc.code, detail=payload
        ) from exc
    except URLError as exc:
        raise VideoEngineError(
            "Video engine not running. Start with: praisonai-video serve "
            "(or set VIDEO_ENGINE_URL)."
        ) from exc
    if not raw:
        return {}
    return json.loads(raw)


async def _request(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> Any:
    try:
        import httpx
    except ImportError:
        return await asyncio.to_thread(
            _request_urllib,
            method,
            path,
            json_body=json_body,
            timeout=timeout,
        )

    url = f"{get_engine_url()}{path}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(method, url, json=json_body, headers=_headers())
    if resp.status_code >= 400:
        payload: dict[str, Any] | None = None
        try:
            payload = resp.json()
        except Exception:
            payload = None
        msg = (
            payload.get("error", resp.text[:500])
            if isinstance(payload, dict)
            else resp.text[:500]
        )
        raise VideoEngineError(
            f"Video engine error {resp.status_code}: {msg}",
            resp.status_code,
            detail=payload,
        )
    if not resp.content:
        return {}
    return resp.json()


async def health() -> dict[str, Any]:
    try:
        return await _request("GET", "/v1/health", timeout=5.0)
    except VideoEngineError:
        return {"status": "unavailable", "mode": "subprocess"}


async def lint(*, path: str | None = None, yaml_text: str | None = None, variables: dict | None = None) -> list[dict]:
    body: dict[str, Any] = {}
    if path:
        body["path"] = path
    if yaml_text is not None:
        body["yaml"] = yaml_text
    if variables:
        body["variables"] = variables
    try:
        data = await _request("POST", "/v1/lint", json_body=body, timeout=30.0)
        return data.get("issues", [])
    except VideoEngineError:
        return await asyncio.to_thread(_lint_subprocess, path=path)


async def compile_scene(
    *, path: str | None = None, yaml_text: str | None = None, variables: dict | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if path:
        body["path"] = path
    if yaml_text is not None:
        body["yaml"] = yaml_text
    if variables:
        body["variables"] = variables
    try:
        return await _request("POST", "/v1/compile", json_body=body, timeout=30.0)
    except VideoEngineError as exc:
        if exc.status_code == 422 and exc.detail:
            return exc.detail
        raise VideoEngineError(
            "Video engine unavailable for compile. Start: praisonai-video serve",
            exc.status_code,
        ) from exc


async def preview_start(project_path: str) -> dict[str, Any]:
    try:
        return await _request(
            "POST",
            "/v1/preview/start",
            json_body={"projectPath": project_path},
            timeout=60.0,
        )
    except VideoEngineError:
        return {"url": None, "message": "Start preview via praisonai-video preview <scene.yaml>"}


async def render(
    project_path: str,
    *,
    out: str | None = None,
    test: bool = False,
    backend: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"projectPath": project_path, "test": test}
    if out:
        body["out"] = out
    if backend:
        body["backend"] = backend
    try:
        return await _request("POST", "/v1/render", json_body=body, timeout=10.0)
    except VideoEngineError:
        return await asyncio.to_thread(
            _render_subprocess, project_path, out=out, test=test, backend=backend
        )


async def test_scene(project_path: str) -> dict[str, Any]:
    try:
        return await _request(
            "POST",
            "/v1/test",
            json_body={"projectPath": project_path},
            timeout=300.0,
        )
    except VideoEngineError:
        return await asyncio.to_thread(_test_subprocess, project_path)


async def registry() -> dict[str, Any]:
    try:
        return await _request("GET", "/v1/registry", timeout=10.0)
    except VideoEngineError:
        return {
            "nodeTypes": ["sprite", "text", "rect", "image", "box", "sequence", "sceneRef"],
            "sceneRefs": ["lower-third", "terminal", "ken-burns"],
        }


def resolve_video_cli() -> list[str]:
    """CLI argv prefix: praisonai-video on PATH, or bun + local dist/cli.js."""
    override = os.environ.get("PRAISONAI_VIDEO_CLI", "").strip()
    if override:
        p = Path(override).expanduser()
        if p.suffix == ".js" and p.is_file():
            runner = shutil.which("bun") or shutil.which("node") or "bun"
            return [runner, str(p)]
        if p.is_file() or shutil.which(str(p)):
            return [str(p)]

    exe = shutil.which("praisonai-video")
    if exe:
        return [exe]

    for candidate in (
        Path.home() / "praisonai-video" / "packages" / "video-renderer" / "dist" / "cli.js",
        Path(__file__).resolve().parents[4]
        / "praisonai-video"
        / "packages"
        / "video-renderer"
        / "dist"
        / "cli.js",
    ):
        if candidate.is_file():
            runner = shutil.which("bun") or shutil.which("node") or "bun"
            return [runner, str(candidate)]

    raise VideoEngineError(
        "Video engine not available. Start the sidecar: "
        "cd ~/praisonai-video/packages/video-renderer && bun ./dist/cli.js serve --port 3921"
    )


def _cli() -> list[str]:
    return resolve_video_cli()


def _lint_subprocess(*, path: str | None) -> list[dict]:
    if not path:
        return [
            {
                "path": "(root)",
                "message": "Video engine not running and no scene path for CLI lint.",
                "severity": "error",
            }
        ]
    try:
        p = Path(path)
        if (p / "scene.yaml").is_file():
            cmd = [*_cli(), "project", "lint", str(p)]
        else:
            cmd = [*_cli(), "lint", path]
    except VideoEngineError as exc:
        return [{"path": "(root)", "message": str(exc), "severity": "error"}]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode == 0:
        return []
    msg = proc.stderr or proc.stdout or "lint failed"
    if "registry.npmjs.org/praisonai-video" in msg:
        return [
            {
                "path": "(root)",
                "message": "praisonai-video is not published to npm. Start the sidecar or set PRAISONAI_VIDEO_CLI.",
                "severity": "error",
            }
        ]
    return [{"path": "(root)", "message": msg, "severity": "error"}]


def _render_subprocess(
    project_path: str,
    *,
    out: str | None,
    test: bool,
    backend: str | None = None,
) -> dict[str, Any]:
    cmd = resolve_video_cli()
    if test:
        cmd.extend(["project", "test", project_path])
    else:
        cmd.extend(["project", "render", project_path])
        if out:
            cmd.extend(["--out", out])
    if backend:
        cmd.extend(["--backend", backend])
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise VideoEngineError(proc.stderr or proc.stdout or "render failed")
    return {"status": "succeeded", "artifactPath": out or str(Path(project_path) / "exports" / "out.mp4")}


def _test_subprocess(project_path: str) -> dict[str, Any]:
    proc = subprocess.run(
        [*resolve_video_cli(), "project", "test", project_path],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "passed": proc.returncode == 0,
        "output": proc.stdout + proc.stderr,
    }
