"""``set_pages`` is the one switch for what an app shows (focused apps).

It lists built-in pages, the app shell's layout pages and dashboard-plugin
folders (``~/.praisonai/dashboard-plugins`` is shared by every app on the
machine); the app's own pages always show. Without ``set_pages`` nothing
changes.
"""

import json
import logging

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.dashboard_plugins as dp
import praisonaiui.server as srv


def _folder(root, name, page_id):
    d = root / name
    d.mkdir(parents=True)
    manifest = {"name": name, "entry": "index.js", "page": {"id": page_id, "title": name}}
    (d / "manifest.json").write_text(json.dumps(manifest))
    (d / "index.js").write_text("// plugin")


@pytest.fixture
def machine(tmp_path, monkeypatch):
    """A machine with a user-global dashboard plugin, like ~/.praisonai/dashboard-plugins/kanban."""
    home = tmp_path / "home"
    _folder(home / ".praisonai" / "dashboard-plugins", "global-board", "global-board")
    monkeypatch.setattr(dp.Path, "home", classmethod(lambda cls: home))
    srv.reset_state()
    srv.register_page("own", title="Own", group="My posts", handler=lambda: {"_components": []})
    yield
    srv.reset_state()


def _manifest_ids(style="app"):
    srv.set_style(style)
    client = TestClient(srv.create_app())
    return client, {p["id"] for p in client.get("/api/shell/manifest").json()["pages"]}


def test_set_pages_hides_layout_and_folder_pages_in_the_app_shell(machine):
    srv.set_pages(["chat"])
    _, ids = _manifest_ids()
    assert ids == {"chat", "own"}


def test_only_my_pages_shows_only_the_apps_pages(machine):
    aiui.only_my_pages()
    _, ids = _manifest_ids()
    assert ids == {"own"}


def test_only_my_pages_keeps_named_builtins(machine):
    aiui.only_my_pages("chat", "global-board")
    _, ids = _manifest_ids()
    assert ids == {"chat", "own", "global-board"}


def test_set_pages_filters_folders_in_the_dashboard_style(machine):
    srv.set_pages(["chat"])
    client, _ = _manifest_ids("dashboard")
    pages = {p["id"] for p in client.get("/api/pages").json()["pages"]}
    plugins = client.get("/api/dashboard/plugins").json()["plugins"]
    assert "global-board" not in pages
    assert plugins == []
    assert client.get("/dashboard-plugins/global-board/index.js").status_code == 404


def test_without_set_pages_every_source_still_shows(machine):
    _, ids = _manifest_ids()
    assert {"own", "chat", "global-board"} <= ids
    assert len(ids) > 10  # built-ins and layout pages too


def test_explicit_dashboard_allowlist_wins_over_set_pages(machine):
    srv.set_pages([])
    srv.set_dashboard(plugins=["global-board"])
    _, ids = _manifest_ids()
    assert "global-board" in ids


def test_unknown_set_pages_id_warns_at_startup(machine, caplog):
    srv.set_pages(["chat", "no-such-page"])
    with caplog.at_level(logging.WARNING, logger="praisonaiui.server"):
        _manifest_ids()
    msgs = [r.getMessage() for r in caplog.records]
    assert any("no-such-page" in m for m in msgs)
    assert not any("'chat'" in m and "set_pages" in m for m in msgs)


def _groups(client):
    return client.get("/api/shell/manifest").json()["layout"]["groups"]


def test_the_apps_own_groups_are_shown_in_every_layout(machine):
    srv.set_pages(["chat"])
    client, _ = _manifest_ids()
    assert _groups(client)["shown"] == ["My posts"]


def test_no_shown_groups_without_app_pages():
    srv.reset_state()
    try:
        srv.set_style("app")
        client = TestClient(srv.create_app())
        assert "shown" not in _groups(client)
    finally:
        srv.reset_state()


def test_set_pages_all_lists_every_page_and_every_group(machine):
    from praisonaiui.builtin.catalog import BUILTIN_PLUGINS

    srv.set_pages("all")
    client, ids = _manifest_ids()
    builtin_ids = {spec.id for rec in BUILTIN_PLUGINS for spec in rec.pages()}
    pages = client.get("/api/shell/manifest").json()["pages"]
    assert builtin_ids - ids == set()
    assert {"own", "global-board", "chat", "start", "connect"} <= ids
    assert set(_groups(client)["shown"]) == {p.get("group") or "Other" for p in pages}


def test_set_pages_rejects_another_string():
    with pytest.raises(ValueError):
        srv.set_pages("chat")
