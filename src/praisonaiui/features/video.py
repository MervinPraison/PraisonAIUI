"""Video Studio — proxy to PraisonAI Video engine + project CRUD."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from praisonaiui.features.jobs import JobStatus, get_job_store
from praisonaiui.video_client import (
    VideoEngineError,
    compile_scene,
    health,
    lint,
    preview_start,
    registry,
    test_scene,
)
from praisonaiui.video_client import (
    render as engine_render,
)
from praisonaiui.video_projects import (
    create_project,
    export_artifact_path,
    list_projects,
    read_scene_yaml,
    reset_scene_yaml,
    resolve_project,
    save_scene_yaml,
)
from praisonaiui.video_studio_sync import consume_project_refresh

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

_video_jobs: Dict[str, Dict[str, Any]] = {}


class VideoFeature(BaseFeatureProtocol):
    """PraisonAI Video Studio API (projects, lint, render jobs)."""

    feature_name = "video"
    feature_description = "Video Studio — YAML scenes via external render engine"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/video/health", self._health, methods=["GET"]),
            Route("/api/video/lint", self._lint, methods=["POST"]),
            Route("/api/video/compile", self._compile, methods=["POST"]),
            Route("/api/video/preview-url", self._preview_url, methods=["GET"]),
            Route("/api/video/preview/start", self._preview_start, methods=["POST"]),
            Route("/api/video/render", self._render, methods=["POST"]),
            Route("/api/video/test", self._test, methods=["POST"]),
            Route("/api/video/jobs/{job_id}", self._job_status, methods=["GET"]),
            Route("/api/video/registry", self._registry, methods=["GET"]),
            Route("/api/video/projects", self._projects_list, methods=["GET"]),
            Route("/api/video/projects", self._projects_create, methods=["POST"]),
            Route("/api/video/projects/{project_id}", self._project_get, methods=["GET"]),
            Route("/api/video/projects/{project_id}/scene", self._project_scene_put, methods=["PUT"]),
            Route("/api/video/projects/{project_id}/reset", self._project_reset, methods=["POST"]),
            Route(
                "/api/video/projects/{project_id}/artifacts/{filename}",
                self._artifact_download,
                methods=["GET"],
            ),
            Route(
                "/api/video/projects/{project_id}/studio-refresh",
                self._studio_refresh,
                methods=["GET"],
            ),
        ]

    async def health(self) -> Dict[str, Any]:
        engine = await health()
        return {"status": "ok", "feature": self.name, "engine": engine}

    async def _health(self, request: Request) -> JSONResponse:
        return JSONResponse(await self.health())

    async def _lint(self, request: Request) -> JSONResponse:
        body = await request.json()
        try:
            if body.get("yaml") is not None:
                issues = await lint(yaml_text=body.get("yaml", ""), variables=body.get("variables"))
            elif body.get("projectId"):
                path = str(resolve_project(body["projectId"]) / "scene.yaml")
                issues = await lint(path=path, variables=body.get("variables"))
            elif body.get("projectPath"):
                issues = await lint(path=str(Path(body["projectPath"]) / "scene.yaml"), variables=body.get("variables"))
            else:
                issues = await lint(yaml_text=body.get("yaml", ""), variables=body.get("variables"))
            return JSONResponse({"issues": issues})
        except VideoEngineError as exc:
            return JSONResponse({"error": str(exc), "issues": []}, status_code=exc.status_code)
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

    async def _compile(self, request: Request) -> JSONResponse:
        body = await request.json()
        try:
            if body.get("projectId"):
                path = str(resolve_project(body["projectId"]) / "scene.yaml")
                data = await compile_scene(path=path, variables=body.get("variables"))
            elif body.get("projectPath"):
                data = await compile_scene(
                    path=str(Path(body["projectPath"]) / "scene.yaml"),
                    variables=body.get("variables"),
                )
            else:
                data = await compile_scene(yaml_text=body.get("yaml", ""), variables=body.get("variables"))
            if data.get("error"):
                return JSONResponse(data, status_code=422)
            return JSONResponse(data)
        except VideoEngineError as exc:
            if exc.detail:
                return JSONResponse(exc.detail, status_code=exc.status_code)
            return JSONResponse({"error": str(exc)}, status_code=exc.status_code)

    async def _preview_url(self, request: Request) -> JSONResponse:
        project_id = request.query_params.get("projectId")
        if not project_id:
            return JSONResponse({"error": "projectId required"}, status_code=400)
        try:
            project_path = str(resolve_project(project_id))
            data = await preview_start(project_path)
            url = data.get("url")
            if url:
                return JSONResponse({"url": url, "port": data.get("port")})
            return JSONResponse(
                {
                    "url": None,
                    "message": data.get("message")
                    or "Video engine not running. Start with: praisonai-video serve",
                }
            )
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

    async def _preview_start(self, request: Request) -> JSONResponse:
        body = await request.json()
        project_path = body.get("projectPath")
        if body.get("projectId"):
            project_path = str(resolve_project(body["projectId"]))
        if not project_path:
            return JSONResponse({"error": "projectPath or projectId required"}, status_code=400)
        data = await preview_start(project_path)
        return JSONResponse(data)

    async def _render(self, request: Request) -> JSONResponse:
        body = await request.json()
        project_id = body.get("projectId")
        if not project_id:
            return JSONResponse({"error": "projectId required"}, status_code=400)
        try:
            project_dir = resolve_project(project_id)
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

        out_path = export_artifact_path(project_id, body.get("out", "out.mp4"))
        job_id = f"vid_{uuid.uuid4().hex[:12]}"
        now = time.time()
        job = {
            "id": job_id,
            "type": "video_render",
            "status": JobStatus.QUEUED.value,
            "projectId": project_id,
            "projectPath": str(project_dir),
            "out": str(out_path),
            "test": bool(body.get("test")),
            "progress": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "result": None,
            "error": None,
        }
        _video_jobs[job_id] = job
        store = get_job_store()
        store.save({**job, "prompt": f"Render {project_id}"})

        explicit_backend = body.get("backend")
        if isinstance(explicit_backend, str):
            explicit_backend = explicit_backend.strip() or None
        else:
            explicit_backend = None
        asyncio.create_task(
            self._run_render(
                job_id, str(project_dir), str(out_path), job["test"], explicit_backend
            )
        )
        return JSONResponse({"jobId": job_id})

    async def _run_render(
        self,
        job_id: str,
        project_path: str,
        out: str,
        test: bool,
        explicit_backend: str | None = None,
    ) -> None:
        job = _video_jobs.get(job_id)
        if not job:
            return
        store = get_job_store()
        job["status"] = JobStatus.RUNNING.value
        job["started_at"] = time.time()
        store.save({**job, "prompt": job.get("prompt", f"Render {job.get('projectId')}")})

        try:
            from praisonaiui.video_projects import read_render_backend_from_scene

            backend = explicit_backend
            if not backend and job.get("projectId"):
                backend = read_render_backend_from_scene(job["projectId"])
            result = await engine_render(
                project_path, out=out, test=test, backend=backend
            )
            status = result.get("status", "succeeded")
            if status == "succeeded" or result.get("artifactPath"):
                artifact = result.get("artifactPath", out)
                download_url = f"/api/video/projects/{job['projectId']}/artifacts/{Path(artifact).name}"
                job["status"] = JobStatus.SUCCEEDED.value
                job["result"] = {"artifactPath": artifact, "downloadUrl": download_url}
            elif result.get("jobId"):
                job["engineJobId"] = result["jobId"]
                job["status"] = JobStatus.RUNNING.value
            else:
                job["status"] = JobStatus.SUCCEEDED.value
                job["result"] = result
        except VideoEngineError as exc:
            job["status"] = JobStatus.FAILED.value
            job["error"] = str(exc)
        except Exception as exc:
            logger.exception("Video render failed for %s", job_id)
            job["status"] = JobStatus.FAILED.value
            job["error"] = str(exc)
        finally:
            job["completed_at"] = time.time()
            store.save({**job, "prompt": job.get("prompt", "")})

    async def _test(self, request: Request) -> JSONResponse:
        body = await request.json()
        project_id = body.get("projectId")
        if not project_id:
            return JSONResponse({"error": "projectId required"}, status_code=400)
        try:
            project_path = str(resolve_project(project_id))
            result = await test_scene(project_path)
            return JSONResponse(result)
        except VideoEngineError as exc:
            return JSONResponse({"error": str(exc), "passed": False}, status_code=exc.status_code)

    async def _job_status(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        job = _video_jobs.get(job_id)
        if not job:
            store_job = get_job_store().get(job_id)
            if store_job and store_job.get("type") == "video_render":
                job = store_job
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        engine_id = job.get("engineJobId")
        if engine_id and job.get("status") == JobStatus.RUNNING.value:
            try:
                from praisonaiui.video_client import _request

                remote = await _request("GET", f"/v1/jobs/{engine_id}")
                job["status"] = remote.get("status", job["status"])
                job["progress"] = remote.get("progress")
                if remote.get("artifactUrl"):
                    job.setdefault("result", {})["downloadUrl"] = remote["artifactUrl"]
            except VideoEngineError:
                pass
        return JSONResponse(
            {
                "id": job_id,
                "status": job.get("status"),
                "progress": job.get("progress"),
                "artifactPath": (job.get("result") or {}).get("artifactPath"),
                "downloadUrl": (job.get("result") or {}).get("downloadUrl"),
                "error": job.get("error"),
            }
        )

    async def _registry(self, request: Request) -> JSONResponse:
        return JSONResponse(await registry())

    async def _projects_list(self, request: Request) -> JSONResponse:
        return JSONResponse({"projects": list_projects()})

    async def _projects_create(self, request: Request) -> JSONResponse:
        body = await request.json()
        name = body.get("name", "Untitled video")
        project = create_project(name)
        return JSONResponse(project, status_code=201)

    async def _project_get(self, request: Request) -> JSONResponse:
        project_id = request.path_params["project_id"]
        try:
            path = resolve_project(project_id)
            yaml_text = read_scene_yaml(project_id)
            return JSONResponse(
                {"id": project_id, "path": str(path), "sceneYaml": yaml_text}
            )
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

    async def _project_reset(self, request: Request) -> JSONResponse:
        project_id = request.path_params["project_id"]
        try:
            yaml_text = reset_scene_yaml(project_id)
            return JSONResponse({"ok": True, "sceneYaml": yaml_text})
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

    async def _project_scene_put(self, request: Request) -> JSONResponse:
        project_id = request.path_params["project_id"]
        body = await request.json()
        yaml_text = body.get("yaml", "")
        try:
            save_scene_yaml(project_id, yaml_text)
            return JSONResponse({"ok": True})
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

    async def _studio_refresh(self, request: Request) -> JSONResponse:
        project_id = request.path_params["project_id"]
        return JSONResponse({"refresh": consume_project_refresh(project_id)})

    async def _artifact_download(self, request: Request) -> FileResponse | JSONResponse:
        project_id = request.path_params["project_id"]
        filename = request.path_params["filename"]
        try:
            path = resolve_project(project_id) / "exports" / filename
            if not path.is_file():
                return JSONResponse({"error": "Artifact not found"}, status_code=404)
            return FileResponse(path, media_type="video/mp4", filename=filename)
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)


__all__ = ["VideoFeature"]
