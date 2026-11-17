"""On-disk video project layout under ``video_config.get_projects_dir()``."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from praisonaiui.video_config import get_projects_dir

DEFAULT_SCENE_YAML = """schemaVersion: 1

composition:
  id: hello
  fps: 30
  durationInFrames: 90
  width: 1280
  height: 720

player:
  playing: true
  loop: true

scene:
  type: box
  style:
    display: flex
    alignItems: center
    justifyContent: center
    background: "#0f172a"
    opacity:
      animate: { from: 0, to: 1, start: 0, end: 0.8, ease: easeOutCubic }
  children:
    - type: sprite
      start: 0
      end: 3
      children:
        - type: text
          text: "Hello, PraisonAI Video"
          x: 640
          y: 360
          align: center
          size: 40
          colour: "#f8fafc"
"""

DEFAULT_VISUAL_TEST_YAML = """schemaVersion: 1
frames:
  - at: 45
    text:
      - "Hello, PraisonAI Video"
"""


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-").lower()
    return s or f"project-{uuid.uuid4().hex[:8]}"


def list_projects() -> list[dict[str, Any]]:
    root = get_projects_dir()
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        meta = _read_meta(child)
        out.append(
            {
                "id": child.name,
                "name": meta.get("name", child.name),
                "path": str(child),
                "updatedAt": meta.get("updatedAt"),
            }
        )
    return out


def _read_meta(project_dir: Path) -> dict[str, Any]:
    meta_path = project_dir / ".praisonai" / "project.json"
    if meta_path.is_file():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return {}


def create_project(name: str) -> dict[str, Any]:
    root = get_projects_dir()
    root.mkdir(parents=True, exist_ok=True)
    project_id = _slug(name)
    base = root / project_id
    if base.exists():
        project_id = f"{project_id}-{uuid.uuid4().hex[:6]}"
        base = root / project_id
    base.mkdir(parents=True)
    (base / ".praisonai").mkdir(parents=True, exist_ok=True)
    (base / "exports").mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "schemaVersion": 1,
        "name": name,
        "videoEngine": "praisonai-video@0.4",
        "createdAt": now,
        "updatedAt": now,
    }
    (base / ".praisonai" / "project.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    (base / "scene.yaml").write_text(DEFAULT_SCENE_YAML, encoding="utf-8")
    (base / "scene.visual-test.yaml").write_text(DEFAULT_VISUAL_TEST_YAML, encoding="utf-8")
    return {"id": project_id, "name": name, "path": str(base), "meta": meta}


def _is_one_segment(name: Any) -> bool:
    """True for a plain file or folder name: no separator, no ``.``/``..``."""
    return (
        isinstance(name, str)
        and name not in ("", ".", "..")
        and not any(ch in name for ch in ("/", "\\", "\x00"))
    )


def resolve_project(project_id: str) -> Path:
    """The project folder for *project_id*, which must be one folder name.

    An id with a separator or ``..`` would reach outside the projects folder,
    so it is reported as not found, like an unknown id.
    """
    if not _is_one_segment(project_id):
        raise FileNotFoundError(f"Project not found: {project_id}")
    path = get_projects_dir() / project_id
    if not path.is_dir():
        raise FileNotFoundError(f"Project not found: {project_id}")
    return path


def confine_project_path(project_path: str) -> Path:
    """A caller-supplied project folder path, accepted only inside the projects folder."""
    root = Path(os.path.abspath(get_projects_dir()))
    path = Path(os.path.abspath(str(project_path)))
    if path == root or not path.is_relative_to(root) or not path.is_dir():
        raise FileNotFoundError(f"Project not found: {project_path}")
    return path


def scene_path(project_dir: Path) -> Path:
    return project_dir / "scene.yaml"


def reset_scene_yaml(project_id: str) -> str:
    """Restore default scene.yaml and visual-test spec."""
    project_dir = resolve_project(project_id)
    (project_dir / "scene.yaml").write_text(DEFAULT_SCENE_YAML, encoding="utf-8")
    (project_dir / "scene.visual-test.yaml").write_text(
        DEFAULT_VISUAL_TEST_YAML, encoding="utf-8"
    )
    return DEFAULT_SCENE_YAML


def save_scene_yaml(project_id: str, yaml_text: str) -> Path:
    project_dir = resolve_project(project_id)
    scene = scene_path(project_dir)
    scene.write_text(yaml_text, encoding="utf-8")
    meta_path = project_dir / ".praisonai" / "project.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["updatedAt"] = datetime.now(timezone.utc).isoformat()
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return scene


def read_scene_yaml(project_id: str) -> str:
    return scene_path(resolve_project(project_id)).read_text(encoding="utf-8")


def read_render_backend_from_scene(project_id: str) -> str | None:
    """Optional render.backend from scene.yaml (playwright | remotion | hyperframes)."""
    try:
        import yaml
    except ImportError:
        return None
    text = read_scene_yaml(project_id)
    doc = yaml.safe_load(text) or {}
    render = doc.get("render") if isinstance(doc, dict) else None
    if isinstance(render, dict):
        backend = render.get("backend")
        if isinstance(backend, str) and backend.strip():
            return backend.strip()
    return None


def export_artifact_path(project_id: str, filename: str = "out.mp4") -> Path:
    """``<project>/exports/<filename>``; *filename* must be one file name."""
    if not _is_one_segment(filename):
        raise ValueError(f"Invalid export file name: {filename!r}")
    project_dir = resolve_project(project_id)
    exports = project_dir / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    return exports / filename
