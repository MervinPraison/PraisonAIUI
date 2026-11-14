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
    from praisonaiui.server import create_app, set_datastore, set_style

    app_file = Path(spec["app_file"])
    if spec.get("is_yaml"):
        import yaml

        with open(app_file, encoding="utf-8") as fh:
            _apply_chat_yaml(yaml.safe_load(fh) or {})
    elif _load_user_module(app_file) is None:
        raise RuntimeError(f"Could not load {app_file}")

    store, _label = _make_datastore(spec.get("datastore") or "sdk")
    set_datastore(store)
    set_style(spec["style"])

    static_dir = Path(spec["static_dir"]) if spec.get("static_dir") else None
    config_path = Path(spec["config_path"]) if spec.get("config_path") else None
    return create_app(
        static_dir=static_dir if static_dir and static_dir.exists() else None,
        config_path=config_path,
    )
