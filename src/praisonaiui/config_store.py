"""Unified YAML config store for PraisonAIUI.

Single source of truth for all feature state — agents, skills, channels,
runtime config.  Compatible with the gateway.yaml schema so users can
share the same file between ``praisonai gateway start --config`` and
``aiui run``.

Design:
    • Reads/writes ``~/.praisonaiui/config.yaml`` (or user-specified path)
    • Atomic writes via tempfile + rename (no partial writes on crash)
    • Section-based API so each feature manages its own slice
    • Auto-migrates legacy ``agents.json`` on first load
"""

from __future__ import annotations

import copy
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# Default config path (configurable via AIUI_DATA_DIR env var)
def _get_default_config_dir() -> Path:
    """Return the default config directory, configurable via AIUI_DATA_DIR env var."""
    return Path(os.environ.get("AIUI_DATA_DIR", str(Path.home() / ".praisonaiui")))


DEFAULT_CONFIG_DIR = _get_default_config_dir()
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.yaml"

# Schema version for forward-compatibility
SCHEMA_VERSION = 2

# Default config structure
_DEFAULT_CONFIG: Dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "server": {
        "host": "127.0.0.1",
        "port": 8003,
    },
    "provider": {
        "name": "openai",
        "model": "gpt-4o-mini",
    },
    "gateway": {
        "host": "127.0.0.1",
        "port": 8765,
    },
    "agents": {},
    "channels": {},
    "schedules": {},
    "guardrails": {},
    "skills": {
        "enabled": [],
        "custom": {},
    },
}


class YAMLConfigStore:
    """Unified YAML config — single source of truth for all features."""

    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path or DEFAULT_CONFIG_PATH
        self._data: Dict[str, Any] = {}
        self._load()

    # ── Public API ───────────────────────────────────────────────────

    @property
    def path(self) -> Path:
        return self._path

    @property
    def data(self) -> Dict[str, Any]:
        """Full config dict (read-only view)."""
        return dict(self._data)

    def get_section(self, key: str) -> Any:
        """Get a top-level config section (e.g. 'agents', 'channels')."""
        return self._data.get(key, {} if key != "skills" else {"enabled": [], "custom": {}})

    def set_section(self, key: str, value: Any) -> None:
        """Replace a top-level section and write to disk."""
        self._data[key] = value
        self._save()

    def get_item(self, section: str, item_id: str) -> Optional[Dict[str, Any]]:
        """Get a single item from a section (e.g. agents.personal)."""
        sec = self._data.get(section, {})
        if isinstance(sec, dict):
            return sec.get(item_id)
        return None

    def update_item(self, section: str, item_id: str, data: Dict[str, Any]) -> None:
        """Upsert a single item within a section and save."""
        if section not in self._data:
            self._data[section] = {}
        self._data[section][item_id] = data
        self._save()

    def delete_item(self, section: str, item_id: str) -> bool:
        """Delete a single item from a section.  Returns True if found."""
        sec = self._data.get(section, {})
        if isinstance(sec, dict) and item_id in sec:
            del sec[item_id]
            self._save()
            return True
        return False

    def list_items(self, section: str) -> List[Dict[str, Any]]:
        """List all items in a dict-type section as a list of dicts."""
        sec = self._data.get(section, {})
        if isinstance(sec, dict):
            result = []
            for item_id, item_data in sec.items():
                if isinstance(item_data, dict):
                    item_copy = dict(item_data)
                    item_copy.setdefault("id", item_id)
                    result.append(item_copy)
            return result
        return []

    def reload(self) -> None:
        """Re-read the YAML from disk (called by hot-reload watcher)."""
        self._load()

    # ── Private ──────────────────────────────────────────────────────

    def _load(self) -> None:
        """Load config from YAML file, creating defaults if not found."""
        if not self._path.exists():
            logger.info("No config file found at %s, creating with defaults", self._path)
            self._data = copy.deepcopy(_DEFAULT_CONFIG)
            self._migrate_legacy_json()
            self._save()
            return

        try:
            import yaml

            with open(self._path) as f:
                loaded = yaml.safe_load(f) or {}
            # Merge with defaults so new keys are always present
            self._data = copy.deepcopy(_DEFAULT_CONFIG)
            _deep_merge(self._data, loaded)
            logger.info("Loaded config from %s", self._path)
        except ImportError:
            logger.warning("PyYAML not installed, using empty config")
            self._data = copy.deepcopy(_DEFAULT_CONFIG)
        except Exception as e:
            logger.warning("Failed to load config from %s: %s", self._path, e)
            self._data = copy.deepcopy(_DEFAULT_CONFIG)

    def _save(self) -> None:
        """Atomic write: write to tempfile, then rename."""
        try:
            import yaml
        except ImportError:
            logger.warning("PyYAML not installed, cannot save config")
            return

        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            # Write to temp file in same directory, then atomic rename
            fd, tmp_path = tempfile.mkstemp(dir=str(self._path.parent), suffix=".yaml.tmp")
            try:
                with os.fdopen(fd, "w") as f:
                    yaml.dump(
                        self._data,
                        f,
                        default_flow_style=False,
                        allow_unicode=True,
                        sort_keys=False,
                    )
                os.replace(tmp_path, str(self._path))
            except Exception:
                # Clean up temp file on failure
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        except Exception as e:
            logger.warning("Failed to save config to %s: %s", self._path, e)

    def _migrate_legacy_json(self) -> None:
        """One-time import of ~/.praisonaiui/agents.json → YAML."""
        json_path = self._path.parent / "agents.json"
        if not json_path.exists():
            return
        # Don't overwrite if YAML already has agents
        if self._data.get("agents"):
            return

        try:
            with open(json_path) as f:
                data = json.load(f)
            agents = data.get("agents", {})
            if agents:
                self._data["agents"] = agents
                # Back up the old file
                backup = json_path.with_suffix(".json.migrated")
                json_path.rename(backup)
                logger.info(
                    "Migrated %d agents from %s → YAML (backup: %s)",
                    len(agents),
                    json_path,
                    backup,
                )
        except Exception as e:
            logger.warning("Failed to migrate agents.json: %s", e)


def _deep_merge(base: dict, overlay: dict) -> None:
    """Recursively merge overlay into base (overlay wins on conflicts)."""
    for key, value in overlay.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


# ── Singleton ────────────────────────────────────────────────────────

_config_store: Optional[YAMLConfigStore] = None


def get_config_store() -> YAMLConfigStore:
    """Get or create the config store singleton."""
    global _config_store
    if _config_store is None:
        _config_store = YAMLConfigStore()
    return _config_store


def set_config_store(store: YAMLConfigStore) -> None:
    """Set the config store singleton (call before server starts)."""
    global _config_store
    _config_store = store


def init_config_store(path: Optional[Path] = None) -> YAMLConfigStore:
    """Initialize the config store with a specific path."""
    store = YAMLConfigStore(path)
    set_config_store(store)
    return store
