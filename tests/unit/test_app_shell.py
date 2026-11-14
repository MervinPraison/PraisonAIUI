"""Server side of the React app shell (style ``app``, ADR-0001).

Covers: legacy styles unchanged (golden HTML), the app host HTML (import map,
boot manifest, escaping, auth-minimal boot), plugins.json, the shell manifest,
the externals shims (React export coverage), the AIUI_SHELL matrix, the
``extensions`` policy from the data-dir config.yaml, /assets cache headers and
WebSocket auth under AUTH_ENFORCE.
"""

from __future__ import annotations

import html.parser
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.plugin_registry import get_plugin_registry, resolve_shell_style

REPO = Path(__file__).resolve().parents[2]
GOLDEN = Path(__file__).parent / "fixtures" / "golden_dashboard_html.txt"
FRONTEND = REPO / "src" / "frontend"


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Fresh server state and a private data dir / config store per test."""
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield data
    srv.reset_state()


def _client(**cfg) -> TestClient:
    return TestClient(srv.create_app(config=cfg or None))


def _golden() -> dict[str, str]:
    out: dict[str, str] = {}
    current = None
    for line in GOLDEN.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^===== style=(\w+) =====$", line)
        if m:
            current = m.group(1)
            out[current] = ""
        elif current is not None:
            out[current] += line
    return out


def _normalized_html(style: str, monkeypatch) -> str:
    monkeypatch.setattr(srv, "_server_start_time", 0)
    srv.set_style(style)
    return srv._build_html(style)


def _boot(html_text: str) -> dict:
    raw = html_text.split('<script id="aiui-boot" type="application/json">', 1)[1]
    return json.loads(raw.split("</script>", 1)[0])


class _ScriptCollector(html.parser.HTMLParser):
    """Records <script> tags in document order (type, src, id)."""

    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[dict[str, str | None]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append(dict(attrs))


def _scripts(html_text: str) -> list[dict[str, str | None]]:
    p = _ScriptCollector()
    p.feed(html_text)
    return p.scripts


# ── legacy styles unchanged ──────────────────────────────────────────


def test_dashboard_html_equals_golden(monkeypatch):
    assert _normalized_html("dashboard", monkeypatch) == _golden()["dashboard"]


def test_chat_html_equals_golden(monkeypatch):
    assert _normalized_html("chat", monkeypatch) == _golden()["chat"]


def test_docs_html_only_changes_anti_flicker_tokens(monkeypatch):
    expected = (
        _golden()["docs"]
        .replace("hsl(var(--background))", "var(--background)")
        .replace("hsl(var(--foreground))", "var(--foreground)")
    )
    assert _normalized_html("docs", monkeypatch) == expected
    assert "hsl(var(" not in expected


def test_dashboard_served_html_unchanged(monkeypatch):
    monkeypatch.setattr(srv, "_server_start_time", 0)
    srv.set_style("dashboard")
    client = _client()
    assert client.get("/").text == _golden()["dashboard"]
    assert "dashboard" in client.get("/plugins/plugins.json").json()["plugins"]


# ── app host HTML ────────────────────────────────────────────────────


def test_app_html_structure():
    srv.set_style("app")
    client = _client()
    text = client.get("/").text
    assert text.startswith(
        '<!doctype html><html lang="en" data-aiui-shell="react" data-aiui-theme-default="system">'
    )
    scripts = _scripts(text)
    types = [s.get("type") for s in scripts]
    assert types.count("importmap") == 1
    first_module = types.index("module")
    assert types.index("importmap") < first_module, "import map must precede module scripts"
    importmap = json.loads(text.split('<script type="importmap">', 1)[1].split("</script>", 1)[0])
    assert set(importmap["imports"]) == {
        "react", "react/jsx-runtime", "react-dom", "react-dom/client", "@aiui/sdk",
    }
    assert all(re.search(r"\?v=\d+$", url) for url in importmap["imports"].values())
    entry = scripts[first_module]
    assert re.fullmatch(r"/assets/index\.js\?v=\d+", entry["src"] or "")
    assert re.search(r'<link rel="stylesheet" href="/assets/index\.css\?v=\d+">', text)
    assert "/_shell" not in text
    assert re.search(r'window\.__AIUI_BUILD__="\d+"', text)
    assert "/plugins/plugin-loader.js?v=" in text
    boot = _boot(text)
    assert boot["sdk"] == 1 and boot["style"] == "app"
    assert {"chat", "overview", "sessions", "config"} <= {p["id"] for p in boot["pages"]}
    assert '<style id="aiui-custom-css">' not in text
    assert re.search(r"<title>[^<]* Dashboard</title>", text), "same tab title as dashboard"
    # deep links get the same shell
    assert 'data-aiui-shell="react"' in client.get("/overview").text


def test_app_deep_link_to_every_page_serves_the_shell():
    """Opening /<page id> in a browser shows the app, even when a JSON API
    shares the path (GET /agents, GET /sessions)."""
    srv.set_style("app")
    client = _client()
    nav = {"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
    ids = [p["id"] for p in client.get("/api/shell/manifest").json()["pages"]]
    assert {"agents", "sessions"} <= set(ids)
    for page_id in ids:
        res = client.get(f"/{page_id}", headers=nav)
        assert res.status_code == 200, page_id
        assert res.headers["content-type"].startswith("text/html"), page_id
        assert 'data-aiui-shell="react"' in res.text, page_id


def test_app_page_paths_keep_their_json_api_for_api_clients():
    srv.set_style("app")
    client = _client()
    assert "agents" in client.get("/agents").json()
    assert "sessions" in client.get("/sessions", headers={"accept": "application/json"}).json()


def test_dashboard_agents_path_stays_json_for_browsers():
    srv.set_style("dashboard")
    client = _client()
    res = client.get("/agents", headers={"accept": "text/html"})
    assert res.headers["content-type"].startswith("application/json")


def test_app_plugins_json_keeps_dashboard_modules():
    srv.set_style("app")
    srv.set_dashboard(modules=["jobs", "auth", "api", "bogus"])
    client = _client()
    plugins = client.get("/plugins/plugins.json").json()["plugins"]
    assert plugins == ["fetch-retry", "jobs", "auth", "api"]
    assert "dashboard" not in plugins


def test_app_plugins_json_minimal_by_default():
    srv.set_style("app")
    assert _client().get("/plugins/plugins.json").json() == {"plugins": ["fetch-retry"]}


def test_app_custom_js_and_css_still_injected(tmp_path):
    js = tmp_path / "ext.js"
    js.write_text("window.aiui.registerView('viewonly', function(){})")
    srv.set_style("app")
    srv.set_custom_js(js)
    srv.set_custom_css("body{color:red}")
    client = _client()
    text = client.get("/").text
    assert "/custom.js?v=" in text and "a.__queue" in text
    assert 'id="aiui-custom-css"' in text
    assert client.get("/api/shell/manifest").json()["legacy"]["customJs"] == "/custom.js"


def test_boot_json_escapes_markup():
    srv.set_style("app")
    evil = "</script><!--<script>alert(1)</script>&amp;"
    srv.register_page("evil", title=evil, description="a > b & c")
    text = _client().get("/").text
    raw = text.split('<script id="aiui-boot" type="application/json">', 1)[1].split("</script>", 1)[0]
    assert "<" not in raw and ">" not in raw and "&" not in raw
    pages = {p["id"]: p for p in json.loads(raw)["pages"]}
    assert pages["evil"]["title"] == evil
    assert pages["evil"]["description"] == "a > b & c"
    # the boot block cannot swallow the module script that follows it
    assert [s.get("type") for s in _scripts(text)].count("module") == 1
    assert text.count('src="/assets/index.js?v=') == 1


def test_boot_json_escapes_js_line_separators():
    srv.set_style("app")
    srv.register_page("seps", title="a\u2028b\u2029c")
    raw = _client().get("/").text.split('id="aiui-boot" type="application/json">', 1)[1]
    raw = raw.split("</script>", 1)[0]
    assert "\u2028" not in raw and "\u2029" not in raw
    assert {p["id"]: p for p in json.loads(raw)["pages"]}["seps"]["title"] == "a\u2028b\u2029c"


def test_shell_manifest_site_theme_follows_set_theme():
    srv.set_style("app")
    srv.set_theme(preset="rose", dark_mode=False, radius="lg")
    m = _client().get("/api/shell/manifest").json()
    assert m["site"]["theme"] == {"preset": "rose", "mode": "light", "radius": "lg"}


@pytest.mark.parametrize("mode", ["require_auth", "AUTH_ENFORCE"])
def test_boot_is_minimal_when_auth_enforced(monkeypatch, mode):
    srv.set_style("app")
    if mode == "require_auth":
        app = srv.create_app(require_auth=True)
    else:
        monkeypatch.setenv("AUTH_ENFORCE", "true")
        app = srv.create_app()
    text = TestClient(app).get("/").text
    boot = _boot(text)
    assert set(boot) == {"sdk", "version", "style"}
    assert boot["style"] == "app"
    assert "overview" not in text.split('id="aiui-boot"', 1)[1].split("</script>", 1)[0]


def test_inline_boot_never_carries_plugin_errors():
    class Broken:
        name = "broken"
        sdk = 99  # incompatible -> error string

    get_plugin_registry().register(Broken())
    srv.set_style("app")
    client = _client()
    boot = _boot(client.get("/").text)
    rec = next(p for p in boot["plugins"] if p["name"] == "broken")
    assert rec["status"] == "incompatible" and "error" not in rec
    full = client.get("/api/shell/manifest").json()
    assert "SDK v99" in next(p for p in full["plugins"] if p["name"] == "broken")["error"]


def test_app_server_theme_tag_uses_seeds(monkeypatch):
    calls = []

    def fake_seed(preset=None, radius=None, accent=None, density=None):
        calls.append({"preset": preset, "radius": radius, "accent": accent})
        return ":root{--seed-accent:#123456;}"

    import praisonaiui.themes as themes

    monkeypatch.setattr(themes, "get_seed_theme_css", fake_seed)
    srv.set_style("app")
    srv.set_theme(preset="rose", dark_mode=True, radius="lg")
    srv.set_brand_color("#ff0000")
    text = srv._build_html("app")
    tag = re.search(r'<style id="aiui-server-theme">(.*?)</style>', text).group(1)
    assert tag == ":root{--seed-accent:#123456;}"
    assert "!important" not in tag
    assert calls[-1] == {"preset": "rose", "radius": "0.75rem", "accent": "#ff0000"}


def test_app_server_theme_tag_custom_theme_accent(monkeypatch):
    seen = {}

    def fake_seed(preset=None, radius=None, accent=None, density=None):
        seen.update(preset=preset, accent=accent)
        return ""

    import praisonaiui.themes as themes

    monkeypatch.setattr(themes, "get_seed_theme_css", fake_seed)
    srv.register_theme("ocean", {"accent": "#0077b6"})
    srv.set_theme(preset="ocean")
    text = srv._build_html("app")
    # a register_theme() name is not a seed preset; its accent carries it
    assert seen == {"preset": None, "accent": "#0077b6"}
    assert 'id="aiui-server-theme"' not in text  # empty seed css -> no tag


def test_app_server_theme_tag_forwards_preset_accent(monkeypatch):
    """ThemeManager's accent is always forwarded (the seed function treats a
    preset's own accent as the preset itself)."""
    from praisonaiui.features.theme import PRESET_COLORS

    seen = {}

    def fake_seed(preset=None, radius=None, accent=None, density=None):
        seen.update(preset=preset, accent=accent, density=density)
        return ""

    import praisonaiui.themes as themes

    monkeypatch.setattr(themes, "get_seed_theme_css", fake_seed)
    srv.set_theme(preset="blue")
    srv._build_html("app")
    assert seen == {"preset": "blue", "accent": PRESET_COLORS["blue"]["accent"], "density": None}


def test_app_server_theme_tag_never_forces_legacy_accent_vars():
    """Under the shell the --db-accent/--db-accent-glow/--db-radius overrides
    (!important on the dashboard style) would beat the token bridge and user
    CSS; only seeds and the --db-accent-rgb triple may be emitted."""
    srv.set_theme(preset="rose", radius="lg")
    srv.set_brand_color("#ff0000")
    m = re.search(r'<style id="aiui-server-theme">(.*?)</style>', srv._build_html("app"), re.S)
    tag = m.group(1) if m else ""
    assert "!important" not in tag
    for var in ("--db-accent:", "--db-accent-glow", "--db-radius", "--background:", "--primary:"):
        assert var not in tag, var
    # the dashboard style keeps its !important accent tag
    assert re.search(
        r'<style id="aiui-server-theme">:root\{[^}]*--db-accent:[^;]*!important',
        srv._build_html("dashboard"),
    )


def test_yaml_site_theme_reaches_shell_theme(_isolated, monkeypatch):
    seen = {}

    def fake_seed(preset=None, radius=None, accent=None, density=None):
        seen.update(preset=preset, radius=radius, accent=accent, density=density)
        return ":root{--seed-accent:#0f0;}"

    import praisonaiui.themes as themes

    monkeypatch.setattr(themes, "get_seed_theme_css", fake_seed)
    (_isolated / "config.yaml").write_text(
        "site:\n  theme:\n    preset: violet\n    radius: xl\n    darkMode: false\n"
        "    accent: '#123456'\n    density: compact\n"
    )
    srv.set_style("app")
    client = _client()
    assert '<style id="aiui-server-theme">:root{--seed-accent:#0f0;}</style>' in client.get("/").text
    assert seen == {"preset": "violet", "radius": "1rem", "accent": "#123456", "density": "compact"}
    theme = client.get("/api/shell/manifest").json()["site"]["theme"]
    assert theme == {"preset": "violet", "mode": "light", "radius": "xl"}
    # the legacy views hosted by the shell read the same state
    state = client.get("/api/theme").json()
    assert (state["preset"], state["mode"], state["radius"]) == ("violet", "light", "xl")


def test_set_theme_beats_yaml_site_theme(_isolated):
    (_isolated / "config.yaml").write_text("site:\n  theme:\n    preset: violet\n")
    srv.set_style("app")
    srv.set_theme(preset="teal")
    m = _client().get("/api/shell/manifest").json()
    assert m["site"]["theme"]["preset"] == "teal"


def test_yaml_site_theme_not_synced_for_dashboard(_isolated):
    """The legacy dashboard keeps today's behaviour (its server tag follows
    the ThemeManager only)."""
    from praisonaiui.features.theme import get_theme_manager

    (_isolated / "config.yaml").write_text("site:\n  theme:\n    preset: violet\n")
    srv.set_style("dashboard")
    _client()
    assert get_theme_manager().get_theme() == "zinc"


def test_theme_config_accepts_accent_and_density():
    from pydantic import ValidationError

    from praisonaiui.schema.models import ThemeConfig

    t = ThemeConfig.model_validate({"preset": "rose", "accent": "#ff0000", "density": "compact"})
    assert t.accent == "#ff0000" and t.density == "compact"
    assert ThemeConfig().accent is None and ThemeConfig().density is None
    with pytest.raises(ValidationError):
        ThemeConfig.model_validate({"density": "huge"})


def _bootstrap_js(text: str) -> str:
    return text.split('<script id="aiui-theme-bootstrap">', 1)[1].split("</script>", 1)[0]


def _run_bootstrap(js: str, stored, prefers_dark: bool, default: str | None = None) -> bool:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    harness = (
        "const cls=new Set();"
        "globalThis.document={documentElement:{classList:"
        "{add:c=>cls.add(c),remove:c=>cls.delete(c)},"
        f"getAttribute:()=>{json.dumps(default)}}}}};"
        f"const stored={json.dumps(stored)};"
        "globalThis.localStorage={getItem:()=>stored};"
        f"globalThis.matchMedia=()=>({{matches:{'true' if prefers_dark else 'false'}}});"
        + js
        + ";console.log(JSON.stringify(cls.has('dark')));"
    )
    res = subprocess.run([node, "-e", harness], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


@pytest.mark.parametrize(
    "stored,prefers_dark,dark",
    [
        (None, True, True),  # first visit follows the OS (next-themes defaultTheme=system)
        (None, False, False),
        ("system", True, True),
        ("system", False, False),
        ("dark", False, True),
        ("light", True, False),
    ],
)
def test_app_theme_bootstrap_defaults_to_system(stored, prefers_dark, dark):
    js = _bootstrap_js(srv._build_html("app"))
    assert _run_bootstrap(js, stored, prefers_dark) is dark


def _theme_default_attr(text: str) -> str:
    return re.search(r'data-aiui-theme-default="(\w+)"', text).group(1)


@pytest.mark.parametrize("dark_mode,expected", [(True, "dark"), (False, "light")])
def test_app_shell_follows_set_theme_dark_mode(dark_mode, expected):
    """set_theme(dark_mode=...) decides the first-visit mode under app, as it
    does for the legacy dashboard, whatever the OS prefers."""
    prev = srv._theme
    try:
        srv.set_theme(preset="indigo", dark_mode=dark_mode)
        text = srv._build_html("app")
    finally:
        srv._theme = prev
    assert _theme_default_attr(text) == expected
    js = _bootstrap_js(text)
    for prefers_dark in (True, False):
        assert _run_bootstrap(js, None, prefers_dark, expected) is dark_mode
    # an explicit viewer choice still wins
    assert _run_bootstrap(js, "light", True, expected) is False
    assert _run_bootstrap(js, "dark", False, expected) is True


def test_app_shell_default_theme_from_yaml_mode(monkeypatch):
    monkeypatch.setattr(srv, "_theme", None)
    monkeypatch.setattr(srv, "_get_site_section", lambda: {"theme": {"mode": "dark"}})
    assert srv._shell_default_theme() == "dark"
    monkeypatch.setattr(srv, "_get_site_section", lambda: {"theme": {"darkMode": False}})
    assert srv._shell_default_theme() == "light"
    monkeypatch.setattr(srv, "_get_site_section", lambda: {"theme": {"mode": "system", "darkMode": True}})
    assert srv._shell_default_theme() == "system"
    monkeypatch.setattr(srv, "_get_site_section", lambda: {})
    assert srv._shell_default_theme() == "system"


def test_dashboard_theme_bootstrap_unchanged_for_missing_preference():
    js = _bootstrap_js(srv._build_html("dashboard"))
    assert _run_bootstrap(js, None, True) is False


def test_ui_config_chat_enabled_for_app():
    srv.set_style("app")
    cfg = _client().get("/ui-config.json").json()
    assert cfg["style"] == "app" and cfg["chat"]["enabled"] is True


# ── shell manifest ───────────────────────────────────────────────────


def test_shell_manifest_lists_builtin_pages_by_kind():
    srv.set_style("app")
    m = _client().get("/api/shell/manifest").json()
    assert m["sdk"] == 1 and m["style"] == "app"
    assert set(m) >= {"sdk", "version", "style", "site", "layout", "pages", "blocks",
                      "toolRenderers", "plugins", "legacy"}
    builtin = {p["id"]: p for p in m["pages"] if p["source"] == "builtin"}
    assert len(builtin) >= 38
    for pid in ("chat-canvas", "overview", "sessions", "usage", "logs", "approvals", "config", "jobs"):
        assert builtin[pid]["kind"] == "legacy"
    # The React chat (builtin.chat in the browser) is reported as native, and
    # keeps source "builtin" so the browser lets builtin.chat claim the id.
    assert builtin["chat"]["kind"] == "native"
    assert builtin["chat"]["source"] == "builtin"
    assert m["legacy"] == {"customJs": None, "viewsBase": "/plugins/views/"}
    assert m["layout"] == {"sidebar": True, "pageHeader": True}
    assert [p["id"] for p in m["pages"]] == [
        p["id"] for p in sorted(m["pages"], key=lambda p: (p.get("order", 100), p["id"]))
    ]


def test_shell_manifest_layout_from_set_dashboard():
    srv.set_style("app")
    srv.set_dashboard(sidebar=False, page_header=False)
    m = _client().get("/api/shell/manifest").json()
    assert m["layout"] == {"sidebar": False, "pageHeader": False}


def test_shell_manifest_layout_from_yaml_dashboard_section(_isolated):
    (_isolated / "config.yaml").write_text("dashboard:\n  sidebar: false\n  page_header: false\n")
    srv.set_style("app")
    m = _client().get("/api/shell/manifest").json()
    assert m["layout"] == {"sidebar": False, "pageHeader": False}


def test_shell_manifest_site_title_matches_host_html(_isolated):
    srv.set_style("app")
    srv.set_branding(title="Brand", logo="B")
    assert _client().get("/api/shell/manifest").json()["site"]["title"] == "Brand"
    (_isolated / "config.yaml").write_text("site:\n  title: From YAML\n")
    client = _client()
    assert client.get("/api/shell/manifest").json()["site"]["title"] == "From YAML"
    assert "<title>From YAML Dashboard</title>" in client.get("/").text


def test_shell_manifest_respects_set_pages():
    srv.set_style("app")
    srv.set_pages(["chat", "sessions"])
    ids = {p["id"] for p in _client().get("/api/shell/manifest").json()["pages"]
           if p["source"] == "builtin"}
    assert ids == {"chat", "sessions"}


def test_shell_manifest_app_pages():
    srv.set_style("app")
    srv.register_page("metrics", title="Metrics", handler=lambda: {"_components": []})
    srv.register_page("viewonly", title="View Only")

    @srv.register_page_action("metrics")
    async def _act(data):
        return {"ok": True}

    pages = {p["id"]: p for p in _client().get("/api/shell/manifest").json()["pages"]}
    assert pages["metrics"]["kind"] == "blocks" and pages["metrics"]["source"] == "app"
    assert pages["metrics"]["actionEndpoint"] == "/api/pages/metrics/action"
    assert pages["viewonly"]["kind"] == "legacy" and pages["viewonly"]["source"] == "app"


# ── externals shims ──────────────────────────────────────────────────

# Named exports a plugin may import that a hand-written list missed
# (adversarial review): each must be re-exported by the shims.
_MUST_EXPORT = {
    "react": ["Activity", "useEffectEvent", "cache", "cacheSignal", "captureOwnerStack",
              "act", "version", "useState", "useSyncExternalStore", "useOptimistic"],
    "react-dom": ["createPortal", "flushSync", "preload", "preinit", "useFormStatus",
                  "useFormState", "requestFormReset", "unstable_batchedUpdates", "version"],
    "react-dom/client": ["createRoot", "hydrateRoot"],
    "react/jsx-runtime": ["Fragment", "jsx", "jsxs"],
}


def _shim_exports(js: str) -> set[str]:
    m = re.search(r"export const \{ (.*) \} = m;", js)
    assert m, js
    return {n.strip() for n in m.group(1).split(",")}


def _sdk_exports_from_source() -> list[str]:
    src = (FRONTEND / "src" / "sdk" / "manifest.ts").read_text(encoding="utf-8")
    block = src.split("export const SDK_EXPORTS = [", 1)[1].split("]", 1)[0]
    return re.findall(r"'([^']+)'", block)


def test_externals_shim_reads_window_sdk_modules():
    client = _client(style="app")
    r = client.get("/_aiui/externals/react.js?v=1")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/javascript")
    assert 'window.__AIUI_SDK__' in r.text and 's.modules["react"]' in r.text
    assert "export default m;" in r.text
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert client.get("/_aiui/externals/react.js").headers["cache-control"] == "no-cache"
    assert client.get("/_aiui/externals/lodash.js").status_code == 404


def test_externals_cover_every_react_export_fallback():
    client = _client(style="app")
    for spec, slug in srv._SHELL_EXTERNALS.items():
        names = _shim_exports(client.get(f"/_aiui/externals/{slug}.js").text)
        for required in _MUST_EXPORT.get(spec, []):
            assert required in names, (spec, required)
    sdk = _shim_exports(client.get("/_aiui/externals/sdk.js").text)
    assert sdk == set(_sdk_exports_from_source())


def test_fallback_sdk_exports_match_frontend_contract():
    assert srv._FALLBACK_EXTERNALS["@aiui/sdk"] == _sdk_exports_from_source()


def _node_react_exports() -> dict[str, list[str]] | None:
    """Object.keys() of the installed React packages (prod + dev builds)."""
    node = shutil.which("node")
    if not node or not (FRONTEND / "node_modules" / "react" / "package.json").is_file():
        return None
    script = r"""
const { createRequire } = require('node:module');
const req = createRequire(process.argv[1] + '/package.json');
const IDENT = /^[A-Za-z_$][\w$]*$/;
const load = (spec, env) => {
  process.env.NODE_ENV = env;
  const r = req.resolve(spec); delete req.cache[r];
  return Object.keys(req(spec));
};
const out = { version: req('react/package.json').version };
for (const s of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']) {
  const n = new Set([...load(s, 'production'), ...load(s, 'development')]);
  n.delete('default'); n.delete('__esModule');
  out[s] = [...n].filter((x) => IDENT.test(x)).sort();
}
console.log(JSON.stringify(out));
"""
    res = subprocess.run([node, "-e", script, str(FRONTEND)], capture_output=True, text=True,
                         timeout=60)
    if res.returncode != 0:
        pytest.fail(f"node failed: {res.stderr}")
    return json.loads(res.stdout)


def test_externals_include_every_installed_react_export():
    """Fails when the installed React exports a name the shims would miss."""
    actual = _node_react_exports()
    if actual is None:
        pytest.skip("src/frontend/node_modules not installed")
    client = _client(style="app")
    for spec, slug in srv._SHELL_EXTERNALS.items():
        if spec == "@aiui/sdk":
            continue
        names = _shim_exports(client.get(f"/_aiui/externals/{slug}.js").text)
        missing = sorted(set(actual[spec]) - names)
        assert not missing, f"{spec} shim misses {missing} (React {actual['version']})"


def test_fallback_externals_cover_installed_react():
    """The hand-kept fallback (used when a build lacks aiui-externals.json)
    must not miss any export of the React the frontend pins (19.2.4)."""
    actual = _node_react_exports()
    if actual is None:
        pytest.skip("src/frontend/node_modules not installed")
    for spec in ("react", "react/jsx-runtime", "react-dom", "react-dom/client"):
        missing = sorted(set(actual[spec]) - set(srv._FALLBACK_EXTERNALS[spec]))
        assert not missing, f"fallback {spec} misses {missing} (React {actual['version']})"


def test_externals_generated_file_wins(tmp_path, monkeypatch):
    tdir = tmp_path / "frontend"
    (tdir / "assets").mkdir(parents=True)
    modules = {k: list(v) for k, v in srv._FALLBACK_EXTERNALS.items()}
    modules["react"] = modules["react"] + ["useBrandNewHook"]
    (tdir / "aiui-externals.json").write_text(
        json.dumps({"schema": 1, "sdkVersion": 1, "react": "19.9.9", "modules": modules})
    )
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(tdir))
    client = _client(style="app")
    assert "useBrandNewHook" in _shim_exports(client.get("/_aiui/externals/react.js").text)


def test_externals_shims_are_valid_esm():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    client = _client(style="app")
    for slug in srv._SHELL_EXTERNALS.values():
        js = client.get(f"/_aiui/externals/{slug}.js").text
        res = subprocess.run([node, "--input-type=module", "--check"], input=js,
                             capture_output=True, text=True, timeout=60)
        assert res.returncode == 0, (slug, res.stderr)


def test_externals_shims_reexport_window_sdk_modules_at_runtime():
    """Evaluate each shim as ESM against a fake window.__AIUI_SDK__: the
    default export is the shell's module object and every named export is
    the same binding (one React instance for shell and plugins)."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    client = _client(style="app")
    shims = {spec: client.get(f"/_aiui/externals/{slug}.js").text
             for spec, slug in srv._SHELL_EXTERNALS.items()}
    names = {spec: sorted(_shim_exports(js)) for spec, js in shims.items()}
    script = """
const shims = JSON.parse(process.argv[1]), names = JSON.parse(process.argv[2]);
const modules = {};
for (const [spec, list] of Object.entries(names))
  modules[spec] = Object.fromEntries(list.map((n) => [n, spec + ':' + n]));
globalThis.window = { __AIUI_SDK__: { modules } };
const bad = [];
for (const [spec, js] of Object.entries(shims)) {
  const m = await import('data:text/javascript,' + encodeURIComponent(js));
  if (m.default !== modules[spec]) bad.push(spec + ' default');
  for (const n of names[spec]) if (m[n] !== spec + ':' + n) bad.push(spec + ' ' + n);
}
delete globalThis.window.__AIUI_SDK__;
try {
  await import('data:text/javascript,' + encodeURIComponent(shims['react']) + '%2F%2Fx');
  bad.push('no throw before boot');
} catch (e) { if (!/not booted/.test(e.message)) bad.push('wrong error ' + e.message); }
console.log(JSON.stringify(bad));
"""
    res = subprocess.run(
        [node, "--input-type=module", "-e", script, json.dumps(shims), json.dumps(names)],
        capture_output=True, text=True, timeout=60,
    )
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == []


# ── AIUI_SHELL resolution ────────────────────────────────────────────


@pytest.mark.parametrize(
    "env,style,expected",
    [
        ("", "dashboard", "dashboard"),
        ("", "app", "app"),
        ("app", "dashboard", "app"),
        ("react", "dashboard", "app"),
        ("APP", "dashboard", "app"),
        ("app", "chat", "chat"),
        ("app", "docs", "docs"),
        ("app", "agents", "agents"),
        ("legacy", "app", "dashboard"),
        ("legacy", "dashboard", "dashboard"),
        ("legacy", "docs", "docs"),
        ("bogus", "dashboard", "dashboard"),
    ],
)
def test_aiui_shell_matrix(monkeypatch, env, style, expected):
    monkeypatch.setenv("AIUI_SHELL", env)
    assert resolve_shell_style(style) == expected


def test_aiui_shell_flips_default_server_style(monkeypatch):
    monkeypatch.setenv("AIUI_SHELL", "app")
    client = _client()
    assert client.get("/ui-config.json").json()["style"] == "app"
    assert 'data-aiui-shell="react"' in client.get("/").text


def test_aiui_shell_legacy_kill_switch(monkeypatch):
    monkeypatch.setenv("AIUI_SHELL", "legacy")
    srv.set_style("app")
    client = _client()
    assert client.get("/ui-config.json").json()["style"] == "dashboard"
    assert "data-aiui-shell" not in client.get("/").text


# ── extensions policy (after init_config_store) ──────────────────────


class _Inline:
    def __init__(self, name):
        self.name = name


def test_extensions_from_data_dir_config_yaml(_isolated):
    (_isolated / "config.yaml").write_text("extensions:\n  disabled: [blocked]\n")
    get_plugin_registry().register(_Inline("blocked"))
    get_plugin_registry().register(_Inline("allowed"))
    client = _client(style="app")
    status = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert status == {"blocked": "disabled", "allowed": "ok"}


def test_extensions_bare_list_in_data_dir_config(_isolated):
    (_isolated / "config.yaml").write_text("extensions: [allowed]\n")
    get_plugin_registry().register(_Inline("blocked"))
    get_plugin_registry().register(_Inline("allowed"))
    client = _client(style="app")
    status = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert status == {"blocked": "disabled", "allowed": "ok"}


def test_extensions_policy_does_not_leak_between_apps(_isolated):
    get_plugin_registry().register(_Inline("p1"))
    _client(style="app", extensions={"disabled": ["p1"]})
    client = _client(style="app")  # no extensions section any more
    status = {p["name"]: p["status"] for p in client.get("/api/plugins").json()["plugins"]}
    assert status == {"p1": "ok"}


def test_config_model_accepts_app_style_and_extensions():
    from praisonaiui.schema.models import Config

    cfg = Config.model_validate(
        {"site": {"title": "x"}, "style": "app", "extensions": ["a", "b"]}
    )
    assert cfg.style == "app"
    assert cfg.extensions.enabled == ["a", "b"] and cfg.extensions.disabled == []
    cfg2 = Config.model_validate(
        {"site": {"title": "x"}, "extensions": {"disabled": ["c"]}}
    )
    assert cfg2.extensions.enabled is None and cfg2.extensions.disabled == ["c"]


# ── /assets cache headers ────────────────────────────────────────────


def _fake_build(root: Path, *, manifest: bool) -> Path:
    assets = root / "assets"
    assets.mkdir(parents=True)
    for name in ("index.js", "index.css", "ChatPage-AbC_12-z.js", "katex-Zz9yXw01.woff2",
                 "legacy.js", "mermaid-renderer.js"):
        (assets / name).write_text(f"/* {name} */")
    if manifest:
        (root / "aiui-manifest.json").write_text(json.dumps({
            "index.html": {"file": "assets/index.js", "isEntry": True, "css": ["assets/index.css"],
                           "dynamicImports": ["src/chat-engine/ChatPage.tsx"]},
            "src/chat-engine/ChatPage.tsx": {"file": "assets/ChatPage-AbC_12-z.js",
                                             "isDynamicEntry": True},
        }))
    return root


def test_assets_cache_headers_hashed_build(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(_fake_build(tmp_path / "fe", manifest=True)))
    client = _client(style="app")
    immutable = "public, max-age=31536000, immutable"
    assert client.get("/assets/index.js?v=1").headers["cache-control"] == "no-cache"
    assert client.get("/assets/index.css?v=1").headers["cache-control"] == "no-cache"
    r = client.get("/assets/ChatPage-AbC_12-z.js")
    assert r.status_code == 200 and r.headers["cache-control"] == immutable
    # hashed asset not listed in the manifest (e.g. a font pulled in by CSS)
    assert client.get("/assets/katex-Zz9yXw01.woff2").headers["cache-control"] == immutable
    assert client.get("/assets/legacy.js").headers["cache-control"] == "no-cache"
    # a fixed name whose suffix is a word, not a hash, is never pinned
    assert client.get("/assets/mermaid-renderer.js").headers["cache-control"] == "no-cache"
    # revalidation keeps the policy
    etag = r.headers["etag"]
    r304 = client.get("/assets/ChatPage-AbC_12-z.js", headers={"if-none-match": etag})
    assert r304.status_code == 304 and r304.headers["cache-control"] == immutable


def test_assets_cache_headers_unhashed_build(tmp_path, monkeypatch):
    """Without a Vite manifest nothing is assumed immutable."""
    monkeypatch.setenv("AIUI_TEMPLATES_DIR", str(_fake_build(tmp_path / "fe", manifest=False)))
    client = _client()
    assert client.get("/assets/ChatPage-AbC_12-z.js").headers["cache-control"] == "no-cache"
    assert client.get("/assets/index.js").headers["cache-control"] == "no-cache"


# ── WebSocket auth under AUTH_ENFORCE ────────────────────────────────


@pytest.fixture
def api_key(monkeypatch):
    from praisonaiui.features import auth as feature_auth

    key = "pk_test_websocket_key"
    monkeypatch.setitem(feature_auth._auth_config["api_keys"], key, {"name": "t"})
    return key


def _ws_rejected(client: TestClient, url: str, **kw) -> bool:
    try:
        with client.websocket_connect(url, **kw) as ws:
            ws.send_json({"type": "ping"})
            ws.receive_json()
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
        return True
    return False


def test_websocket_requires_token_when_auth_enforced(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = _client()
    assert _ws_rejected(client, "/api/chat/ws")
    assert _ws_rejected(client, "/api/chat/ws", headers={"Authorization": "Bearer wrong"})
    assert _ws_rejected(client, "/api/chat/ws?token=wrong")
    assert _ws_rejected(client, "/api/logs/stream")
    # every socket, not only /api/* (feature sockets, the gateway, unknown paths)
    assert _ws_rejected(client, "/ws/audio")
    assert _ws_rejected(client, "/ws")
    assert _ws_rejected(client, "/anything")
    assert not _ws_rejected(client, "/api/chat/ws", headers={"Authorization": f"Bearer {api_key}"})
    assert not _ws_rejected(client, f"/api/chat/ws?token={api_key}")
    # http rules unchanged
    assert client.get("/api/overview").status_code == 401
    assert client.get("/api/overview", headers={"Authorization": f"Bearer {api_key}"}).status_code == 200


def test_websocket_open_without_auth_enforce():
    client = _client()
    assert not _ws_rejected(client, "/api/chat/ws")


def test_shell_routes_gated_by_auth_enforce(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "1")
    srv.set_style("app")
    client = _client()
    assert client.get("/api/shell/manifest").status_code == 401
    assert client.get("/api/plugins").status_code == 401
    ok = client.get("/api/shell/manifest", headers={"Authorization": f"Bearer {api_key}"})
    assert ok.status_code == 200 and ok.json()["pages"]
    # the page itself stays reachable and only carries the minimal boot
    assert set(_boot(client.get("/").text)) == {"sdk", "version", "style"}


def test_env_isolation_from_conftest():
    assert os.environ.get("AIUI_DISABLE_PLUGIN_AUTOLOAD") == "1"
    assert "AIUI_SHELL" not in os.environ
