"""Where feature data lives on disk.

Feature data follows the operator's data directory: ``$PRAISONAI_HOME``, else
``$AIUI_DATA_DIR``. Two servers started with different data directories never
read or write each other's runs, memories, knowledge or configuration, even
from the same working directory.

aiui's own default (``~/.praisonaiui``) counts as *not configured*: the server
copies it into ``PRAISONAI_HOME`` with ``setdefault`` at start-up, so it says
nothing about where the operator keeps data. When nothing is configured each
feature keeps its historical location (for example ``~/.praison/traces``,
where the PraisonAI CLI writes recorded runs), so a default install shows the
same data as before.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

#: Environment variables that name the data directory, highest priority first.
DATA_DIR_ENV_VARS = ("PRAISONAI_HOME", "AIUI_DATA_DIR")


def aiui_default_data_dir() -> Path:
    """aiui's built-in data directory, used when ``AIUI_DATA_DIR`` is unset."""
    return Path.home() / ".praisonaiui"


def configured_data_dir() -> Optional[Path]:
    """The data directory the operator configured, or ``None``.

    ``None`` means only aiui's own default applies (see the module docstring).
    """
    default = aiui_default_data_dir()
    for var in DATA_DIR_ENV_VARS:
        raw = os.environ.get(var, "").strip()
        if not raw:
            continue
        path = Path(raw).expanduser()
        if path != default:
            return path
    return None


def feature_data_path(name: str, legacy: Path) -> Path:
    """``<configured data dir>/<name>``, else *legacy* when none is configured."""
    base = configured_data_dir()
    return base / name if base is not None else legacy
