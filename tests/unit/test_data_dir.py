"""Tests for AIUI_DATA_DIR environment variable support."""
import importlib
import os
from pathlib import Path


class TestDataDir:
    """Tests for the _get_data_dir() function and AIUI_DATA_DIR env var."""

    def test_default_data_dir(self, monkeypatch):
        """Default data dir is ~/.praisonaiui when env var is not set."""
        monkeypatch.delenv("AIUI_DATA_DIR", raising=False)
        # Need to reimport to pick up env change
        import praisonaiui.server as server_module
        importlib.reload(server_module)
        d = server_module._get_data_dir()
        assert ".praisonaiui" in str(d)

    def test_custom_data_dir(self, monkeypatch, tmp_path):
        """AIUI_DATA_DIR overrides default data dir."""
        custom = str(tmp_path / "custom_aiui")
        monkeypatch.setenv("AIUI_DATA_DIR", custom)
        # The function reads env at call time, so no reload needed
        from praisonaiui.server import _get_data_dir
        d = _get_data_dir()
        assert str(d) == custom

    def test_data_dir_created_if_missing(self, monkeypatch, tmp_path):
        """Data dir is created if it doesn't exist."""
        custom = str(tmp_path / "nonexistent_dir")
        assert not Path(custom).exists()
        monkeypatch.setenv("AIUI_DATA_DIR", custom)
        from praisonaiui.server import _get_data_dir
        d = _get_data_dir()
        # _get_data_dir creates the directory
        assert Path(d).exists()

    def test_config_store_uses_env_var(self, monkeypatch, tmp_path):
        """config_store._get_default_config_dir() respects AIUI_DATA_DIR."""
        custom = str(tmp_path / "config_test")
        monkeypatch.setenv("AIUI_DATA_DIR", custom)
        from praisonaiui.config_store import _get_default_config_dir
        d = _get_default_config_dir()
        assert str(d) == custom

    def test_env_var_read_at_call_time(self, monkeypatch, tmp_path):
        """Env var is read at function call time, not module import time."""
        from praisonaiui.server import _get_data_dir
        
        # First call with one value
        dir1 = str(tmp_path / "dir1")
        monkeypatch.setenv("AIUI_DATA_DIR", dir1)
        result1 = _get_data_dir()
        assert str(result1) == dir1
        
        # Second call with different value
        dir2 = str(tmp_path / "dir2")
        monkeypatch.setenv("AIUI_DATA_DIR", dir2)
        result2 = _get_data_dir()
        assert str(result2) == dir2
