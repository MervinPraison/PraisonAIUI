"""Dashboard plugin scope: ``set_dashboard(plugins=...)`` applies to pages and manifests."""

import json

import pytest
from starlette.testclient import TestClient

import praisonaiui.dashboard_plugins as dp
import praisonaiui.server as srv


def _make_plugin(root, name, label=None):
    d = root / name
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"name": name, "label": label or name}))
    (d / "index.js").write_text("// plugin")


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home"
    bundled = tmp_path / "bundled"
    extra = tmp_path / "extra"
    _make_plugin(home / ".praisonai" / "dashboard-plugins", "home-plug")
    _make_plugin(home / ".praisonai" / "dashboard-plugins", "dup", label="from-home")
    _make_plugin(bundled, "bundled-plug")
    _make_plugin(bundled, "dup", label="from-bundled")
    bad = bundled / "broken"
    bad.mkdir()
    (bad / "manifest.json").write_text("{not json")
    _make_plugin(extra, "extra-plug")
    monkeypatch.setattr(dp.Path, "home", classmethod(lambda cls: home))
    monkeypatch.setattr(dp, "_BUILTIN_PLUGIN_ROOT", bundled)
    srv.reset_state()
    srv.set_style("dashboard")
    srv.set_pages([])
    srv.register_page("synthetic", title="Synthetic", handler=lambda: {"_components": []})
    yield str(extra)
    srv.reset_state()


def _state():
    client = TestClient(srv.create_app())
    pages = [p["id"] for p in client.get("/api/pages").json()["pages"]]
    plugins = {p["name"]: p for p in client.get("/api/dashboard/plugins").json()["plugins"]}
    return client, pages, plugins


def test_default_keeps_all_discovered(env):
    srv.set_dashboard(plugin_dirs=[env])
    _, pages, plugins = _state()
    assert set(plugins) == {"home-plug", "dup", "bundled-plug", "extra-plug"}
    assert plugins["dup"]["label"] == "from-home"  # first root wins on duplicates
    assert {"synthetic", "home-plug", "bundled-plug", "extra-plug", "dup"} <= set(pages)


def test_empty_disables_all_plugins(env):
    srv.set_dashboard(plugin_dirs=[env], plugins=[])
    client, pages, plugins = _state()
    assert plugins == {}
    assert pages == ["synthetic"]
    assert client.get("/dashboard-plugins/bundled-plug/index.js").status_code == 404


def test_allowlist_filters_pages_and_manifest(env):
    srv.set_dashboard(plugin_dirs=[env], plugins=["extra-plug", "missing"])
    client, pages, plugins = _state()
    assert set(plugins) == {"extra-plug"}
    assert sorted(pages) == ["extra-plug", "synthetic"]
    assert client.get("/dashboard-plugins/extra-plug/index.js").status_code == 200
    assert client.get("/dashboard-plugins/home-plug/index.js").status_code == 404
