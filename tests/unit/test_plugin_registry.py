"""Entry-point plugin registry + React app shell manifest (style="app")."""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import textwrap

import pytest
from starlette.testclient import TestClient

import praisonaiui.config_store as config_store
import praisonaiui.dashboard_plugins as dp
import praisonaiui.server as srv
from praisonaiui.plugin_registry import (
    ENTRY_POINT_GROUP,
    ExtensionPolicy,
    PageSpec,
    get_plugin_registry,
    sanitize_plugin_name,
    set_extensions,
)

FAKE_PLUGIN = textwrap.dedent(
    '''
    from pathlib import Path
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    from praisonaiui.plugin_registry import BlockSpec, PageSpec, ToolRendererSpec
    from praisonaiui.features._base import BaseFeatureProtocol

    LOADS = []

    class _Feat(BaseFeatureProtocol):
        feature_name = "fakeplug-feature"
        feature_description = "test"
        @property
        def name(self):
            return self.feature_name
        @property
        def description(self):
            return self.feature_description
        def routes(self):
            async def ping(request):
                return JSONResponse({"pong": True})
            return [Route("/api/fakeplug-feature/ping", ping)]
        async def health(self):
            return {"status": "ok"}

    class FakePlugin:
        name = "fakeplug"
        version = "0.1.0"
        sdk = 1
        def __init__(self):
            LOADS.append(1)
            self.setup_ctx = None
        def setup(self, ctx):
            self.setup_ctx = ctx
        def pages(self):
            return [
                PageSpec(id="kanban-pro", title="Kanban Pro", kind="react",
                         module="pages/kanban.js", css="pages/kanban.css",
                         icon="kanban", group="Work", order=5),
                PageSpec(id="fake-report", title="Report", kind="blocks"),
                PageSpec(id="overview", title="Shadowed", kind="react", module="pages/kanban.js"),
            ]
        def blocks(self):
            return [BlockSpec(type="gantt", module="blocks/gantt.js")]
        def tool_renderers(self):
            return [ToolRendererSpec(tool_name="web_search", module="tools/search.js")]
        def routes(self):
            async def report(request):
                return JSONResponse({"_components": [{"type": "text", "content": "hi"}]})
            return [Route("/pages/fake-report", report)]
        def static_dir(self):
            return Path(__file__).parent / "fakeplug_static"
        def features(self):
            return [_Feat()]
        def cli_commands(self):
            return None

    plugin = FakePlugin
    '''
)


def _write_dist(root, dist, eps: dict[str, str]):
    info = root / f"{dist}-0.1.0.dist-info"
    info.mkdir(parents=True)
    (info / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {dist}\nVersion: 0.1.0\n")
    lines = [f"[{ENTRY_POINT_GROUP}]"] + [f"{k} = {v}" for k, v in eps.items()]
    (info / "entry_points.txt").write_text("\n".join(lines) + "\n")


_MODS = ("fakeplug_mod", "broken_mod", "never_mod", "future_mod", "badname_mod", "__never_imported__")


@pytest.fixture
def site(tmp_path, monkeypatch):
    """A tmp site-packages dir with real dist-info entry points on sys.path."""
    sp = tmp_path / "site"
    sp.mkdir()
    (sp / "fakeplug_mod.py").write_text(FAKE_PLUGIN)
    static = sp / "fakeplug_static"
    for rel, body in {
        "pages/kanban.js": "export default function K(){return null}",
        "pages/kanban.css": ".k{}",
        "blocks/gantt.js": "export default () => null",
        "tools/search.js": "export default () => null",
    }.items():
        f = static / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    (tmp_path / "secret.txt").write_text("nope")
    (sp / "broken_mod.py").write_text("raise RuntimeError('boom at import')\n")
    (sp / "never_mod.py").write_text("import sys; sys.modules['__never_imported__'] = 1\n")
    (sp / "future_mod.py").write_text("class P:\n    name='future'\n    sdk=2\nplugin=P()\n")
    (sp / "badname_mod.py").write_text("class P:\n    name='x'\nplugin=P()\n")
    _write_dist(sp, "fakeplug", {"fakeplug": "fakeplug_mod:plugin"})
    _write_dist(sp, "brokenplug", {"broken": "broken_mod:plugin"})
    _write_dist(sp, "neverplug", {"never": "never_mod:plugin"})
    _write_dist(sp, "futureplug", {"future": "future_mod:plugin"})
    _write_dist(sp, "badnameplug", {"Bad.Name!": "badname_mod:plugin"})
    monkeypatch.syspath_prepend(str(sp))
    for m in _MODS:
        sys.modules.pop(m, None)
    # isolate legacy dashboard-plugins discovery
    monkeypatch.setattr(dp.Path, "home", classmethod(lambda cls: tmp_path / "home"))
    bundled = tmp_path / "bundled"
    (bundled / "legacy-board").mkdir(parents=True)
    (bundled / "legacy-board" / "manifest.json").write_text(
        json.dumps({"name": "legacy-board", "label": "Legacy Board", "css": "s.css"})
    )
    (bundled / "legacy-board" / "index.js").write_text("// legacy")
    monkeypatch.setattr(dp, "_BUILTIN_PLUGIN_ROOT", bundled)
    monkeypatch.delenv("AIUI_SHELL", raising=False)
    monkeypatch.delenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", raising=False)
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield sp
    srv.reset_state()
    for m in _MODS:
        sys.modules.pop(m, None)


def _records():
    return {r.name: r for r in get_plugin_registry().discover(refresh=True)}


class _Loopback:
    """ASGI wrapper making every request look like it came over 127.0.0.1."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = {**scope, "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8000)}
        await self.app(scope, receive, send)


def _local(**cfg) -> TestClient:
    """A viewer on the same machine (plugin browser surfaces allowed)."""
    return TestClient(_Loopback(srv.create_app(config=cfg or None)))


def _remote(**cfg) -> TestClient:
    """TestClient's default addresses are not loopback: a remote viewer."""
    return TestClient(srv.create_app(config=cfg or None))


# ── discovery ────────────────────────────────────────────────────────


def test_discovers_real_entry_points_and_isolates_failures(site):
    recs = _records()
    assert recs["fakeplug"].status == "ok"
    assert recs["fakeplug"].dist == "fakeplug" and recs["fakeplug"].version == "0.1.0"
    assert recs["broken"].status == "error" and "boom at import" in recs["broken"].error
    assert recs["future"].status == "incompatible"


def test_discovery_is_cached(site):
    reg = get_plugin_registry()
    reg.discover(refresh=True)
    reg.discover()
    reg.pages()
    reg.blocks()
    assert sys.modules["fakeplug_mod"].LOADS == [1]


def test_disabled_plugin_is_never_imported(site):
    get_plugin_registry().set_policy(ExtensionPolicy(disabled=["never"]))
    recs = _records()
    assert recs["never"].status == "disabled"
    assert "__never_imported__" not in sys.modules


def test_allowlist(site):
    get_plugin_registry().set_policy(ExtensionPolicy(enabled=["fakeplug"]))
    recs = _records()
    assert recs["fakeplug"].status == "ok"
    assert {recs[n].status for n in ("broken", "never", "future", "bad-name")} == {"disabled"}


def test_autoload_kill_switch(site, monkeypatch):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    assert _records() == {}


def test_manual_register_without_packaging(site, monkeypatch):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")

    class Inline:
        name = "inline"

        def pages(self):
            return [PageSpec(id="inline", title="Inline", kind="iframe", module="https://x.y")]

    get_plugin_registry().register(Inline())
    assert [p.id for p in get_plugin_registry().pages()] == ["inline"]
    # in-process plugins are trusted even for restricted (remote/auth) viewers
    assert [p.id for p in get_plugin_registry().pages(restricted=True)] == ["inline"]


def test_dict_specs_and_bad_spec_isolation(site, monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")
    static = tmp_path / "inline_static"
    static.mkdir()
    (static / "b.js").write_text("export default () => null")

    class Inline:
        name = "inline"

        def static_dir(self):
            return static

        def pages(self):
            return [
                {"id": "bad", "title": "Bad", "unknownKey": 1},  # TypeError
                {"id": "esc", "title": "Esc", "kind": "react", "module": "../x.js"},  # escapes
                {"id": "ok", "title": "OK", "kind": "blocks", "apiEndpoint": "/api/x"},
            ]

        def blocks(self):
            return [{"type": "chart", "module": "b.js"}]

        def tool_renderers(self):
            return [{"toolName": "web_search", "module": "b.js"}]

    get_plugin_registry().register(Inline())
    reg = get_plugin_registry()
    pages = reg.pages()
    assert [p.id for p in pages] == ["ok"] and pages[0].api_endpoint == "/api/x"
    (block,) = reg.blocks()
    assert block.type == "chart" and block.module == "/_plugins/inline/b.js"
    assert block.integrity.startswith("sha384-")
    (tool,) = reg.tool_renderers()
    assert tool.to_dict()["toolName"] == "web_search" and tool.source == "plugin:inline"


# ── names ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("fakeplug", "fakeplug"),
        ("Kanban_Pro", "kanban_pro"),
        ("Bad.Name!", "bad-name"),
        ("../../etc", "etc"),
        ("a/b", "a-b"),
        ("--", None),
        ("", None),
        ("x" * 80, "x" * 64),
    ],
)
def test_sanitize_plugin_name(raw, expected):
    assert sanitize_plugin_name(raw) == expected


def test_entry_point_names_are_sanitized_for_mounts(site):
    recs = _records()
    assert "bad-name" in recs and recs["bad-name"].status == "ok"
    set_extensions(enabled=["Bad.Name!"])  # policy matches raw or sanitized name
    assert _records()["bad-name"].status == "ok"


def test_invalid_manual_name_is_rejected(site, monkeypatch):
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")

    class Weird:
        name = "///"

    get_plugin_registry().register(Weird())
    (rec,) = _records().values()
    assert rec.status == "error" and "invalid plugin name" in rec.error


# ── server integration ───────────────────────────────────────────────


def test_yaml_extensions_section_disables(site):
    client = _local(style="app", extensions={"disabled": ["fakeplug"]})
    names = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert names["fakeplug"] == "disabled"


def test_set_extensions_beats_yaml(site):
    set_extensions(enabled=["fakeplug"])
    client = _local(style="app", extensions={"disabled": ["fakeplug"]})
    names = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert names["fakeplug"] == "ok"


def test_data_dir_config_yaml_extensions_applied(site, tmp_path):
    (tmp_path / "data" / "config.yaml").write_text("extensions:\n  disabled: [fakeplug]\n")
    client = _local(style="app")
    names = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert names["fakeplug"] == "disabled"
    assert "fakeplug_mod" not in sys.modules


def test_shell_manifest_merges_all_page_sources(site):
    srv.set_style("app")
    srv.register_page("metrics", title="Metrics", handler=lambda: {"_components": []})
    srv.register_page("viewonly", title="View Only")  # rendered by custom.js registerView

    @srv.register_page_action("metrics")
    async def _act(data):
        return {"ok": True}

    client = _local()
    m = client.get("/api/shell/manifest").json()
    assert m["sdk"] == 1 and m["style"] == "app"
    pages = {p["id"]: p for p in m["pages"]}
    assert pages["overview"]["kind"] == "legacy" and pages["overview"]["source"] == "builtin"
    assert pages["metrics"]["kind"] == "blocks" and pages["metrics"]["source"] == "app"
    assert pages["metrics"]["actionEndpoint"] == "/api/pages/metrics/action"
    assert pages["viewonly"]["kind"] == "legacy"
    k = pages["kanban-pro"]
    assert k["kind"] == "react" and k["module"] == "/_plugins/fakeplug/pages/kanban.js"
    assert k["css"] == "/_plugins/fakeplug/pages/kanban.css"
    assert k["integrity"].startswith("sha384-") and k["source"] == "plugin:fakeplug"
    # The page stylesheet gets its own SRI hash (the shell sets <link integrity>).
    css_sri = "sha384-" + base64.b64encode(hashlib.sha384(b".k{}").digest()).decode()
    assert k["cssIntegrity"] == css_sri and k["cssIntegrity"] != k["integrity"]
    assert pages["fake-report"]["apiEndpoint"] == "/api/plugins/fakeplug/pages/fake-report"
    lb = pages["legacy-board"]
    assert lb["kind"] == "legacy" and lb["module"] == "/dashboard-plugins/legacy-board/index.js"
    assert lb["css"] == "/dashboard-plugins/legacy-board/s.css"
    assert m["blocks"] == [
        {
            "type": "gantt",
            "module": "/_plugins/fakeplug/blocks/gantt.js",
            "integrity": m["blocks"][0]["integrity"],
            "source": "plugin:fakeplug",
        }
    ]
    assert m["toolRenderers"][0]["toolName"] == "web_search"
    assert [p["id"] for p in m["pages"]] == sorted(
        [p["id"] for p in m["pages"]],
        key=lambda i: (pages[i].get("order", 100), i),
    )


def test_plugin_page_shadowed_by_builtin_logs_warning(site, caplog):
    srv.set_style("app")
    with caplog.at_level("WARNING"):
        pages = {p["id"]: p for p in _local().get("/api/shell/manifest").json()["pages"]}
    assert pages["overview"]["source"] == "builtin"
    assert any("shadowed" in r.getMessage() and "overview" in r.getMessage() for r in caplog.records)


def test_plugin_routes_static_and_feature_mounted(site):
    client = _local(style="app")
    assert client.get("/api/plugins/fakeplug/pages/fake-report").json()["_components"]
    r = client.get("/_plugins/fakeplug/pages/kanban.js")
    assert r.status_code == 200 and "export default" in r.text
    # traversal never escapes the plugin static dir (SPA fallback or 404, never the file)
    for path in ("/_plugins/fakeplug/../secret.txt", "/_plugins/fakeplug/%2e%2e/secret.txt",
                 "/_plugins/fakeplug/..%2fsecret.txt", "/_plugins/fakeplug/%2e%2e%2f..%2fsecret.txt"):
        assert "nope" not in client.get(path).text, path
    assert client.get("/api/fakeplug-feature/ping").json() == {"pong": True}
    plugin = next(r for r in get_plugin_registry().active() if r.name == "fakeplug").plugin
    assert plugin.setup_ctx["style"] == "app"


def test_legacy_api_pages_gets_blocks_plugin_pages_only(site):
    srv.set_style("dashboard")
    client = _local()
    ids = {p["id"] for p in client.get("/api/pages").json()["pages"]}
    assert "fake-report" in ids  # blocks: renderable by legacy dashboard
    assert "kanban-pro" not in ids  # react module: app shell only


def test_app_index_html_inlines_plugin_pages_and_integrity(site):
    srv.set_style("app")
    client = _local()
    text = client.get("/").text
    boot = text.split('id="aiui-boot" type="application/json">')[1].split("</script>")[0]
    assert {p["id"] for p in json.loads(boot)["pages"]} >= {"chat", "kanban-pro"}
    importmap = json.loads(text.split('<script type="importmap">')[1].split("</script>")[0])
    assert importmap["integrity"]["/_plugins/fakeplug/pages/kanban.js"].startswith("sha384-")
    assert set(importmap["integrity"]) == {
        "/_plugins/fakeplug/pages/kanban.js",
        "/_plugins/fakeplug/blocks/gantt.js",
        "/_plugins/fakeplug/tools/search.js",
    }
    # broken plugin's error string never reaches the inline copy
    rec = next(p for p in json.loads(boot)["plugins"] if p["name"] == "broken")
    assert rec["status"] == "error" and "error" not in rec
    # deep link served by SPA fallback
    assert "aiui-boot" in client.get("/kanban-pro").text


def test_dashboard_style_unchanged(site):
    client = _local()  # default style
    html = client.get("/").text
    assert "plugin-loader.js" in html
    assert "importmap" not in html and "aiui-boot" not in html
    assert "dashboard" in client.get("/plugins/plugins.json").json()["plugins"]


# ── trust: browser surfaces default-deny for remote / auth ───────────


def _js_surfaces(client: TestClient) -> dict:
    m = client.get("/api/shell/manifest").json()
    return {
        "pages": {p["id"] for p in m["pages"] if p.get("source", "").startswith("plugin:")},
        "blocks": [b["type"] for b in m["blocks"]],
        "tools": [t["toolName"] for t in m["toolRenderers"]],
        "status": {p["name"]: p["status"] for p in m["plugins"]},
        "static": client.get("/_plugins/fakeplug/pages/kanban.js").status_code,
    }


def test_remote_viewer_gets_no_plugin_js_by_default(site):
    srv.set_style("app")
    s = _js_surfaces(_remote())
    assert s["pages"] == set() and s["blocks"] == [] and s["tools"] == []
    assert s["status"]["fakeplug"] == "disabled-by-default"
    assert s["static"] == 404
    # "disabled-by-default" covers the plugin's HTTP routes too (review r1:
    # the label said off while /api/plugins/<name>/* answered remotely)
    assert _remote().get("/api/plugins/fakeplug/pages/fake-report").status_code == 404
    assert _local().get("/api/plugins/fakeplug/pages/fake-report").status_code == 200


def test_remote_viewer_gets_explicitly_enabled_plugin(site):
    srv.set_style("app")
    set_extensions(enabled=["fakeplug"])
    s = _js_surfaces(_remote())
    assert s["pages"] == {"kanban-pro", "fake-report"}
    assert s["blocks"] == ["gantt"] and s["tools"] == ["web_search"]
    assert s["status"]["fakeplug"] == "ok"
    assert s["static"] == 200
    assert _remote().get("/api/plugins/fakeplug/pages/fake-report").status_code == 200


def test_yaml_enabled_list_opts_in_remote(site):
    srv.set_style("app")
    client = _remote(style="app", extensions={"enabled": ["fakeplug"]})
    assert _js_surfaces(client)["static"] == 200


def test_local_viewer_gets_all_plugins_without_auth(site):
    srv.set_style("app")
    s = _js_surfaces(_local())
    assert s["pages"] == {"kanban-pro", "fake-report"} and s["static"] == 200
    assert s["status"]["fakeplug"] == "ok"


def test_forwarded_request_counts_as_remote(site):
    srv.set_style("app")
    client = _local()
    hdrs = {"X-Forwarded-For": "203.0.113.9"}
    m = client.get("/api/shell/manifest", headers=hdrs).json()
    assert not [p for p in m["pages"] if p.get("source", "").startswith("plugin:")]
    assert client.get("/_plugins/fakeplug/pages/kanban.js", headers=hdrs).status_code == 404


def test_require_auth_restricts_even_local_viewers(site):
    from praisonaiui.auth import create_token, register_user

    srv.set_style("app")
    client = TestClient(_Loopback(srv.create_app(require_auth=True)))
    # require_auth gates the manifest itself; a signed-in viewer reads it
    assert client.get("/api/shell/manifest").status_code == 401
    token = create_token(register_user("plugin-viewer", "pw-plugin-1")["id"])
    client.headers["Authorization"] = f"Bearer {token}"
    s = _js_surfaces(client)
    assert s["pages"] == set() and s["static"] == 404
    assert s["status"]["fakeplug"] == "disabled-by-default"


def test_remote_legacy_api_pages_hides_unenabled_plugin_pages(site):
    srv.set_style("dashboard")
    ids = {p["id"] for p in _remote().get("/api/pages").json()["pages"]}
    assert "fake-report" not in ids


def test_remote_index_html_has_no_plugin_integrity(site):
    srv.set_style("app")
    text = _remote().get("/").text
    importmap = json.loads(text.split('<script type="importmap">')[1].split("</script>")[0])
    assert "integrity" not in importmap


def test_sri_follows_file_changes(site):
    srv.set_style("app")
    client = _local()

    def integrity():
        pages = {p["id"]: p for p in client.get("/api/shell/manifest").json()["pages"]}
        return pages["kanban-pro"]["integrity"]

    first = integrity()
    assert integrity() == first  # cached, stable
    (site / "fakeplug_static" / "pages" / "kanban.js").write_text(
        "export default function K(){return 'changed and longer'}"
    )
    assert integrity() != first
