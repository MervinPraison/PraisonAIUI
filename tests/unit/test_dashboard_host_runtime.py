"""dashboard.js host mode (ADR-0001 strangler; React shell, style ``app``).

The React shell imports ``plugins/dashboard.js`` as a runtime only:
``initHostRuntime()`` boots it without ``init()``/``buildDashboard()`` and
``mountView()`` mounts one legacy page at a time. Everything here must leave the
default ``dashboard`` style unchanged.

Three layers of checks:

* static source checks (always run);
* behaviour checks that import dashboard.js in Node with a small fake DOM
  (skipped when ``node`` is not installed);
* a cascade check in headless Chromium proving user CSS beats the token bridge
  (skipped when Playwright or its Chromium is not installed).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
DASHBOARD_JS = PLUGINS / "dashboard.js"
BRIDGE_CSS = ROOT / "src" / "frontend" / "src" / "legacy" / "bridge.css"
RUNTIME_TS = ROOT / "src" / "frontend" / "src" / "legacy" / "runtime.ts"

NODE = shutil.which("node")


def _node_has_register_hooks() -> bool:
    if NODE is None:
        return False
    proc = subprocess.run(
        [
            NODE,
            "-e",
            "process.exit(typeof require('node:module').registerHooks === 'function' ? 0 : 1)",
        ],
        capture_output=True,
        timeout=30,
    )
    return proc.returncode == 0


_HAS_REGISTER_HOOKS = _node_has_register_hooks()


def _src() -> str:
    return DASHBOARD_JS.read_text(encoding="utf-8")


def _top_level_functions(src: str) -> dict[str, str]:
    """Map each top-level ``function name(`` / ``async function name(`` to its body.

    dashboard.js is formatted with top-level declarations at column 0 and their
    closing brace on its own line at column 0, which is all this relies on.
    """
    out: dict[str, str] = {}
    pattern = r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{"
    for m in re.finditer(pattern, src, re.MULTILINE):
        end = re.search(r"^}", src[m.end() :], re.MULTILINE)
        assert end, f"unterminated function {m.group(1)}"
        out[m.group(1)] = src[m.end() : m.end() + end.start()]
    return out


def _function_body(name: str) -> str:
    body = _top_level_functions(_src()).get(name)
    assert body is not None, f"function {name} not found in dashboard.js"
    return body


def _code_only(body: str) -> str:
    """Drop comments and plain string literals, so prose such as
    "buildDashboard() never runs" or 'Failed to init …' is not a reference."""
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.DOTALL)
    body = re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", body)
    return re.sub(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"", "''", body)


def _local_names(body: str) -> set[str]:
    """Parameters and variables declared inside a function body."""
    names = set(re.findall(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)", body))
    for params in re.findall(r"function\s*[\w$]*\s*\(([^)]*)\)", body) + re.findall(
        r"\(([^()]*)\)\s*=>", body
    ):
        names.update(re.findall(r"(?<![\w$.=])([A-Za-z_$][\w$]*)", params))
    names.update(re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>", body))
    return names


def _reachable(start: str, stop: frozenset[str] = frozenset()) -> set[str]:
    """Top-level functions reachable from ``start`` by static name reference."""
    funcs = {name: _code_only(body) for name, body in _top_level_functions(_src()).items()}
    seen: set[str] = set()
    todo = [start]
    while todo:
        name = todo.pop()
        if name in seen or name not in funcs:
            continue
        seen.add(name)
        if name in stop:
            continue
        # A bare name (not a property such as `x.init`) that is a top-level function.
        local = _local_names(funcs[name])
        for ref in re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\b", funcs[name]):
            if ref in funcs and ref not in seen and ref not in local:
                todo.append(ref)
    return seen


# ── Static checks ─────────────────────────────────────────────────────


class TestExports:
    def test_export_list(self):
        m = re.search(r"^export\s*\{([^}]*)\};?\s*$", _src(), re.MULTILINE)
        assert m, "dashboard.js has no export list"
        names = {n.strip() for n in m.group(1).split(",") if n.strip()}
        assert {"init", "onContentChange", "initHostRuntime", "mountView"} <= names

    def test_window_api(self):
        src = _src()
        assert "window.aiui.mountView = mountView;" in src
        assert "window.aiui.initHostRuntime = initHostRuntime;" in src

    @pytest.mark.skipif(NODE is None, reason="node is not installed")
    def test_parses_as_an_es_module(self):
        # Plain `node --check` parses a .js file as CommonJS and misses ESM-only
        # errors; feed it on stdin as a module instead.
        proc = subprocess.run(
            [NODE, "--input-type=module", "--check"],
            input=DASHBOARD_JS.read_bytes(),
            capture_output=True,
            timeout=60,
        )
        assert proc.returncode == 0, proc.stderr.decode()


class TestLegacyPathUnchanged:
    def test_select_page_first_statement_is_the_host_guard(self):
        body = _function_body("selectPage")
        first = next(line.strip() for line in body.splitlines() if line.strip())
        assert first.startswith("if (_hostNavigate) return _hostNavigate(pageId);"), first

    def test_host_state_defaults_are_inert(self):
        src = _src()
        assert re.search(r"^let _hostMode = false;", src, re.MULTILINE)
        assert re.search(r"^let _hostNavigate = null;", src, re.MULTILINE)
        # Only initHostRuntime turns host mode on or installs a navigator.
        funcs = _top_level_functions(src)
        setters = {n for n, b in funcs.items() if re.search(r"\b_hostMode\s*=(?!=)", b)}
        nav_setters = {n for n, b in funcs.items() if re.search(r"\b_hostNavigate\s*=(?!=)", b)}
        assert setters == {"initHostRuntime"}
        assert nav_setters == {"initHostRuntime"}

    def test_build_dashboard_unreachable_from_host_entry_points(self):
        # selectPage is a leaf here: its first statement delegates to the host.
        for entry in ("initHostRuntime", "mountView"):
            reach = _reachable(entry, stop=frozenset({"selectPage"}))
            assert entry in reach
            assert "buildDashboard" not in reach, entry
            assert "init" not in reach, entry
            assert "applyThemeFromConfig" not in reach, entry
        assert "buildDashboard(" not in _function_body("initHostRuntime")

    def test_bundle_uses_the_unchanged_selectpage_cache_bust(self):
        # Legacy selectPage keeps ?v=Date.now(); host mounts use the build id.
        assert "BUILTIN_VIEWS[pageId] + '?v=' + Date.now()" in _function_body("selectPage")
        body = _code_only(_function_body("_mountViewBody"))
        assert "Date.now()" not in body
        assert "_importHostView(pageId)" in body
        url = _code_only(_function_body("_hostViewUrl"))
        assert "Date.now()" not in url
        assert "window.__AIUI_BUILD__" in url
        # A failed import is retried under a new URL (browsers cache the failure).
        assert "'&r=' + failures" in _function_body("_hostViewUrl")
        assert "_hostViewImportFailures[pageId]" in _function_body("_importHostView")


class TestHostModeTheming:
    def test_apply_theme_from_config_is_a_no_op_in_host_mode(self):
        # ThemeManager-style inline `!important` vars on <html> would beat both
        # the token bridge and user CSS.
        body = _function_body("applyThemeFromConfig")
        first = next(
            line.strip()
            for line in body.splitlines()
            if line.strip() and not line.strip().startswith("//")
        )
        assert first == "if (_hostMode) return;"

    def test_host_style_drops_the_root_colour_block(self):
        body = _function_body("hostScopedStyle")
        assert ":where(html)" in body
        assert "_HOST_LAYOUT_VARS" in body


class TestPaletteGuard:
    def test_shell_hooks_captured_before_legacy_assignment(self):
        src = _src()
        capture = src.index("const _shellPaletteHooks = {")
        assign = src.index("window.aiui.openCommandPalette = openCommandPalette;")
        assert capture < assign

    def test_palette_false_skips_the_legacy_keybinding(self):
        body = _function_body("initHostRuntime")
        m = re.search(
            r"if \(opts\.palette === false\) _restoreShellPaletteHooks\(\);\s*else initCommandPalette\(\);",
            body,
        )
        assert m, "initHostRuntime must not install the legacy Ctrl+K palette when palette:false"


class TestApprovalUi:
    def test_event_only_stream_never_opens_the_modal(self):
        reach = _reachable("_initHostApprovalEvents")
        assert "showApprovalModal" not in reach
        assert "initApprovalStream" not in reach

    def test_modal_mode_kept_for_other_hosts(self):
        body = _function_body("initHostRuntime")
        assert "approvalUi === 'event-only'" in body
        assert "showApprovalModal" in body


class TestRuntimeLoader:
    def test_runtime_imports_dashboard_with_build_id_and_host_options(self):
        ts = RUNTIME_TS.read_text(encoding="utf-8")
        assert "v=${encodeURIComponent(String(build))}" in ts
        assert "`/plugins/dashboard.js?${params.join('&')}`" in ts
        # Retry suffix only after a failed import (never a 2nd module instance).
        assert "if (failedImports > 0) params.push(`r=${failedImports}`)" in ts
        assert "window.__AIUI_BUILD__" in ts
        assert re.search(r"palette:\s*false", ts)
        assert re.search(r"approvalUi:\s*'event-only'", ts)
        assert "@vite-ignore" in ts


# ── Token bridge (legacy/bridge.css) ──────────────────────────────────

BRIDGE_ALIASES = [
    "--db-bg",
    "--db-canvas",
    "--db-sidebar-bg",
    "--db-text",
    "--db-text-dim",
    "--db-text-muted",
    "--db-border",
    "--db-border-light",
    "--db-card-bg",
    "--db-hover",
    "--db-input-bg",
    "--db-surface",
    "--db-popover",
    "--db-muted",
    "--db-muted-fg",
    "--db-accent",
    "--db-accent-glow",
    "--db-sidebar-accent",
    "--db-sidebar-accent-fg",
    "--db-sidebar-border",
    "--db-success",
    "--db-success-bg",
    "--db-warning",
    "--db-warning-bg",
    "--db-error",
    "--db-error-bg",
    "--db-info",
    "--db-info-bg",
    "--db-radius",
    "--db-font",
    "--db-mono",
]


def _css_rules(css: str) -> list[tuple[str, str]]:
    """(selector, declarations) for each innermost rule; comments stripped."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    return [(sel.strip(), body) for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css)]


def _bridge_defined() -> set[str]:
    names: set[str] = set()
    for _sel, body in _css_rules(BRIDGE_CSS.read_text(encoding="utf-8")):
        names.update(re.findall(r"(--db-[\w-]+)\s*:", body))
    return names


class TestBridgeCss:
    def test_maps_every_alias(self):
        missing = [n for n in BRIDGE_ALIASES if n not in _bridge_defined()]
        assert not missing, missing

    def test_every_db_rule_has_zero_specificity(self):
        # A user's `:root { --db-accent: ... }` (set_custom_css) must win.
        for sel, body in _css_rules(BRIDGE_CSS.read_text(encoding="utf-8")):
            if re.search(r"--db-[\w-]+\s*:", body):
                assert sel == ":where(html[data-aiui-shell='react'])", sel

    def test_no_hex_colours(self):
        css = re.sub(r"/\*.*?\*/", "", BRIDGE_CSS.read_text(encoding="utf-8"), flags=re.DOTALL)
        assert not re.findall(r"#[0-9a-fA-F]{3,8}\b", css)

    def test_db_bg_follows_background(self):
        decls = "".join(body for _s, body in _css_rules(BRIDGE_CSS.read_text(encoding="utf-8")))
        assert re.search(r"--db-bg:\s*var\(--background\);", decls)

    def test_plugin_tier_roles_used_by_modules_are_mapped(self):
        # WP5 rewrites plugin hex to var(--db-p-<role>, <hex>). Every role a
        # module reads must be mapped, or the app shell shows the dark hex.
        used: set[str] = set()
        for path in PLUGINS.rglob("*.js"):
            used.update(re.findall(r"var\(\s*(--db-p-[\w-]+)", path.read_text(encoding="utf-8")))
        missing = sorted(used - _bridge_defined())
        assert not missing, (
            f"--db-p-* roles used in plugins but not mapped in bridge.css: {missing}"
        )

    def test_full_bleed_rules(self):
        css = BRIDGE_CSS.read_text(encoding="utf-8")
        assert ".aiui-legacy-host.db-fill" in css
        assert ".aiui-legacy-host.db-fill > .aiui-legacy-mount" in css


# ── Behaviour in Node (fake DOM) ──────────────────────────────────────

_NODE_HARNESS = r"""
import { pathToFileURL } from 'node:url';

const [, , dashPath, scenario] = process.argv;
const events = [];
const counts = { docKeydown: 0, winApprovalListeners: 0 };

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = { cssText: '', setProperty() {} };
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.id = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  get isConnected() {
    for (let n = this; n; n = n.parentNode) if (n === document.documentElement) return true;
    return false;
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.remove();
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  remove() {
    if (!this.parentNode) return;
    const sib = this.parentNode.children;
    sib.splice(sib.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const c of node.children) { const hit = findById(c, id); if (hit) return hit; }
  return null;
}

const html = new FakeElement('html');
const head = new FakeElement('head');
const body = new FakeElement('body');
const target = new EventTarget();
globalThis.window = globalThis;
globalThis.document = {
  documentElement: html, head, body, title: '',
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => findById(html, id),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type) { if (type === 'keydown') counts.docKeydown += 1; },
  removeEventListener() {},
};
html.appendChild(head);
html.appendChild(body);
window.addEventListener = (type, fn, o) => {
  if (type === 'aiui:approval-required') counts.winApprovalListeners += 1;
  target.addEventListener(type, fn, o);
};
window.removeEventListener = (type, fn, o) => target.removeEventListener(type, fn, o);
window.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail ?? null }); return target.dispatchEvent(e); };
const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = storage();
globalThis.sessionStorage = storage();
globalThis.location = { search: '', pathname: '/', hash: '', href: 'http://aiui.test/', origin: 'http://aiui.test' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.closed = false; FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
}
globalThis.EventSource = FakeEventSource;

const routes = {
  '/api/auth/status': { authenticated: true, mode: 'standalone' },
  '/api/pages': { pages: [{ id: 'v1', title: 'View one' }, { id: 'metrics', title: 'Metrics', api_endpoint: '/api/pages/metrics/data' }] },
  '/api/dashboard/plugins': { plugins: [] },
  '/api/approvals/pending': { approvals: [{ id: 'a1', tool_name: 'shell' }, { id: 'a2', tool_name: 'write' }] },
};
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  const auth = init && init.headers && typeof init.headers.get === 'function' ? init.headers.get('Authorization') : null;
  fetchCalls.push({ url: url instanceof URL ? url.href : String(url && url.url ? url.url : url), auth });
  const path = new URL(url instanceof URL ? url.href : String(url && url.url ? url.url : url), 'http://aiui.test/').pathname;
  const data = routes[path];
  return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data ?? {} };
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const out = {};

if (scenario === 'host') {
  const shellOpen = () => 'shell';
  window.aiui = { openCommandPalette: shellOpen };
  const mod = await import(pathToFileURL(dashPath).href);
  out.legacyOverwroteOnEval = window.aiui.openCommandPalette !== shellOpen;

  const navs = [];
  const ready = await mod.initHostRuntime({ navigate: (id) => { navs.push(['first', id]); return Promise.resolve(); }, palette: false, approvalUi: 'event-only' });
  out.pages = ready.pages.map((p) => p.id);
  out.paletteRestored = window.aiui.openCommandPalette === shellOpen;
  out.closeHook = typeof window.aiui.closeCommandPalette;
  out.globalHook = typeof window.openCommandPalette;
  out.docKeydown = counts.docKeydown;
  out.winApprovalListeners = counts.winApprovalListeners;

  await window.aiui.selectPage('logs');
  const again = mod.initHostRuntime({ navigate: (id) => { navs.push(['second', id]); } });
  out.samePromise = again === mod.initHostRuntime({});
  await window.aiui.selectPage('usage');
  out.navs = navs;

  const style = document.getElementById('aiui-legacy-style');
  out.styleFirstInHead = document.head.firstChild === style;
  out.style = style ? style.textContent : null;

  const es = FakeEventSource.instances[0];
  out.eventSources = FakeEventSource.instances.map((e) => e.url);
  es.onmessage({ data: JSON.stringify({ event: 'connected', pending: 2 }) });
  es.onmessage({ data: JSON.stringify({ event: 'new', data: {}, pending: 2 }) });
  await tick(); await tick();
  es.onmessage({ data: JSON.stringify({ event: 'new', data: {}, pending: 2 }) });
  await tick(); await tick();
  es.onmessage({ data: JSON.stringify({ event: 'resolved', data: {}, pending: 1 }) });
  await tick();
  out.approvalEvents = events.filter((e) => e.type.startsWith('aiui:approval')).map((e) => [e.type, e.detail && e.detail.id != null ? e.detail.id : null]);
  window.dispatchEvent(new CustomEvent('aiui:approval-required', { detail: { id: 'chat-1', tool_name: 'x' } }));
  await tick();
  out.bodyOverlays = document.body.children.filter((c) => /db-modal-overlay/.test(c.className)).length;

  // mountView: render()'s cleanup + the module cleanup, each once.
  const host = document.createElement('div');
  document.body.appendChild(host);
  const calls = [];
  window.aiui.registerView('v1', (el) => { el.textContent = 'v1'; return () => calls.push('returned'); }, () => calls.push('module'));
  const c1 = document.createElement('div'); host.appendChild(c1);
  const cleanup1 = await mod.mountView('v1', c1, {});
  out.dataPage = c1.getAttribute('data-page');
  out.rendered = c1.textContent;
  cleanup1(); cleanup1();
  out.cleanupCalls = calls.slice();

  // Abort while render() is pending: cleaned up at once, a no-op returned.
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls2 = [];
  window.aiui.registerView('v2', async () => { await gate; return () => calls2.push('returned'); }, () => calls2.push('module'));
  const c2 = document.createElement('div'); host.appendChild(c2);
  const ac = new AbortController();
  const pending = mod.mountView('v2', c2, { signal: ac.signal });
  ac.abort(); release();
  const cleanup2 = await pending;
  out.abortCalls = calls2.slice();
  cleanup2();
  out.abortCallsAfterNoop = calls2.slice();

  // Detached container: never rendered.
  const calls3 = [];
  window.aiui.registerView('v3', () => { calls3.push('render'); });
  await mod.mountView('v3', document.createElement('div'), {});
  out.detachedRenders = calls3.length;

  // page:<id>:toolbar slot renders above the view and goes with it.
  window.aiui.registerSlot('page:v1:toolbar', () => document.createElement('button'));
  const c4 = document.createElement('div'); host.appendChild(c4);
  const cleanup4 = await mod.mountView('v1', c4, {});
  const i4 = host.children.indexOf(c4);
  out.toolbarAbove = i4 > 0 && host.children[i4 - 1].className.includes('aiui-legacy-toolbar');
  cleanup4();
  out.toolbarLeft = host.children.filter((c) => c.className.includes('aiui-legacy-toolbar')).length;

  // A late registerView for the active page must not call selectPage in host mode.
  const navCount = navs.length;
  window.aiui.registerView('v1', () => {});
  out.lateRegisterNavigated = navs.length !== navCount;
} else if (scenario === 'viewretry') {
  // Browsers keep a failed module fetch in the module map for the document:
  // the same URL rejects again without a request. These in-thread hooks do
  // the same for /plugins/views/*, so a retry only works under a new URL.
  const { registerHooks } = await import('node:module');
  const PREFIX = 'file:///aiui-test';
  const failed = new Set();
  let failNext = true;
  out.viewRequests = [];
  globalThis.__viewEvals = 0;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('/plugins/views/')) return { url: PREFIX + specifier, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(PREFIX)) return next(url, context);
      const path = url.slice(PREFIX.length);
      out.viewRequests.push(path);
      if (failed.has(path)) throw new Error('cached failure ' + path);
      if (failNext) { failNext = false; failed.add(path); throw new Error('HTTP 500 ' + path); }
      return {
        format: 'module',
        shortCircuit: true,
        source: 'globalThis.__viewEvals += 1; export function render(el) { el.textContent = "overview view"; }',
      };
    },
  });
  window.__AIUI_BUILD__ = 'b1';
  const mod = await import(pathToFileURL(dashPath).href);
  await mod.initHostRuntime({ navigate: () => Promise.resolve(), palette: false, approvalUi: 'event-only' });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const mountOnce = async () => {
    const el = document.createElement('div'); host.appendChild(el);
    const cleanup = await mod.mountView('overview', el, {});
    const text = el.textContent || '';
    cleanup(); el.remove();
    return text;
  };
  out.first = await mountOnce();   // import fails: the generic viewer stands in
  out.second = await mountOnce();  // a new URL: the view loads
  out.third = await mountOnce();   // cached in VIEW_REGISTRY: no import at all
  out.viewEvals = globalThis.__viewEvals;
  // Ids that are Object.prototype keys are not built-in views.
  const el = document.createElement('div'); host.appendChild(el);
  await mod.mountView('constructor', el, {});
  out.requestsAfterProtoId = out.viewRequests.length;
} else if (scenario === 'staleremount') {
  // The same page re-mounts while the first mount's render() is still in
  // flight (a late registerView, or leaving and coming back quickly). The
  // view keeps module-level state, as legacy views do (intervals, sockets).
  const mod = await import(pathToFileURL(dashPath).href);
  await mod.initHostRuntime({ navigate: () => Promise.resolve(), palette: false, approvalUi: 'event-only' });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const calls = [];
  let moduleState = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  let renders = 0;
  window.aiui.registerView('v5', async (el) => {
    const name = renders++ === 0 ? 'A' : 'B';
    moduleState = name; // set up shared state, then wait for data
    if (name === 'A') await gate;
    return () => calls.push('returned:' + name);
  }, () => { calls.push('module'); moduleState = null; });
  const a = document.createElement('div'); host.appendChild(a);
  const acA = new AbortController();
  const pendingA = mod.mountView('v5', a, { signal: acA.signal });
  await tick();
  acA.abort(); a.remove();
  const b = document.createElement('div'); host.appendChild(b);
  const cleanupB = await mod.mountView('v5', b, {});
  release();
  await pendingA;
  out.callsAfterStale = calls.slice();
  out.stateAfterStale = moduleState;
  cleanupB();
  out.callsAfterLive = calls.slice();
  out.stateAfterLive = moduleState;
  // A stale mount that finishes after the newer one is gone still cleans up.
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  const calls2 = [];
  window.aiui.registerView('v6', async () => { await gate2; return () => calls2.push('returned'); }, () => calls2.push('module'));
  const c = document.createElement('div'); host.appendChild(c);
  const acC = new AbortController();
  const pendingC = mod.mountView('v6', c, { signal: acC.signal });
  await tick();
  acC.abort();
  release2();
  await pendingC;
  out.lateStaleCalls = calls2.slice();
} else if (scenario === 'bootretry') {
  // The first boot rejects (the style tag cannot be inserted); the next call boots again.
  const realInsert = document.head.insertBefore.bind(document.head);
  let failInsert = true;
  document.head.insertBefore = (c, ref) => {
    if (failInsert) { failInsert = false; throw new Error('insert failed (simulated)'); }
    return realInsert(c, ref);
  };
  const mod = await import(pathToFileURL(dashPath).href);
  const opts = { navigate: () => Promise.resolve(), palette: false, approvalUi: 'event-only' };
  const first = mod.initHostRuntime(opts);
  out.firstRejected = await first.then(() => false, () => true);
  const second = mod.initHostRuntime(opts);
  out.newPromise = second !== first;
  out.pages = (await second).pages.map((p) => p.id);
  out.samePromiseAfterSuccess = mod.initHostRuntime(opts) === second;
  out.docKeydown = counts.docKeydown;
  out.styleTags = document.head.children.filter((c) => c.id === 'aiui-legacy-style').length;
} else if (scenario === 'authfetch') {
  sessionStorage.setItem('aiui_gateway_token', 'secret-token');
  const mod = await import(pathToFileURL(dashPath).href);
  await mod.initHostRuntime({ navigate: () => Promise.resolve(), palette: false, approvalUi: 'event-only' });
  fetchCalls.length = 0;
  await window.fetch(new URL('https://evil.test/collect'));
  await window.fetch('https://evil.test/collect');
  await window.fetch({ url: 'https://evil.test/collect', headers: undefined });
  await window.fetch(new URL('/api/pages', location.href));
  await window.fetch('/api/pages');
  out.fetchCalls = fetchCalls.slice();
} else if (scenario === 'defaults') {
  // showApprovalModal looks its buttons up by id in markup this fake DOM does
  // not parse; hand it detached stand-ins.
  const byId = document.getElementById;
  document.getElementById = (id) => byId(id) || (id.startsWith('approval-') ? new FakeElement('button') : null);
  const mod = await import(pathToFileURL(dashPath).href);
  await mod.initHostRuntime({});
  out.docKeydown = counts.docKeydown;
  out.paletteHook = window.aiui.openCommandPalette && window.aiui.openCommandPalette.name;
  window.dispatchEvent(new CustomEvent('aiui:approval-required', { detail: { id: 'm1', tool_name: 'shell' } }));
  await tick();
  out.bodyOverlays = document.body.children.filter((c) => /db-modal-overlay/.test(c.className)).length;
}
console.log(JSON.stringify(out));
"""


def _run_node(tmp_path: Path, scenario: str) -> dict:
    script = tmp_path / "harness.mjs"
    script.write_text(_NODE_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [NODE, str(script), str(DASHBOARD_JS), scenario],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp_path,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def host_run(tmp_path_factory) -> dict:
    if NODE is None:
        pytest.skip("node is not installed")
    return _run_node(tmp_path_factory.mktemp("host"), "host")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
class TestHostRuntimeBehaviour:
    def test_boot_returns_pages(self, host_run):
        assert host_run["pages"] == ["v1", "metrics"]

    def test_palette_false_hands_ctrl_k_back_to_the_shell(self, host_run):
        assert host_run["legacyOverwroteOnEval"] is True
        assert host_run["paletteRestored"] is True
        # No shell hook existed for these, so the legacy ones are removed.
        assert host_run["closeHook"] == "undefined"
        assert host_run["globalHook"] == "undefined"
        # Only the session-search Escape handler; no legacy Ctrl+K listener.
        assert host_run["docKeydown"] == 1

    def test_select_page_goes_through_the_latest_navigator(self, host_run):
        assert host_run["navs"] == [["first", "logs"], ["second", "usage"]]
        assert host_run["samePromise"] is True

    def test_host_style(self, host_run):
        style = host_run["style"]
        assert host_run["styleFirstInHead"] is True
        assert ":where(html) {" in style
        # No colour defaults that would compete with the bridge or user CSS.
        root_block = re.search(r":where\(html\) \{([^}]*)\}", style).group(1)
        assert "--db-sidebar-w:" in root_block
        assert "--db-bg" not in root_block and "--db-accent" not in root_block
        assert not re.search(r"(?m)^\s*:root\s*\{", style)
        assert not re.search(r"(?m)^\s*body \{", style)
        assert "#root {" not in style and "#root select" not in style
        assert "rgba(255,255,255" not in style.replace(" ", "")

    def test_event_only_approvals(self, host_run):
        assert host_run["eventSources"] == ["/api/approvals/stream"]
        assert host_run["winApprovalListeners"] == 0
        # 'new' carries no entry: the pending list is announced once per id.
        assert host_run["approvalEvents"][:3] == [
            ["aiui:approval-required", "a1"],
            ["aiui:approval-required", "a2"],
            ["aiui:approval-resolved", None],
        ]
        assert host_run["bodyOverlays"] == 0

    def test_mount_view_cleanup_runs_both_once(self, host_run):
        assert host_run["dataPage"] == "v1"
        assert host_run["rendered"] == "v1"
        assert host_run["cleanupCalls"] == ["returned", "module"]

    def test_mount_view_abort_cleans_up_immediately(self, host_run):
        assert host_run["abortCalls"] == ["returned", "module"]
        assert host_run["abortCallsAfterNoop"] == ["returned", "module"]

    def test_mount_view_detached_container_never_renders(self, host_run):
        assert host_run["detachedRenders"] == 0

    def test_toolbar_slot(self, host_run):
        assert host_run["toolbarAbove"] is True
        assert host_run["toolbarLeft"] == 0

    def test_late_register_view_does_not_navigate(self, host_run):
        assert host_run["lateRegisterNavigated"] is False

    def test_stale_mount_leaves_module_state_to_the_live_mount(self, tmp_path):
        # Regression: a mount aborted while render() was in flight ran the
        # view's module-level cleanup when it finished, tearing down the state
        # of the newer mount of the same page that was already on screen.
        out = _run_node(tmp_path, "staleremount")
        assert out["callsAfterStale"] == ["returned:A"]
        assert out["stateAfterStale"] == "B"
        assert out["callsAfterLive"] == ["returned:A", "returned:B", "module"]
        assert out["stateAfterLive"] is None
        # With no other live mount, a stale mount still runs both cleanups.
        assert out["lateStaleCalls"] == ["returned", "module"]

    def test_failed_view_import_retries_under_a_new_url(self, tmp_path):
        # Regression: a browser caches a failed module fetch per URL, so
        # importing the same ?v=<build> URL again never recovered.
        if not _HAS_REGISTER_HOOKS:
            pytest.skip("node:module registerHooks() needs Node >= 22.15")
        out = _run_node(tmp_path, "viewretry")
        assert out["first"] != "overview view"  # generic viewer fallback
        assert out["second"] == "overview view"
        assert out["third"] == "overview view"
        assert out["viewRequests"] == [
            "/plugins/views/overview.js?v=b1",
            "/plugins/views/overview.js?v=b1&r=1",
        ]
        assert out["viewEvals"] == 1  # never a second module instance
        assert out["requestsAfterProtoId"] == 2

    def test_rejected_boot_is_retried(self, tmp_path):
        out = _run_node(tmp_path, "bootretry")
        assert out["firstRejected"] is True
        assert out["newPromise"] is True
        assert out["pages"] == ["v1", "metrics"]
        assert out["samePromiseAfterSuccess"] is True
        assert out["docKeydown"] == 1  # session-search Escape bound once, not per boot
        assert out["styleTags"] == 1

    def test_auth_fetch_keeps_the_token_same_origin(self, tmp_path):
        # Regression: fetch(new URL(cross-origin)) read input.url ('' for a
        # URL object), counted as same-origin and sent the Bearer token.
        calls = _run_node(tmp_path, "authfetch")["fetchCalls"]
        assert [c["auth"] for c in calls] == [
            None,
            None,
            None,
            "Bearer secret-token",
            "Bearer secret-token",
        ]

    def test_defaults_keep_legacy_palette_and_modal(self, tmp_path):
        out = _run_node(tmp_path, "defaults")
        assert out["docKeydown"] == 2  # palette Ctrl+K + session-search Escape
        assert out["paletteHook"] == "openCommandPalette"
        assert out["bodyOverlays"] == 1


# ── Cascade in a real browser ─────────────────────────────────────────

_TOKENS = """
:root { --background: #fafafa; --foreground: #18181b; --card: #ffffff; --popover: #ffffff;
  --border: #e4e4e7; --muted: #f4f4f5; --muted-foreground: #71717a; --accent: #f4f4f5;
  --primary: #18181b; --destructive: #dc2626; --sidebar-accent: #f4f4f5;
  --sidebar-accent-foreground: #18181b; --sidebar-border: #e4e4e7; --radius: 8px;
  --seed-accent: #18181b; }
.dark { --background: #0c0c0e; --foreground: #f4f4f5; --border: #27272a; --seed-accent: #f4f4f5; }
"""


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_user_css_beats_the_bridge_in_chromium(host_run):
    sync_api = pytest.importorskip("playwright.sync_api")
    bridge = BRIDGE_CSS.read_text(encoding="utf-8")
    host_style = host_run["style"]
    user = ":root { --db-accent: #10b981; --db-bg: #000001; }"

    def page_html(user_first: bool, dark: bool) -> str:
        user_tag = f'<style id="aiui-custom-css">{user}</style>'
        sheets = (
            f'<style id="aiui-legacy-style">{host_style}</style>'
            f"<style>{_TOKENS}</style><style>{bridge}</style>"
        )
        head = user_tag + sheets if user_first else sheets + user_tag
        cls = ' class="dark"' if dark else ""
        return f'<!doctype html><html data-aiui-shell="react"{cls}><head>{head}</head><body></body></html>'

    probe = """() => { const s = getComputedStyle(document.documentElement);
      const v = (n) => s.getPropertyValue(n).trim();
      return { accent: v('--db-accent'), bg: v('--db-bg'), text: v('--db-text'), fg: v('--foreground'),
               sidebarW: v('--db-sidebar-w'), pFill: v('--db-p-fill') }; }"""
    with sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # browser binaries not installed
            pytest.skip(f"chromium unavailable: {exc}")
        try:
            page = browser.new_page()
            for user_first in (True, False):
                page.set_content(page_html(user_first, dark=False))
                got = page.evaluate(probe)
                assert got["accent"] == "#10b981", (user_first, got)
                assert got["bg"] == "#000001", (user_first, got)
                assert got["sidebarW"] == "260px"
            # Without user CSS the bridge maps onto the tokens, in both modes.
            for dark in (False, True):
                cls = ' class="dark"' if dark else ""
                page.set_content(
                    f'<!doctype html><html data-aiui-shell="react"{cls}><head>'
                    f'<style id="aiui-legacy-style">{host_style}</style>'
                    f"<style>{_TOKENS}</style><style>{bridge}</style></head><body></body></html>"
                )
                got = page.evaluate(probe)
                assert got["bg"] == ("#0c0c0e" if dark else "#fafafa"), got
                assert got["text"] == got["fg"], got
                assert got["accent"] and "#71717a" not in got["accent"], got
        finally:
            browser.close()


# ── LegacyViewHost Retry in a real browser ────────────────────────────

FRONTEND = ROOT / "src" / "frontend"

_BUNDLE_SCRIPT = r"""
const { createRequire } = require('node:module');
const path = require('node:path');
const [, , frontend, outfile] = process.argv;
const esbuild = createRequire(path.join(frontend, 'package.json'))('esbuild');
esbuild.build({
  stdin: {
    contents: `
      import { createElement } from 'react'
      import { createRoot } from 'react-dom/client'
      import { LegacyViewHost } from '@/legacy/LegacyViewHost'
      createRoot(document.getElementById('app')).render(
        createElement(LegacyViewHost, { pageId: 'overview', page: { id: 'overview', title: 'Overview', kind: 'legacy' } }),
      )
    `,
    resolveDir: frontend,
    loader: 'tsx',
    sourcefile: 'retry-entry.tsx',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  tsconfig: path.join(frontend, 'tsconfig.app.json'),
  alias: { '@': path.join(frontend, 'src') },
  loader: { '.css': 'empty' },
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: false, BASE_URL: '/' }),
  },
  logLevel: 'error',
}).catch(() => process.exit(1));
"""


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_retry_recovers_after_a_failed_dashboard_load_in_chromium(tmp_path):
    """500 then 200 for dashboard.js (and for a view module), then Retry.

    Chromium caches a failed module fetch per URL, so a retry must import a
    new URL. Regression for the Retry button that never left data-status=error.
    """
    if not (FRONTEND / "node_modules" / "esbuild").is_dir():
        pytest.skip("frontend node_modules not installed (cd src/frontend && npm ci)")
    sync_api = pytest.importorskip("playwright.sync_api")
    script = tmp_path / "bundle.cjs"
    script.write_text(_BUNDLE_SCRIPT, encoding="utf-8")
    bundle = tmp_path / "app.js"
    proc = subprocess.run(
        [NODE, str(script), str(FRONTEND), str(bundle)], capture_output=True, text=True, timeout=120
    )
    assert proc.returncode == 0, proc.stderr
    app_js = bundle.read_text(encoding="utf-8")
    dashboard_js = DASHBOARD_JS.read_text(encoding="utf-8")
    html = (
        '<!doctype html><html data-aiui-shell="react"><head><meta charset="utf-8"></head>'
        '<body><div id="app"></div><script>window.__AIUI_BUILD__ = "e2e";</script>'
        '<script type="module" src="/app.js"></script></body></html>'
    )
    api = {
        "/api/auth/status": {"authenticated": True, "mode": "standalone"},
        "/api/pages": {"pages": [{"id": "overview", "title": "Overview"}]},
        "/api/dashboard/plugins": {"plugins": []},
    }
    requests: dict[str, list[str]] = {"dashboard": [], "view": []}
    fail_next = {"dashboard": True, "view": True}

    def handle(route):
        from urllib.parse import urlsplit

        parts = urlsplit(route.request.url)
        path, full = parts.path, parts.path + (f"?{parts.query}" if parts.query else "")
        if path == "/":
            return route.fulfill(status=200, content_type="text/html", body=html)
        if path == "/app.js":
            return route.fulfill(status=200, content_type="text/javascript", body=app_js)
        for key, file_path, body in (
            ("dashboard", "/plugins/dashboard.js", dashboard_js),
            (
                "view",
                "/plugins/views/overview.js",
                "export function render(el) { el.innerHTML = '<p id=\"ov\">overview view</p>'; }",
            ),
        ):
            if path == file_path:
                requests[key].append(full)
                if fail_next[key]:
                    fail_next[key] = False
                    return route.fulfill(status=500, body="boom")
                return route.fulfill(status=200, content_type="text/javascript", body=body)
        if path in api:
            return route.fulfill(
                status=200, content_type="application/json", body=json.dumps(api[path])
            )
        return route.fulfill(status=404, content_type="application/json", body="{}")

    host = ".aiui-legacy-host"
    with sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # browser binaries not installed
            pytest.skip(f"chromium unavailable: {exc}")
        try:
            page = browser.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("http://aiui.test/**", handle)
            page.goto("http://aiui.test/")
            page.wait_for_selector(f'{host}[data-status="error"]', state="attached", timeout=15000)
            assert requests["dashboard"] == ["/plugins/dashboard.js?v=e2e"]

            # The server is back: Retry loads the runtime under a new URL.
            page.get_by_role("button", name="Retry").click()
            page.wait_for_selector(f'{host}[data-status="ready"]', state="attached", timeout=15000)
            assert requests["dashboard"] == [
                "/plugins/dashboard.js?v=e2e",
                "/plugins/dashboard.js?v=e2e&r=1",
            ]
            # The view module's own first fetch failed: the generic viewer stood in.
            assert requests["view"] == ["/plugins/views/overview.js?v=e2e"]
            assert page.locator("#ov").count() == 0

            # The next mount of the page fetches the view again and renders it.
            page.evaluate(
                "() => window.dispatchEvent(new CustomEvent('aiui:view-registered', { detail: { pageId: 'overview' } }))"
            )
            page.wait_for_selector("#ov", timeout=15000)
            page.wait_for_selector(f'{host}[data-status="ready"]', state="attached", timeout=15000)
            assert requests["view"] == [
                "/plugins/views/overview.js?v=e2e",
                "/plugins/views/overview.js?v=e2e&r=1",
            ]

            # Loaded once: later mounts never import dashboard.js or the view again.
            page.evaluate(
                "() => window.dispatchEvent(new CustomEvent('aiui:view-registered', { detail: { pageId: 'overview' } }))"
            )
            page.wait_for_selector("#ov", timeout=15000)
            assert len(requests["dashboard"]) == 2
            assert len(requests["view"]) == 2
            assert page.locator(".aiui-legacy-mount").count() == 1
            assert errors == []
        finally:
            browser.close()
