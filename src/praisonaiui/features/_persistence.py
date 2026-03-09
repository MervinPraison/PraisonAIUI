"""Shared YAML persistence helpers for PraisonAIUI features.

Provides load/save functions that persist feature state to YAML files
in ``~/.praisonaiui/``, ensuring settings survive server restarts.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

_DATA_DIR: Path | None = None


def _get_data_dir() -> Path:
    """Return (and create) the persistence directory ``~/.praisonaiui/``."""
    global _DATA_DIR
    if _DATA_DIR is None:
        _DATA_DIR = Path(os.environ.get("PRAISONAIUI_DATA_DIR", Path.home() / ".praisonaiui"))
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _DATA_DIR


def load_yaml(filename: str) -> Dict[str, Any]:
    """Load a YAML file from the data directory. Returns {} on any error."""
    path = _get_data_dir() / filename
    if not path.exists():
        return {}
    try:
        import yaml
        with open(path, "r") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except ImportError:
        logger.debug("PyYAML not installed — persistence unavailable")
        return {}
    except Exception as e:
        logger.warning("Failed to load %s: %s", path, e)
        return {}


def save_yaml(filename: str, data: Dict[str, Any]) -> bool:
    """Save a dict to a YAML file in the data directory. Returns True on success."""
    path = _get_data_dir() / filename
    try:
        import yaml
        with open(path, "w") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        return True
    except ImportError:
        logger.debug("PyYAML not installed — cannot persist to %s", filename)
        return False
    except Exception as e:
        logger.warning("Failed to save %s: %s", path, e)
        return False
