"""Which view module renders a page in the vanilla dashboard (modularity gap G11).

dashboard.js used to carry its own page → module map (``BUILTIN_VIEWS``), so
a disabled built-in, an app page under a built-in id or a new built-in page
all depended on that list. Now the view comes from the data the server sends:
GET /api/shell/manifest gives each page's ``source`` and ``kind`` and
``legacy.viewsBase``; a built-in page's view is ``<viewsBase><id>.js``
(or the record's own ``module``); pages from an app, a plugin or a
dashboard-plugin folder never get a built-in view. Only when the manifest
cannot be read are /api/pages ids tried by file name.

Three layers: the server data contract (TestClient), the file contract
(every built-in page has its view file) and dashboard.js's behaviour in Node
(view imports intercepted with ``node:module`` hooks).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.builtin import BUILTIN_PLUGINS

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = PLUGINS / "views"
DASHBOARD_JS = PLUGINS / "dashboard.js"
NODE = shutil.which("node")

#: Built-in pages without a view module: the Inspector is a panel that
#: dashboard.js opens itself (showTestPanel / renderTestPanel).
PANEL_PAGES = {"inspector"}


def _node_has_register_hooks() -> bool:
    if NODE is None:
        return False
    proc = subprocess.run(
        [NODE, "-e", "process.exit(typeof require('node:module').registerHooks === 'function' ? 0 : 1)"],
        capture_output=True,
        timeout=30,
    )
    return proc.returncode == 0


@pytest.fixture
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield data
    srv.reset_state()


def _manifest(**cfg) -> dict:
    client = TestClient(srv.create_app(config=cfg or None))
    return client.get("/api/shell/manifest").json()


# ── File and server contract ──────────────────────────────────────────


def test_every_builtin_page_has_its_view_file():
    for plugin in BUILTIN_PLUGINS:
        for spec in plugin.pages():
            if spec.id in PANEL_PAGES:
                continue
            assert (VIEWS / f"{spec.id}.js").is_file(), f"{plugin.name}: views/{spec.id}.js is missing"


def test_dashboard_js_names_no_view_file():
    src = DASHBOARD_JS.read_text(encoding="utf-8")
    assert "BUILTIN_VIEWS" not in src
    assert not re.findall(r"/plugins/views/[\w-]+\.js", src)


@pytest.mark.usefixtures("_isolated")
def test_manifest_carries_what_the_dashboard_resolves_from():
    aiui.set_style("dashboard")
    manifest = _manifest()
    assert manifest["legacy"]["viewsBase"] == "/plugins/views/"
    pages = {p["id"]: p for p in manifest["pages"]}
    for plugin in BUILTIN_PLUGINS:
        for spec in plugin.pages():
            assert pages[spec.id]["source"] == "builtin"
            assert pages[spec.id]["kind"] in ("legacy", "native")


@pytest.mark.usefixtures("_isolated")
def test_disabled_builtin_and_app_page_leave_no_builtin_record():
    aiui.set_style("dashboard")
    aiui.register_page("overview", title="My overview", handler=lambda: {"_components": []})
    manifest = _manifest(extensions={"disabled": ["builtin.logs"]})
    pages = {p["id"]: p for p in manifest["pages"]}
    assert "logs" not in pages
    assert pages["overview"]["source"] == "app"
    assert pages["overview"]["kind"] == "blocks"


# ── dashboard.js in Node ──────────────────────────────────────────────

_HARNESS = r"""
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
const [, , dashPath, scenario] = process.argv;

const PREFIX = 'file:///aiui-views';
const imports = [];
registerHooks({
  resolve(specifier, context, next) {
    if (/^\/(plugins|static)\//.test(specifier)) return { url: PREFIX + specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith(PREFIX)) return next(url, context);
    const path = url.slice(PREFIX.length).split('?')[0];
    imports.push(path);
    return { format: 'module', shortCircuit: true,
      source: `export function render(el) { el.textContent = 'view:${path}'; }` };
  },
});

class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.id = ''; this.className = ''; this.textContent = ''; this._html = '';
    this.style = { cssText: '', setProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === html) return true; return false; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c) { return this.appendChild(c); }
  remove() { if (this.parentNode) { const s = this.parentNode.children; s.splice(s.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; }
}
const html = new El('html'); const head = new El('head'); const body = new El('body');
html.appendChild(head); html.appendChild(body);
const main = new El('div'); main.id = 'db-main-content'; body.appendChild(main);
globalThis.window = globalThis;
globalThis.document = {
  documentElement: html, head, body,
  createElement: (t) => new El(t),
  getElementById: (id) => (id === 'db-main-content' ? main : null),
  // selectPage looks its fresh page container up after writing main.innerHTML.
  querySelector: (sel) => {
    const m = /^\[data-page="([^"]+)"\]$/.exec(sel);
    if (!m) return null;
    const c = new El('div'); c.setAttribute('data-page', m[1]); main.appendChild(c); return c;
  },
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
const target = new EventTarget();
window.addEventListener = (t, f, o) => target.addEventListener(t, f, o);
window.removeEventListener = (t, f, o) => target.removeEventListener(t, f, o);
window.dispatchEvent = (e) => target.dispatchEvent(e);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mem(); globalThis.sessionStorage = mem();
globalThis.location = { search: '', pathname: '/', hash: '', href: 'http://aiui.test/', origin: 'http://aiui.test' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.EventSource = class { close() {} };

const PAGES = ['overview', 'runs', 'replay', 'logs', 'debug', 'metrics', 'kanban', 'inspector'].map((id) => ({ id, title: id }));
const MANIFEST = {
  legacy: { customJs: null, viewsBase: scenario === 'base' ? '/static/views/' : '/plugins/views/' },
  pages: [
    { id: 'overview', kind: 'legacy', source: 'builtin' },
    { id: 'runs', kind: 'legacy', source: 'builtin' },
    { id: 'replay', kind: 'legacy', source: 'builtin' },
    { id: 'chat', kind: 'native', source: 'builtin' },
    // a built-in record without a view file (dashboard.js draws the panel)
    { id: 'inspector', kind: 'legacy', source: 'builtin' },
    // an app page under a built-in id (register_page with a handler)
    { id: 'logs', kind: 'blocks', source: 'app', apiEndpoint: '/api/pages/logs/data' },
    // a dashboard-plugin folder page (its script calls registerView)
    { id: 'board', kind: 'legacy', source: 'dashboard-plugin:board', module: '/dashboard-plugins/board/index.js' },
    // a built-in record naming its own view module
    { id: 'traces', kind: 'legacy', source: 'builtin', module: '/plugins/views/traces-v2.js' },
    // an entry-point plugin page
    { id: 'metrics', kind: 'blocks', source: 'aiui-metrics' },
    // 'debug' is a disabled built-in: not listed
  ],
};
globalThis.fetch = async (url) => {
  const path = new URL(String(url && url.url ? url.url : url), 'http://aiui.test/').pathname;
  let data = null;
  if (path === '/api/pages') data = { pages: PAGES };
  else if (path === '/api/dashboard/plugins') data = { plugins: [] };
  else if (path === '/api/shell/manifest' && scenario !== 'nomanifest') data = MANIFEST;
  else if (path.startsWith('/api/')) data = { _generic: path };
  return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data ?? {} };
};

const mod = await import(pathToFileURL(dashPath).href);
await mod.initHostRuntime({ palette: false, approvalUi: 'event-only' });
const out = { mount: {}, select: {} };
const mount = async (id, page) => {
  const el = new El('div'); body.appendChild(el);
  const before = imports.length;
  const cleanup = await mod.mountView(id, el, page ? { page } : {});
  cleanup();
  return imports.slice(before);
};
for (const id of ['overview', 'runs', 'chat', 'logs', 'debug', 'board', 'traces', 'metrics', 'kanban', 'constructor', '../x']) {
  out.mount[id] = await mount(id);
}
// The app shell passes its own record of the page.
out.mount['kanban+host'] = await mount('kanban', { id: 'kanban', kind: 'legacy', source: 'builtin' });
out.mount['overview+hostapp'] = await mount('overview', { id: 'overview', kind: 'blocks', source: 'app' });
// The dashboard style's selectPage (no host navigator installed). Pages not
// mounted above, since a loaded view is cached in the view registry.
for (const id of ['replay', 'logs', 'debug', 'kanban', 'inspector']) {
  const before = imports.length;
  await window.aiui.selectPage(id);
  out.select[id] = imports.slice(before).map((p) => p);
}
console.log(JSON.stringify(out));
"""


def _run(tmp_path: Path, scenario: str) -> dict:
    harness = tmp_path / "harness.mjs"
    harness.write_text(_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [NODE, str(harness), str(DASHBOARD_JS), scenario],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp_path,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


needs_hooks = pytest.mark.skipif(
    not _node_has_register_hooks(), reason="node:module registerHooks() needs Node >= 22.15"
)


@pytest.fixture(scope="module")
def manifest_run(tmp_path_factory) -> dict:
    if not _node_has_register_hooks():
        pytest.skip("node:module registerHooks() needs Node >= 22.15")
    return _run(tmp_path_factory.mktemp("manifest"), "manifest")


@needs_hooks
class TestFromTheManifest:
    def test_builtin_pages_load_their_view_by_id(self, manifest_run):
        assert manifest_run["mount"]["overview"] == ["/plugins/views/overview.js"]
        assert manifest_run["mount"]["runs"] == ["/plugins/views/runs.js"]
        assert manifest_run["mount"]["chat"] == ["/plugins/views/chat.js"]

    def test_app_page_under_a_builtin_id_gets_no_builtin_view(self, manifest_run):
        assert manifest_run["mount"]["logs"] == []
        assert manifest_run["mount"]["overview+hostapp"] == []

    def test_disabled_or_unknown_pages_load_nothing(self, manifest_run):
        for page_id in ("debug", "kanban", "constructor", "../x"):
            assert manifest_run["mount"][page_id] == [], page_id

    def test_plugin_and_folder_pages_load_no_module(self, manifest_run):
        assert manifest_run["mount"]["metrics"] == []
        assert manifest_run["mount"]["board"] == []

    def test_builtin_record_module_wins(self, manifest_run):
        assert manifest_run["mount"]["traces"] == ["/plugins/views/traces-v2.js"]

    def test_host_record_is_used(self, manifest_run):
        assert manifest_run["mount"]["kanban+host"] == ["/plugins/views/kanban.js"]

    def test_select_page_resolves_the_same_way(self, manifest_run):
        assert manifest_run["select"] == {
            "replay": ["/plugins/views/replay.js"],
            "logs": [],
            "debug": [],
            "kanban": [],
            # A panel page: no request for a views/inspector.js that does not exist.
            "inspector": [],
        }


@needs_hooks
def test_views_base_comes_from_the_manifest(tmp_path):
    out = _run(tmp_path, "base")
    assert out["mount"]["overview"] == ["/static/views/overview.js"]


@needs_hooks
def test_without_a_manifest_listed_pages_resolve_by_file_name(tmp_path):
    out = _run(tmp_path, "nomanifest")
    # /api/pages lists overview, runs, logs, debug, metrics, kanban.
    assert out["mount"]["overview"] == ["/plugins/views/overview.js"]
    assert out["mount"]["debug"] == ["/plugins/views/debug.js"]
    assert out["mount"]["kanban"] == ["/plugins/views/kanban.js"]
    # Not listed, or not a file name: nothing is imported.
    for page_id in ("chat", "board", "traces", "constructor", "../x"):
        assert out["mount"][page_id] == [], page_id
    # Listed, but a panel page without a view file.
    assert out["select"]["inspector"] == []
