"""PraisonAI Agent tools for Video Studio — edit scene.yaml, lint, render."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from praisonaiui.features.jobs import JobStatus
from praisonaiui.features.video import _video_jobs
from praisonaiui.sync import AsyncContext
from praisonaiui.video_client import VideoEngineError
from praisonaiui.video_client import lint as video_lint
from praisonaiui.video_client import render as engine_render
from praisonaiui.video_projects import (
    create_project,
    list_projects,
    read_scene_yaml,
    reset_scene_yaml,
    resolve_project,
    save_scene_yaml,
)
from praisonaiui.video_studio_sync import mark_project_refresh


def _resolve_project_id(project_id: str | None) -> str:
    if project_id:
        return project_id
    import os

    env_id = os.environ.get("VIDEO_STUDIO_PROJECT_ID", "").strip()
    if env_id:
        return env_id
    projects = list_projects()
    if len(projects) == 1:
        return projects[0]["id"]
    if projects:
        return projects[0]["id"]
    created = create_project("Agent video")
    return created["id"]


def _run_coro(coro):
    """Run async video helpers from sync agent tools."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with AsyncContext() as ctx:
        return ctx.run(coro)


async def _lint_async(project_id: str, yaml_text: str | None = None) -> list[dict[str, Any]]:
    if yaml_text is not None:
        return await video_lint(yaml_text=yaml_text)
    path = str(resolve_project(project_id) / "scene.yaml")
    return await video_lint(path=path)


def video_list_projects() -> str:
    """List Video Studio projects (id and path)."""
    items = list_projects()
    if not items:
        return "No projects. Use video_create_project first."
    return "\n".join(f"{p['id']}: {p.get('name', p['id'])} @ {p['path']}" for p in items)


def video_create_project(name: str = "Agent video") -> str:
    """Create a new video project with default hello scene.yaml."""
    created = create_project(name)
    mark_project_refresh(created["id"])
    return f"Created project {created['id']} at {created['path']}"


def video_get_scene(project_id: str | None = None) -> str:
    """Read scene.yaml for a video project."""
    pid = _resolve_project_id(project_id)
    yaml_text = read_scene_yaml(pid)
    path = resolve_project(pid)
    return f"Project: {pid}\nPath: {path}\n\n{yaml_text}"


def video_update_scene(yaml: str, project_id: str | None = None) -> str:
    """Save scene.yaml for a video project. Must include schemaVersion: 1 and valid composition/scene."""
    pid = _resolve_project_id(project_id)
    save_scene_yaml(pid, yaml)
    mark_project_refresh(pid)
    return f"Updated scene.yaml for project {pid}. Run video_lint_scene before render."


def video_reset_scene(project_id: str | None = None) -> str:
    """Restore default hello scene.yaml for a project."""
    pid = _resolve_project_id(project_id)
    reset_scene_yaml(pid)
    mark_project_refresh(pid)
    return f"Reset scene to default hello template for project {pid}."


def video_lint_scene(project_id: str | None = None, yaml: str | None = None) -> str:
    """Lint scene YAML (file or inline). Returns issues or 'No issues.'"""
    pid = _resolve_project_id(project_id)
    try:
        issues = _run_coro(_lint_async(pid, yaml))
    except VideoEngineError as exc:
        return f"Lint failed: {exc}"
    if not issues:
        return "No issues."
    lines = [f"{i.get('severity', 'error')}: {i.get('path', '')}: {i.get('message', '')}" for i in issues]
    return "\n".join(lines)


def video_render_project(
    project_id: str | None = None, backend: str | None = None
) -> str:
    """Render project to exports/out.mp4 (blocks until complete or failure).

    backend: optional override (playwright | remotion). If omitted, uses render.backend from scene.yaml.
    """
    pid = _resolve_project_id(project_id)
    from praisonaiui.video_projects import read_render_backend_from_scene

    resolved_backend = (backend or "").strip() or read_render_backend_from_scene(pid)
    project_path = str(resolve_project(pid))
    out = str(resolve_project(pid) / "exports" / "out.mp4")

    async def _run() -> dict[str, Any]:
        import uuid

        from praisonaiui.features.jobs import get_job_store

        job_id = f"vid_{uuid.uuid4().hex[:12]}"
        now = time.time()
        job: dict[str, Any] = {
            "id": job_id,
            "type": "video_render",
            "status": JobStatus.RUNNING.value,
            "projectId": pid,
            "projectPath": project_path,
            "out": out,
            "test": False,
            "created_at": now,
            "started_at": now,
            "result": None,
            "error": None,
        }
        _video_jobs[job_id] = job
        get_job_store().save({**job, "prompt": f"Render {pid}"})
        try:
            result = await engine_render(
                project_path, out=out, test=False, backend=resolved_backend
            )
            job["status"] = JobStatus.SUCCEEDED.value
            job["result"] = {
                "artifactPath": result.get("artifactPath", out),
                "downloadUrl": f"/api/video/projects/{pid}/artifacts/out.mp4",
            }
        except VideoEngineError as exc:
            job["status"] = JobStatus.FAILED.value
            job["error"] = str(exc)
        except Exception as exc:
            job["status"] = JobStatus.FAILED.value
            job["error"] = str(exc)
        finally:
            job["completed_at"] = time.time()
            get_job_store().save({**job, "prompt": job.get("prompt", "")})
        return job

    job = _run_coro(_run())
    mark_project_refresh(pid)
    if job.get("status") == JobStatus.SUCCEEDED.value:
        url = (job.get("result") or {}).get("downloadUrl", "")
        return f"Render succeeded for {pid}. Play in Video Studio or download: {url}"
    return f"Render failed: {job.get('error', job.get('status'))}"


def get_video_agent_tools() -> list:
    """Tool callables for praisonaiagents.Agent(tools=...)."""
    return [
        video_list_projects,
        video_create_project,
        video_get_scene,
        video_update_scene,
        video_reset_scene,
        video_lint_scene,
        video_render_project,
    ]
