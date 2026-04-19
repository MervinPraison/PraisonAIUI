"""Tests for server config API functions that were missing test coverage.

Covers: set_chat_mode, set_brand_color, set_chat_features, set_dashboard,
        set_sidebar_config, register_theme, configure, remove_page.
Each function is tested for:
  1. Correct global mutation
  2. Correct JSON output via /api/config endpoint
  3. reset_state() properly clears it
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from praisonaiui import server as srv
from praisonaiui.datastore import MemoryDataStore


@pytest.fixture(autouse=True)
def _clean_state():
    """Reset all server state before and after each test."""
    srv.reset_state()
    srv.set_datastore(MemoryDataStore())
    yield
    srv.reset_state()


@pytest.fixture
def client():
    app = srv.create_app()
    return TestClient(app)


# ── set_chat_mode ─────────────────────────────────────────────────

class TestSetChatMode:
    def test_sets_global(self):
        srv.set_chat_mode("floating", position=(30, 40), size=(500, 600))
        assert srv._chat_mode is not None
        assert srv._chat_mode["mode"] == "floating"
        assert srv._chat_mode["position"] == [30, 40]
        assert srv._chat_mode["size"] == [500, 600]
        assert srv._chat_mode["resizable"] is True
        assert srv._chat_mode["minimized"] is False

    def test_defaults(self):
        srv.set_chat_mode()
        assert srv._chat_mode["mode"] == "fullpage"
        assert srv._chat_mode["position"] == [20, 20]
        assert srv._chat_mode["size"] == [400, 500]

    def test_sidebar_mode(self):
        srv.set_chat_mode("sidebar")
        assert srv._chat_mode["mode"] == "sidebar"

    def test_minimized(self):
        srv.set_chat_mode("floating", minimized=True)
        assert srv._chat_mode["minimized"] is True

    def test_ui_config_returns_chat_mode(self, client):
        srv.set_chat_mode("floating", position=(10, 10))
        resp = client.get("/ui-config.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["chat"]["mode"]["mode"] == "floating"
        assert data["chat"]["mode"]["position"] == [10, 10]

    def test_reset_clears_chat_mode(self):
        srv.set_chat_mode("floating")
        srv.reset_state()
        assert srv._chat_mode is None


# ── set_brand_color ───────────────────────────────────────────────

class TestSetBrandColor:
    def test_sets_global(self):
        srv.set_brand_color("#ff5733")
        assert srv._brand_color == "#ff5733"

    def test_ui_config_returns_brand_color(self, client):
        srv.set_brand_color("#818cf8")
        resp = client.get("/ui-config.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["site"]["brandColor"] == "#818cf8"

    def test_ui_config_omits_when_none(self, client):
        resp = client.get("/ui-config.json")
        assert resp.status_code == 200
        data = resp.json()
        assert "brandColor" not in data["site"]

    def test_reset_clears_brand_color(self):
        srv.set_brand_color("#abc")
        srv.reset_state()
        assert srv._brand_color is None


# ── set_chat_features ─────────────────────────────────────────────

class TestSetChatFeatures:
    def test_sets_global(self):
        srv.set_chat_features(history=False, file_upload=True)
        assert srv._chat_features is not None
        assert srv._chat_features["history"] is False
        assert srv._chat_features["fileUpload"] is True
        assert srv._chat_features["streaming"] is True  # default

    def test_all_defaults(self):
        srv.set_chat_features()
        cf = srv._chat_features
        assert cf["history"] is True
        assert cf["streaming"] is True
        assert cf["fileUpload"] is False
        assert cf["audio"] is False
        assert cf["reasoning"] is True
        assert cf["tools"] is True
        assert cf["multimedia"] is True
        assert cf["feedback"] is False

    def test_ui_config_returns_features(self, client):
        srv.set_chat_features(feedback=True)
        resp = client.get("/ui-config.json")
        data = resp.json()
        assert data["chat"]["features"]["feedback"] is True

    def test_ui_config_omits_when_none(self, client):
        resp = client.get("/ui-config.json")
        data = resp.json()
        assert "features" not in data["chat"]

    def test_reset_clears(self):
        srv.set_chat_features(audio=True)
        srv.reset_state()
        assert srv._chat_features is None


# ── set_dashboard ─────────────────────────────────────────────────

class TestSetDashboard:
    def test_sets_global(self):
        srv.set_dashboard(sidebar=False, page_header=False)
        assert srv._dashboard_config == {
            "sidebar": False,
            "pageHeader": False,
        }

    def test_defaults(self):
        srv.set_dashboard()
        assert srv._dashboard_config["sidebar"] is True
        assert srv._dashboard_config["pageHeader"] is True

    def test_ui_config_returns_dashboard(self, client):
        srv.set_dashboard(sidebar=False)
        resp = client.get("/ui-config.json")
        data = resp.json()
        assert data["dashboard"]["sidebar"] is False

    def test_ui_config_omits_when_none(self, client):
        resp = client.get("/ui-config.json")
        data = resp.json()
        assert "dashboard" not in data

    def test_reset_clears(self):
        srv.set_dashboard(sidebar=False)
        srv.reset_state()
        assert srv._dashboard_config is None


# ── set_sidebar_config ────────────────────────────────────────────

class TestSetSidebarConfig:
    def test_sets_global(self):
        srv.set_sidebar_config(collapsible=True, width=300)
        assert srv._dashboard_config is not None
        assert srv._dashboard_config["sidebarCollapsible"] is True
        assert srv._dashboard_config["sidebarWidth"] == 300
        assert srv._dashboard_config["sidebarMinWidth"] == 200
        assert srv._dashboard_config["sidebarMaxWidth"] == 360

    def test_default_collapsed(self):
        srv.set_sidebar_config(default_collapsed=True)
        assert srv._dashboard_config["sidebarCollapsed"] is True

    def test_merges_with_existing_dashboard_config(self):
        srv.set_dashboard(sidebar=True, page_header=False)
        srv.set_sidebar_config(width=280)
        # sidebar and pageHeader from set_dashboard should be preserved
        assert srv._dashboard_config["sidebar"] is True
        assert srv._dashboard_config["pageHeader"] is False
        assert srv._dashboard_config["sidebarWidth"] == 280

    def test_creates_dashboard_config_if_none(self):
        assert srv._dashboard_config is None
        srv.set_sidebar_config(collapsible=False)
        assert srv._dashboard_config is not None
        assert srv._dashboard_config["sidebarCollapsible"] is False

    def test_ui_config_returns_sidebar_fields(self, client):
        srv.set_sidebar_config(width=300)
        resp = client.get("/ui-config.json")
        data = resp.json()
        assert data["dashboard"]["sidebarWidth"] == 300

    def test_reset_clears(self):
        srv.set_sidebar_config(width=300)
        srv.reset_state()
        assert srv._dashboard_config is None


# ── register_theme ────────────────────────────────────────────────

class TestRegisterTheme:
    def test_registers_via_theme_manager(self):
        srv.register_theme("ocean", {"accent": "#0077b6"})
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        assert "ocean" in mgr.list_themes()

    def test_multiple_themes(self):
        srv.register_theme("sunset", {"accent": "#ff6b35"})
        srv.register_theme("forest", {"accent": "#228b22"})
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        themes = mgr.list_themes()
        assert "sunset" in themes
        assert "forest" in themes

    def test_reset_clears_custom_themes(self):
        srv.register_theme("temp", {"accent": "#123456"})
        srv.reset_state()
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        assert "temp" not in mgr.list_themes()


# ── configure ─────────────────────────────────────────────────────

class TestConfigure:
    def test_memory_datastore(self):
        from praisonaiui._config import configure
        configure(datastore="memory")
        ds = srv.get_datastore()
        assert type(ds).__name__ == "MemoryDataStore"

    def test_json_datastore(self, tmp_path):
        from praisonaiui._config import configure
        configure(datastore=f"json:{tmp_path}")
        ds = srv.get_datastore()
        assert type(ds).__name__ == "JSONFileDataStore"

    def test_invalid_datastore_raises(self):
        from praisonaiui._config import configure
        with pytest.raises(ValueError, match="Unknown datastore"):
            configure(datastore="invalid")


# ── remove_page ───────────────────────────────────────────────────

class TestRemovePage:
    def test_remove_existing_page(self):
        srv._pages["test-page"] = {"id": "test-page", "title": "Test"}
        srv.remove_page("test-page")
        assert "test-page" not in srv._pages

    def test_remove_nonexistent_page_no_error(self):
        # Should not raise
        srv.remove_page("nonexistent")
