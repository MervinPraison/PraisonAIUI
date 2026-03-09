"""TDD tests for the unified YAML config store (config_store.py).

Tests cover:
    • Create / read / update / delete items
    • Section-level operations
    • Atomic write safety
    • Legacy agents.json migration
    • Deep merge on load
    • Singleton lifecycle
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict

import pytest
import yaml


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Reset the config store singleton between tests."""
    from praisonaiui.config_store import set_config_store
    set_config_store(None)
    yield
    set_config_store(None)


@pytest.fixture
def tmp_config_dir(tmp_path: Path) -> Path:
    """Create a temp directory for config files."""
    d = tmp_path / ".praisonaiui"
    d.mkdir()
    return d


@pytest.fixture
def store(tmp_config_dir: Path):
    """Create a fresh YAMLConfigStore pointing at a temp directory."""
    from praisonaiui.config_store import YAMLConfigStore
    return YAMLConfigStore(tmp_config_dir / "config.yaml")


# ── Basic CRUD ───────────────────────────────────────────────────────


class TestConfigStoreCreate:
    """Test creating items via the config store."""

    def test_creates_default_yaml_on_init(self, tmp_config_dir: Path):
        """Config store creates default config.yaml on first access."""
        from praisonaiui.config_store import YAMLConfigStore
        yaml_path = tmp_config_dir / "config.yaml"
        assert not yaml_path.exists()
        store = YAMLConfigStore(yaml_path)
        assert yaml_path.exists()
        with open(yaml_path) as f:
            data = yaml.safe_load(f)
        assert data["schemaVersion"] == 2
        assert "agents" in data
        assert "skills" in data

    def test_update_item_creates_section(self, store):
        """update_item creates the section if absent."""
        store.update_item("agents", "agent_1", {"name": "Test Agent"})
        agent = store.get_item("agents", "agent_1")
        assert agent is not None
        assert agent["name"] == "Test Agent"

    def test_update_item_persists_to_yaml(self, store):
        """update_item writes through to the YAML file."""
        store.update_item("agents", "agent_x", {"name": "Persist Me"})
        # Read the file independently
        with open(store.path) as f:
            data = yaml.safe_load(f)
        assert "agent_x" in data["agents"]
        assert data["agents"]["agent_x"]["name"] == "Persist Me"


class TestConfigStoreRead:
    """Test reading items from the config store."""

    def test_get_nonexistent_item_returns_none(self, store):
        """get_item returns None for missing items."""
        assert store.get_item("agents", "does_not_exist") is None

    def test_get_section_returns_empty_dict_for_missing(self, store):
        """get_section returns {} for unknown sections."""
        assert store.get_section("nonexistent") == {}

    def test_list_items_empty_section(self, tmp_path: Path):
        """list_items returns [] for empty sections."""
        from praisonaiui.config_store import YAMLConfigStore
        d = tmp_path / "list_empty"
        d.mkdir()
        store = YAMLConfigStore(d / "config.yaml")
        assert store.list_items("agents") == []

    def test_list_items_returns_items_with_ids(self, tmp_path: Path):
        """list_items returns items with their IDs injected."""
        from praisonaiui.config_store import YAMLConfigStore
        d = tmp_path / "list_ids"
        d.mkdir()
        store = YAMLConfigStore(d / "config.yaml")
        store.update_item("agents", "a1", {"name": "Agent 1"})
        store.update_item("agents", "a2", {"name": "Agent 2"})
        items = store.list_items("agents")
        assert len(items) == 2
        ids = {item["id"] for item in items}
        assert ids == {"a1", "a2"}


class TestConfigStoreUpdate:
    """Test updating items in the config store."""

    def test_update_item_overwrites(self, store):
        """Updating an existing item replaces its data."""
        store.update_item("agents", "a1", {"name": "V1", "model": "old"})
        store.update_item("agents", "a1", {"name": "V2", "model": "new"})
        agent = store.get_item("agents", "a1")
        assert agent["name"] == "V2"
        assert agent["model"] == "new"

    def test_set_section_replaces_entirely(self, store):
        """set_section replaces the whole section."""
        store.update_item("agents", "a1", {"name": "Old"})
        store.set_section("agents", {"a2": {"name": "New"}})
        assert store.get_item("agents", "a1") is None
        assert store.get_item("agents", "a2")["name"] == "New"


class TestConfigStoreDelete:
    """Test deleting items from the config store."""

    def test_delete_existing_item(self, store):
        """delete_item removes the item and returns True."""
        store.update_item("agents", "a1", {"name": "Deletable"})
        result = store.delete_item("agents", "a1")
        assert result is True
        assert store.get_item("agents", "a1") is None

    def test_delete_nonexistent_returns_false(self, store):
        """delete_item returns False for missing items."""
        result = store.delete_item("agents", "ghost")
        assert result is False

    def test_delete_persists(self, store):
        """Deletion is persisted to the YAML file."""
        store.update_item("agents", "a1", {"name": "Delete Me"})
        store.delete_item("agents", "a1")
        with open(store.path) as f:
            data = yaml.safe_load(f)
        assert "a1" not in data.get("agents", {})


# ── Persistence ──────────────────────────────────────────────────────


class TestConfigStorePersistence:
    """Test that data survives store re-creation."""

    def test_data_survives_reload(self, tmp_config_dir: Path):
        """Data written by one store instance is readable by another."""
        from praisonaiui.config_store import YAMLConfigStore

        path = tmp_config_dir / "config.yaml"
        # Write
        store1 = YAMLConfigStore(path)
        store1.update_item("agents", "persist_agent", {
            "name": "Survivor",
            "model": "gpt-4o-mini",
        })
        # Read in a fresh store
        store2 = YAMLConfigStore(path)
        agent = store2.get_item("agents", "persist_agent")
        assert agent is not None
        assert agent["name"] == "Survivor"

    def test_skills_persist(self, tmp_config_dir: Path):
        """Custom skills persist across store instances."""
        from praisonaiui.config_store import YAMLConfigStore

        path = tmp_config_dir / "config.yaml"
        store1 = YAMLConfigStore(path)
        store1.set_section("skills", {
            "custom": {"s1": {"name": "My Skill"}},
            "tool_state": {"internet_search": {"enabled": False}},
        })

        store2 = YAMLConfigStore(path)
        skills = store2.get_section("skills")
        assert skills["custom"]["s1"]["name"] == "My Skill"
        assert skills["tool_state"]["internet_search"]["enabled"] is False


# ── Deep Merge ───────────────────────────────────────────────────────


class TestDeepMerge:
    """Test deep merge when loading config."""

    def test_new_defaults_appear_after_schema_upgrade(self, tmp_config_dir: Path):
        """When defaults add new keys, they appear after load."""
        from praisonaiui.config_store import YAMLConfigStore

        path = tmp_config_dir / "config.yaml"
        # Write a minimal YAML that's missing some default sections
        with open(path, "w") as f:
            yaml.dump({"schemaVersion": 2, "agents": {"a1": {"name": "Old"}}}, f)

        store = YAMLConfigStore(path)
        # Should have merged defaults
        assert "gateway" in store.data
        assert "server" in store.data
        # Should preserve existing data
        assert store.get_item("agents", "a1")["name"] == "Old"


# ── Legacy Migration ────────────────────────────────────────────────


class TestLegacyMigration:
    """Test migration from agents.json to YAML."""

    def test_migrates_agents_json_on_first_load(self, tmp_path: Path):
        """If agents.json exists and YAML doesn't, agents are migrated."""
        from praisonaiui.config_store import YAMLConfigStore

        d = tmp_path / "migrate_test"
        d.mkdir()
        json_path = d / "agents.json"
        yaml_path = d / "config.yaml"

        # Create legacy agents.json
        legacy_data = {
            "agents": {
                "legacy_agent": {
                    "name": "Legacy Agent",
                    "model": "gpt-3.5-turbo",
                    "status": "active",
                }
            },
            "saved_at": time.time(),
        }
        with open(json_path, "w") as f:
            json.dump(legacy_data, f)

        # Create store — should auto-migrate
        store = YAMLConfigStore(yaml_path)
        agent = store.get_item("agents", "legacy_agent")
        assert agent is not None
        assert agent["name"] == "Legacy Agent"
        assert agent["model"] == "gpt-3.5-turbo"

        # agents.json should be renamed
        assert not json_path.exists()
        assert (d / "agents.json.migrated").exists()

    def test_no_migration_if_yaml_has_agents(self, tmp_config_dir: Path):
        """If YAML already has agents, don't import from JSON."""
        from praisonaiui.config_store import YAMLConfigStore

        json_path = tmp_config_dir / "agents.json"
        yaml_path = tmp_config_dir / "config.yaml"

        # Create agents.json
        with open(json_path, "w") as f:
            json.dump({"agents": {"old": {"name": "Old"}}}, f)

        # Create YAML with agents already
        with open(yaml_path, "w") as f:
            yaml.dump({
                "schemaVersion": 2,
                "agents": {"existing": {"name": "Existing"}},
            }, f)

        store = YAMLConfigStore(yaml_path)
        # Should keep YAML agents, not import from JSON
        assert store.get_item("agents", "existing") is not None
        assert store.get_item("agents", "old") is None
        # JSON should NOT be renamed
        assert json_path.exists()


# ── Singleton ────────────────────────────────────────────────────────


class TestSingleton:
    """Test singleton lifecycle."""

    def test_init_config_store_sets_singleton(self, tmp_config_dir: Path):
        """init_config_store creates and sets the global singleton."""
        from praisonaiui.config_store import (
            init_config_store, get_config_store, set_config_store
        )
        # Reset to clean state
        set_config_store(None)

        store = init_config_store(tmp_config_dir / "config.yaml")
        assert get_config_store() is store

        # Cleanup: reset singleton
        set_config_store(None)

    def test_get_config_store_creates_default(self):
        """get_config_store creates a default store if none set."""
        from praisonaiui.config_store import get_config_store, set_config_store
        # Reset
        set_config_store(None)
        store = get_config_store()
        assert store is not None
        # Cleanup
        set_config_store(None)


# ── Reload (Hot Reload) ─────────────────────────────────────────────


class TestReload:
    """Test reload functionality for hot-reload support."""

    def test_reload_picks_up_external_changes(self, tmp_config_dir: Path):
        """After external YAML edit, reload() picks up the changes."""
        from praisonaiui.config_store import YAMLConfigStore

        path = tmp_config_dir / "config.yaml"
        store = YAMLConfigStore(path)
        store.update_item("agents", "a1", {"name": "Before"})

        # Externally modify the file
        with open(path) as f:
            data = yaml.safe_load(f)
        data["agents"]["a1"]["name"] = "After External Edit"
        with open(path, "w") as f:
            yaml.dump(data, f)

        # Reload and verify
        store.reload()
        assert store.get_item("agents", "a1")["name"] == "After External Edit"
