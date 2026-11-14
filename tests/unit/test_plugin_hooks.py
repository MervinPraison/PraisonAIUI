"""Plugin hooks for shell contributions (modularity gap G13): ``settings()``,
``nav_groups()`` and ``themes()`` on the AiuiPlugin contract."""

from __future__ import annotations

import json

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.plugin_registry import (
    NavGroupSpec,
    SettingsField,
    SettingsSectionSpec,
    ThemeSpec,
    get_plugin_registry,
    get_plugin_settings,
    register_plugin,
    set_extensions,
)


class HooksPlugin:
    name = "hooks"
    sdk = 1

    def pages(self):
        return [{"id": "hooks-page", "title": "Hooks", "kind": "blocks", "group": "Hooks"}]

    def settings(self):
        return [
            SettingsSectionSpec(
                id="general",
                title="General",
                description="How the plugin greets",
                order=10,
                fields=(
                    SettingsField(key="greeting", label="Greeting", default="Hello"),
                    {"key": "tone", "type": "select", "options": ["warm", {"value": "dry", "label": "Dry"}]},
                    {"key": "loud", "type": "boolean"},
                    {"key": "repeat", "type": "number", "default": 1},
                    {"key": "notes", "type": "text"},
                ),
            ),
            # Invalid entries are dropped one by one; the valid ones stay.
            {"id": "Bad Id", "title": "x", "fields": [{"key": "a"}]},
            {"id": "empty", "title": "No fields"},
            {"id": "general", "title": "Duplicate", "fields": [{"key": "a"}]},
            {"id": "badtype", "title": "x", "fields": [{"key": "a", "type": "color"}]},
        ]

    def nav_groups(self):
        return [NavGroupSpec(name="Hooks", order=250, folded=True), {"name": ""}, {"name": "X", "order": "1"}]

    def themes(self):
        return [
            ThemeSpec(id="sunrise", label="Sunrise", light={"--seed-accent": "#ea580c"}, dark={"seed-accent": "#fb923c"}),
            {"id": "inject", "light": {"--seed-accent": "red;}body{color:red"}},
            {"id": "notseed", "light": {"--background": "#fff"}},
            {"id": "url", "light": {"--seed-paper": "url(//example.com/x.png)"}},
            {"id": "empty"},
        ]

    def routes(self):
        from starlette.responses import JSONResponse
        from starlette.routing import Route

        async def ping(request):
            return JSONResponse({"pong": True})

        return [Route("/ping", ping)]


class _Loopback:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = [(k, v) for k, v in scope.get("headers", []) if k != b"host"]
            headers.append((b"host", b"127.0.0.1:8000"))
            scope = {**scope, "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8000), "headers": headers}
        await self.app(scope, receive, send)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(d))
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    srv.reset_state()
    yield d
    srv.reset_state()


@pytest.fixture
def plugin(data_dir):
    p = HooksPlugin()
    register_plugin(p)
    return p


def _record():
    reg = get_plugin_registry()
    return next(r for r in reg.active() if r.name == "hooks")


def test_contributions_wire_form(plugin):
    c = get_plugin_registry().contributions(_record())
    assert [s["id"] for s in c["settings"]] == ["general"]
    general = c["settings"][0]
    assert general["endpoint"] == "/api/plugins/hooks/settings/general"
    assert general["order"] == 10 and general["description"] == "How the plugin greets"
    fields = {f["key"]: f for f in general["fields"]}
    assert fields["greeting"] == {
        "key": "greeting", "label": "Greeting", "type": "string", "default": "Hello", "description": "",
    }
    # Defaults per type, labels fall back to the key, options normalised.
    assert fields["tone"]["default"] == "warm"
    assert fields["tone"]["options"] == [{"value": "warm", "label": "warm"}, {"value": "dry", "label": "Dry"}]
    assert fields["loud"]["default"] is False and fields["loud"]["label"] == "loud"
    assert fields["repeat"]["default"] == 1 and fields["notes"]["default"] == ""
    assert c["navGroups"] == [{"name": "Hooks", "order": 250, "folded": True}]
    # Only seed tokens with safe values; a bare name gets its "--".
    assert c["themes"] == [
        {"id": "sunrise", "label": "Sunrise", "light": {"--seed-accent": "#ea580c"}, "dark": {"--seed-accent": "#fb923c"}}
    ]
    json.dumps(c)  # wire-safe


def test_plugin_without_hooks_has_an_unchanged_record(data_dir):
    class Plain:
        name = "plain"

    register_plugin(Plain())
    rec = next(r for r in get_plugin_registry().records_for_manifest(restricted=False) if r["name"] == "plain")
    assert set(rec) == {"name", "entryPoint", "dist", "version", "status", "origin"}


def test_a_failing_hook_does_not_drop_the_others(data_dir):
    class Flaky:
        name = "flaky"

        def settings(self):
            raise RuntimeError("boom")

        def nav_groups(self):
            return [{"name": "Flaky", "order": 5}]

    register_plugin(Flaky())
    c = get_plugin_registry().contributions(next(r for r in get_plugin_registry().active() if r.name == "flaky"))
    assert c == {"navGroups": [{"name": "Flaky", "order": 5, "folded": False}]}


def test_manifest_records_carry_contributions_only_when_served(plugin, monkeypatch):
    m = srv._build_shell_manifest(restricted=False)
    rec = next(p for p in m["plugins"] if p["name"] == "hooks")
    assert rec["navGroups"][0]["name"] == "Hooks" and rec["settings"] and rec["themes"]
    # An entry-point plugin that is default-deny for a remote viewer lists no contributions.
    reg = get_plugin_registry()
    r = _record()
    monkeypatch.setattr(r, "autoloaded", True)
    monkeypatch.setattr(reg, "discover", lambda **_: [r])
    [restricted] = reg.records_for_manifest(restricted=True)
    assert restricted["status"] == "disabled-by-default"
    assert not {"settings", "navGroups", "themes"} & set(restricted)


def test_settings_values_round_trip_and_validate(plugin, data_dir):
    client = TestClient(_Loopback(srv.create_app()))
    url = "/api/plugins/hooks/settings/general"
    r = client.get(url)
    assert r.status_code == 200
    assert r.json() == {"values": {"greeting": "Hello", "tone": "warm", "loud": False, "repeat": 1, "notes": ""}}

    r = client.put(url, json={"values": {"tone": "dry", "loud": True, "notes": "a\nb"}})
    assert r.status_code == 200, r.text
    assert r.json()["values"] == {"greeting": "Hello", "tone": "dry", "loud": True, "repeat": 1, "notes": "a\nb"}
    saved = json.loads((data_dir / "plugin-settings" / "hooks.json").read_text())
    assert saved == {"general": {"tone": "dry", "loud": True, "notes": "a\nb"}}
    # The plugin's Python code reads the same values.
    assert get_plugin_settings("hooks", "general")["tone"] == "dry"

    # Bad values name each field; nothing is written.
    r = client.put(url, json={"values": {"tone": "loud", "repeat": "3", "loud": 1, "nope": 1}})
    assert r.status_code == 400
    assert set(r.json()["fields"]) == {"tone", "repeat", "loud", "nope"}
    assert get_plugin_settings("hooks", "general")["tone"] == "dry"
    assert client.put(url, json={"tone": "dry"}).status_code == 400
    assert client.put(url, content=b"not json").status_code == 400
    assert client.get("/api/plugins/hooks/settings/missing").status_code == 404
    # The plugin's own routes still answer next to the settings route.
    assert client.get("/api/plugins/hooks/ping").json() == {"pong": True}


def test_stale_stored_values_fall_back_to_defaults(plugin, data_dir):
    (data_dir / "plugin-settings").mkdir()
    (data_dir / "plugin-settings" / "hooks.json").write_text(
        json.dumps({"general": {"tone": "removed-option", "repeat": 4, "extra": 1}})
    )
    values = get_plugin_settings("hooks", "general")
    assert values["tone"] == "warm" and values["repeat"] == 4 and "extra" not in values
    (data_dir / "plugin-settings" / "hooks.json").write_text("{broken")
    assert get_plugin_settings("hooks", "general")["tone"] == "warm"


def test_settings_route_is_gated_like_the_other_plugin_routes(plugin):
    """A remote viewer of an entry-point plugin not named in extensions.enabled gets 404."""
    client = TestClient(srv.create_app())  # not loopback: a remote viewer
    _record().autoloaded = True  # behave like an entry-point plugin (default-deny)
    url = "/api/plugins/hooks/settings/general"
    assert client.get(url).status_code == 404
    assert client.put(url, json={"values": {"tone": "dry"}}).status_code == 404
    set_extensions(enabled=["hooks"])
    assert client.get(url).status_code == 200


def test_values_of_an_undeclared_section_are_returned_raw(data_dir):
    (data_dir / "plugin-settings").mkdir()
    (data_dir / "plugin-settings" / "gone.json").write_text(json.dumps({"old": {"k": 1}}))
    assert get_plugin_settings("gone", "old") == {"k": 1}
    assert get_plugin_settings("gone", "nothing") == {}
