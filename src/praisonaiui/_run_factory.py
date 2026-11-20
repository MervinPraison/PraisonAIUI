"""App factory behind ``aiui run --reload``.

uvicorn can only reload an application it imports itself (an import string),
not an app object built by the CLI. ``aiui run --reload`` therefore stores
what it resolved (app file, style, datastore, static dir, config path) in the
``AIUI_RUN_SPEC`` environment variable and starts uvicorn with
``praisonaiui._run_factory:create`` and ``factory=True``. Each reload worker
re-executes the app file and builds the same app.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional


def build_run_app(
    user_module: Any | None,
    *,
    static_dir: Optional[Path],
    config_path: Optional[Path],
) -> Any:
    """Return the ASGI app for ``aiui run`` (user factory when present)."""
    from inspect import signature

    from praisonaiui.server import create_app as default_create_app

    if user_module is not None:
        factory = getattr(user_module, "create_app", None)
        if callable(factory):
            kwargs: dict[str, Any] = {}
            try:
                params = signature(factory).parameters
            except (TypeError, ValueError):
                params = {}
            resolved_static = (
                static_dir if static_dir and static_dir.exists() else None
            )
            if "static_dir" in params:
                kwargs["static_dir"] = resolved_static
            if config_path is not None and "config_path" in params:
                kwargs["config_path"] = config_path
            if kwargs:
                return factory(**kwargs)
            return factory()

    resolved_static = static_dir if static_dir and static_dir.exists() else None
    return default_create_app(static_dir=resolved_static, config_path=config_path)

SPEC_ENV = "AIUI_RUN_SPEC"


def encode_spec(
    *,
    app_file: Path,
    is_yaml: bool,
    style: str,
    datastore: str,
    static_dir: Optional[Path],
    config_path: Optional[Path],
) -> str:
    return json.dumps(
        {
            "app_file": str(Path(app_file).resolve()),
            "is_yaml": bool(is_yaml),
            "style": style,
            "datastore": datastore,
            "static_dir": str(Path(static_dir).resolve()) if static_dir else None,
            "config_path": str(Path(config_path).resolve()) if config_path else None,
        }
    )


def create() -> Any:
    """Build the ``aiui run`` app described by ``AIUI_RUN_SPEC``."""
    raw = os.environ.get(SPEC_ENV)
    if not raw:
        raise RuntimeError(
            f"{SPEC_ENV} is not set: praisonaiui._run_factory:create is started by "
            "'aiui run --reload', not directly"
        )
    spec = json.loads(raw)

    from praisonaiui.cli import _apply_chat_yaml, _load_user_module, _make_datastore
    from praisonaiui.server import set_datastore, set_style

    app_file = Path(spec["app_file"])
    user_module: Any | None = None
    if spec.get("is_yaml"):
        import yaml

        with open(app_file, encoding="utf-8") as fh:
            _apply_chat_yaml(yaml.safe_load(fh) or {})
    else:
        user_module = _load_user_module(app_file)
        if user_module is None:
            raise RuntimeError(f"Could not load {app_file}")

    store, _label = _make_datastore(spec.get("datastore") or "sdk")
    set_datastore(store)
    set_style(spec["style"])
    if spec["style"] == "app":
        from praisonaiui.builtin.catalog import RUN_DEFAULT_LAYOUT
        from praisonaiui.layouts import set_run_default

        set_run_default(RUN_DEFAULT_LAYOUT)

    static_dir = Path(spec["static_dir"]) if spec.get("static_dir") else None
    config_path = Path(spec["config_path"]) if spec.get("config_path") else None
    return build_run_app(
        user_module,
        static_dir=static_dir,
        config_path=config_path,
    )
