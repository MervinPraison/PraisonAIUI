"""Video engine configuration (env + runtime overrides)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

_engine_url: Optional[str] = None
_engine_token: Optional[str] = None
_projects_dir: Optional[Path] = None


def set_video_engine(
    *,
    url: str | None = None,
    token: str | None = None,
    projects_dir: str | Path | None = None,
) -> None:
    """Configure the PraisonAI Video engine sidecar."""
    global _engine_url, _engine_token, _projects_dir
    if url is not None:
        _engine_url = url.rstrip("/")
    if token is not None:
        _engine_token = token
    if projects_dir is not None:
        _projects_dir = Path(projects_dir).expanduser()


def get_engine_url() -> str:
    return (_engine_url or os.environ.get("VIDEO_ENGINE_URL") or "http://127.0.0.1:3921").rstrip("/")


def get_engine_token() -> Optional[str]:
    return _engine_token or os.environ.get("VIDEO_ENGINE_TOKEN") or None


def get_projects_dir() -> Path:
    if _projects_dir is not None:
        return _projects_dir
    raw = os.environ.get("PRAISONAI_PROJECTS_DIR", "~/.praisonai/projects")
    return Path(raw).expanduser()
