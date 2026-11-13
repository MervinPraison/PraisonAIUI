"""Legacy view hygiene (UI reset WP5).

Three guarantees for the vanilla dashboard's views and feature-plugin modules:

1. **Leaks.** Leaving a page releases what it opened (WebSocket, EventSource,
   setInterval, window listeners, <body> overlays). The gate is a runtime
   probe in a real browser (``TestRuntimeLeakProbe``), not a source grep:
   it switches pages three times in the legacy dashboard and diffs live
   resources. It needs Playwright and Chromium, so it is opt-in like
   ``tests/browser``: ``RUN_BROWSER_TESTS=1 pytest tests/unit/test_legacy_view_hygiene.py``.
2. **Tokens.** The 12 feature-plugin modules paint colours only through the
   plugin-tier namespace ``var(--db-p-<role>, <original literal>)``. Nothing in
   the legacy dashboard defines ``--db-p-*``, so every value resolves to its
   original literal and the legacy dashboard stays pixel-identical. The React
   shell (style ``app``) maps the roles onto its tokens in
   ``src/frontend/src/legacy/bridge.css``, which is how these pages become
   correct in light mode there.
3. **Syntax.** Views are ES modules, so they are checked with
   ``node --input-type=module --check`` (plain ``node --check`` parses them as
   scripts and passes broken modules).
"""

from __future__ import annotations

import functools
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = PLUGINS / "views"
FRONTEND_SRC = ROOT / "src" / "frontend" / "src"

# Feature-plugin modules covered by the token pass.
TOKEN_MODULES = [
    "usage.js",
    "logs.js",
    "agents.js",
    "approvals.js",
    "jobs.js",
    "schedules.js",
    "sessions.js",
    "skills.js",
    "config.js",
    "auth.js",
    "api.js",
    "channels.js",
]

# The plugin-tier role vocabulary: exactly the roles legacy/bridge.css maps
# onto the shell's tokens. A role outside this list would silently keep its
# dark fallback in the shell, so adding one means adding it to the bridge too
# (test_dashboard_host_runtime.py checks the bridge side).
ROLES = {
    # surfaces
    "bg",
    "canvas",
    "sidebar-bg",
    "card-bg",
    "surface",
    "popover",
    "input-bg",
    "muted",
    "muted-fg",
    "hover",
    "fill",
    # text (alpha tiers)
    "text",
    "text-dim",
    "text-muted",
    # strokes
    "border",
    "border-light",
    # accent; -strong is the fill behind white text (buttons, badges)
    "accent",
    "accent-glow",
    "accent-soft",
    "accent-strong",
    # status pairs; -soft aliases -bg, -strong is the fill behind white text
    *(f"{s}{t}" for s in ("success", "warning", "error", "info") for t in ("", "-bg", "-soft")),
    "success-strong",
    "warning-strong",
    "warning-strong-soft",
    "error-strong",
    # categorical (charts, kind and level tags)
    *(f"chart-{i}{t}" for i in range(1, 6) for t in ("", "-soft")),
    "purple",
    "purple-soft",
}

# Views with resources that must be released when the page is left.
CLEANUP_VIEWS = ["logs", "usage", "agents", "schedules", "jobs", "code-studio", "chat-canvas"]

# Every file WP5 touches (syntax-checked as ES modules).
TOUCHED = [PLUGINS / m for m in TOKEN_MODULES] + [
    VIEWS / f"{v}.js"
    for v in ("logs", "usage", "agents", "schedules", "jobs", "theme-picker", "chat-canvas")
]

_COLOR = r"(?:#[0-9a-fA-F]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\))"
DB_P_VAR = re.compile(r"var\(--db-p-([a-z0-9-]+),\s*(" + _COLOR + r")\s*\)")
BARE_HEX = re.compile(r"(?<![\w&])#[0-9a-fA-F]{3,8}\b")
BARE_FN_COLOR = re.compile(r"\b(?:rgba?|hsla?)\([^()]*\)")
# Black scrims and drop shadows are mode-neutral, so they may stay literal.
BLACK = re.compile(r"rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[0-9.]+\s*\)")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _strip_tokens(src: str) -> str:
    return DB_P_VAR.sub("VAR", src)


def _node() -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    return node


def _esm_check(node: str, source: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [node, "--input-type=module", "--check"],
        input=source,
        capture_output=True,
        text=True,
        timeout=60,
    )


# ── Tokens ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("module", TOKEN_MODULES)
def test_no_bare_hex_colour(module):
    """The grep gate: no hex colour outside var(--db-p-<role>, #hex)."""
    src = _strip_tokens(_read(PLUGINS / module))
    hits = [
        f"{module}:{n}: {line.strip()}"
        for n, line in enumerate(src.splitlines(), 1)
        if BARE_HEX.search(line)
    ]
    assert not hits, "bare hex colours (wrap them in var(--db-p-<role>, #hex)):\n" + "\n".join(hits)


@pytest.mark.parametrize("module", TOKEN_MODULES)
def test_no_bare_functional_colour(module):
    """rgb()/rgba()/hsl() follow the same rule; only black scrims/shadows stay literal."""
    src = _strip_tokens(_read(PLUGINS / module))
    hits = [
        f"{module}:{n}: {line.strip()}"
        for n, line in enumerate(src.splitlines(), 1)
        for m in BARE_FN_COLOR.finditer(line)
        if not BLACK.fullmatch(m.group())
    ]
    assert not hits, "bare colour functions:\n" + "\n".join(hits)


@pytest.mark.parametrize("module", TOKEN_MODULES)
def test_every_token_keeps_its_literal_fallback(module):
    """Each var(--db-p-*) carries the original colour as its fallback.

    That fallback is what the legacy dashboard renders, because nothing there
    defines --db-p-*, so the dashboard looks exactly as it did before.
    """
    src = _read(PLUGINS / module)
    total = len(re.findall(r"var\(--db-p-", src))
    with_fallback = len(DB_P_VAR.findall(src))
    assert total == with_fallback, (
        f"{module}: {total - with_fallback} var(--db-p-*) without a literal colour fallback"
    )
    assert total > 0, f"{module}: expected the token pass to have run"


@pytest.mark.parametrize("module", TOKEN_MODULES)
def test_roles_are_in_the_bridge_vocabulary(module):
    roles = {m.group(1) for m in DB_P_VAR.finditer(_read(PLUGINS / module))}
    unknown = sorted(roles - ROLES)
    assert not unknown, f"{module}: roles outside the --db-p-* vocabulary: {unknown}"


def test_bridge_maps_every_role_once_it_defines_the_tier():
    """Once legacy/bridge.css carries the --db-p-* tier, it must cover every
    role the modules read, or the shell shows those pieces in dark hex."""
    bridge = FRONTEND_SRC / "legacy" / "bridge.css"
    text = re.sub(r"/\*.*?\*/", "", _read(bridge), flags=re.S) if bridge.exists() else ""
    defined = set(re.findall(r"--db-p-([a-z0-9-]+)\s*:", text))
    if not defined:
        pytest.skip("legacy/bridge.css does not map the --db-p-* tier yet")
    used = {m.group(1) for mod in TOKEN_MODULES for m in DB_P_VAR.finditer(_read(PLUGINS / mod))}
    assert not sorted(used - defined), f"roles not mapped in bridge.css: {sorted(used - defined)}"


@pytest.mark.parametrize("module", TOKEN_MODULES)
def test_modules_do_not_reuse_dashboard_vars(module):
    """--db-* is defined by the dashboard's :root; reusing it would change legacy dark mode."""
    hits = re.findall(r"var\(--db-(?!p-)[a-z0-9-]+", _read(PLUGINS / module))
    assert not hits, f"{module}: use the --db-p-* namespace, found {sorted(set(hits))}"


def test_db_p_namespace_is_undefined_in_the_legacy_dashboard():
    """No legacy plugin or view defines --db-p-*, so the literal fallbacks apply."""
    definition = re.compile(r"--db-p-[a-z0-9-]+\s*:")
    offenders = [
        str(p.relative_to(ROOT))
        for p in sorted(PLUGINS.rglob("*.js"))
        if definition.search(_read(p))
    ]
    assert not offenders, f"--db-p-* defined in legacy code: {offenders}"


def test_db_p_definitions_in_frontend_css_are_scoped_to_the_shell():
    """Any stylesheet that defines --db-p-* (legacy/bridge.css) does so only under
    html[data-aiui-shell=…]; index.css is also loaded by the legacy dashboard."""
    definition = re.compile(r"--db-p-[a-z0-9-]+\s*:")
    problems = []
    for css in sorted(FRONTEND_SRC.rglob("*.css")):
        text = re.sub(r"/\*.*?\*/", "", _read(css), flags=re.S)
        for m in definition.finditer(text):
            block_start = text.rfind("{", 0, m.start())
            prev_close = max(text.rfind("}", 0, block_start), text.rfind(";", 0, block_start))
            selector = text[prev_close + 1 : block_start]
            if "data-aiui-shell" not in selector:
                problems.append(f"{css.relative_to(ROOT)}: {selector.strip()!r}")
    assert not problems, "unscoped --db-p-* definitions:\n" + "\n".join(problems)


# ── Leaks: static checks (the runtime probe below is the gate) ──────


@pytest.mark.parametrize("view", CLEANUP_VIEWS)
def test_view_exports_cleanup(view):
    assert re.search(r"^export (async )?function cleanup\b", _read(VIEWS / f"{view}.js"), re.M)


@pytest.mark.parametrize(
    ("module", "method"),
    [
        ("logs.js", "destroy"),
        ("usage.js", "stop"),
        ("agents.js", "stop"),
        ("schedules.js", "stop"),
        ("jobs.js", "stop"),
    ],
)
def test_delegated_module_has_teardown(module, method):
    assert re.search(rf"^  {method}\(\) {{", _read(PLUGINS / module), re.M)


def test_logs_destroy_blocks_reconnect_and_render_resets_it():
    """The view module is cached after its first import, so the flag that stops
    the 3 s reconnect must be reset by the next render, or a remount never connects."""
    src = _read(PLUGINS / "logs.js")
    assert re.search(r"destroy\(\) \{\s*closing = true;", src)
    assert "if (!closing) reconnectTimer = setTimeout(connectWebSocket" in src
    render_ui = src[src.index("function renderLogsUI") : src.index("function injectStyles")]
    assert "closing = false;" in render_ui
    assert render_ui.index("closing = false;") < render_ui.index("connectWebSocket();")


def test_jobs_and_schedules_globals_do_not_collide():
    """jobs.js and schedules.js both used window.aiuiDeleteJob; the one loaded last won."""

    def globals_of(name):
        return set(re.findall(r"^window\.(aiui\w+)\s*=", _read(PLUGINS / name), re.M))

    jobs, schedules = globals_of("jobs.js"), globals_of("schedules.js")
    assert not (jobs & schedules), f"colliding window globals: {sorted(jobs & schedules)}"
    assert "aiuiDeleteSchedule" in schedules
    sched_src = _read(PLUGINS / "schedules.js")
    assert "window.aiuiDeleteJob(" not in sched_src
    assert "window.aiuiDeleteSchedule(" in sched_src


# ── Leaks: behaviour in Node (fake DOM, no browser) ─────────────────

# view file -> (delegated module, its teardown method)
DELEGATING_VIEWS = {
    "logs": ("logs", "destroy"),
    "usage": ("usage", "stop"),
    "agents": ("agents", "stop"),
    "schedules": ("schedules", "stop"),
    "jobs": ("jobs", "stop"),
}

_VIEW_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , viewPath, modPath, method] = process.argv;
const root = { id: 'root' };
globalThis.document = { getElementById: (id) => (id === 'root' ? root : null) };
const container = () => ({
  isConnected: true, attrs: {}, classes: [],
  setAttribute(k, v) { this.attrs[k] = v; },
  classList: { add() {} },
  closest: () => root,
});
const fake = (await import(pathToFileURL(modPath).href)).default;
const view = await import(pathToFileURL(viewPath).href);
const out = {};

// Safe and idempotent before any render.
view.cleanup(); view.cleanup();
out.beforeRender = fake.log.splice(0);

// Render, then leave: the module is torn down.
const c0 = container();
await view.render(c0);
c0.isConnected = false;
view.cleanup();
out.leave = fake.log.splice(0);
view.cleanup();
out.leaveAgain = fake.log.splice(0);

// The same page selected twice while it loads: the first render is
// superseded, and its cleanup arrives after the second render has started.
// That late cleanup must not tear down the page on screen.
const c1 = container(), c2 = container();
const p1 = view.render(c1);
c1.isConnected = false;
const p2 = view.render(c2);
await p1; await p2;
view.cleanup();               // the superseded render's cleanup
out.superseded = fake.log.splice(0);
view.cleanup();               // leaving the page
out.leaveAfterSuperseded = fake.log.splice(0);

// A render that throws gets no cleanup from the host; it must not pin the
// module alive for later visits.
fake.failInit = true;
let threw = false;
try { await view.render(container()); } catch (e) { threw = true; }
fake.failInit = false;
out.threw = threw;
out.afterThrow = fake.log.splice(0);
const c3 = container();
await view.render(c3);
view.cleanup();
out.visitAfterThrow = fake.log.splice(0);

// The legacy dashboard imports a fresh copy of the view (?v=<time>) on each
// first visit. A slow render in one copy, superseded by a render in another,
// is cleaned up late: it must not stop the module the other copy started.
const copy = await import(pathToFileURL(viewPath).href + '?v=2');
const c4 = container(), c5 = container();
const p4 = view.render(c4);
const p5 = copy.render(c5);
await p4; await p5;
c4.isConnected = false;
view.cleanup();               // the superseded render (first copy)
out.crossCopySuperseded = fake.log.splice(0);
copy.cleanup();               // leaving the page (second copy)
out.crossCopyLeave = fake.log.splice(0);
console.log(JSON.stringify(out));
"""

_FAKE_MODULE = """
const log = [];
export default {
  log, failInit: false, gate: null,
  async init() {
    log.push('init');
    if (this.gate) await this.gate;  // a slow init fetch
    if (this.failInit) throw new Error('boom');
  },
  onContentChange(root) { log.push('content:' + root.id); },
  %s() { log.push('teardown'); },
};
"""


@pytest.mark.parametrize("view", sorted(DELEGATING_VIEWS))
def test_view_cleanup_pairs_with_renders(view, tmp_path):
    node = _node()
    module, method = DELEGATING_VIEWS[view]
    (tmp_path / "views").mkdir()
    shutil.copy(VIEWS / f"{view}.js", tmp_path / "views" / f"{view}.js")
    (tmp_path / f"{module}.js").write_text(_FAKE_MODULE % method, encoding="utf-8")
    (tmp_path / "harness.mjs").write_text(_VIEW_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [
            node,
            str(tmp_path / "harness.mjs"),
            str(tmp_path / "views" / f"{view}.js"),
            str(tmp_path / f"{module}.js"),
            method,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["beforeRender"] == []
    assert out["leave"] == ["init", "content:root", "teardown"]
    assert out["leaveAgain"] == ["teardown"]  # idempotent: the module's teardown is a no-op twice
    # Only the live render reaches the module; the late cleanup leaves it running.
    assert out["superseded"] == ["init", "content:root"]
    assert out["leaveAfterSuperseded"] == ["teardown"]
    assert out["threw"] is True
    assert out["afterThrow"] == ["init", "teardown"]
    assert out["visitAfterThrow"] == ["init", "content:root", "teardown"]
    assert sorted(out["crossCopySuperseded"]) == ["content:root", "content:root", "init", "init"]
    assert out["crossCopyLeave"] == ["teardown"]


# The shell's host policy, as dashboard.js mountView() implements it (WP4):
# the function render() returns is that mount's own cleanup and always runs;
# the view's cleanup() export runs only once no other mount of the page is
# live; a mount that went stale while loading is cleaned up when it resolves.
_SHELL_HOST = r"""
const hostLive = new Set();
async function mountView(view, container) {
  const token = {};
  hostLive.add(token);
  const returned = await view.render(container);
  const instance = typeof returned === 'function' ? returned : null;
  const moduleCleanup = typeof view.cleanup === 'function' && view.cleanup !== returned ? view.cleanup : null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    hostLive.delete(token);
    if (instance) instance();
    if (hostLive.size === 0 && moduleCleanup) moduleCleanup();
  };
  if (container.isConnected) return cleanup;
  cleanup();
  return () => {};
}
"""

_SHELL_VIEW_HARNESS = (
    r"""
import { pathToFileURL } from 'node:url';
const [, , viewPath, modPath] = process.argv;
const root = { id: 'root' };
globalThis.document = { getElementById: (id) => (id === 'root' ? root : null) };
const container = () => ({
  isConnected: true, setAttribute() {}, classList: { add() {} }, closest: () => root,
});
const fake = (await import(pathToFileURL(modPath).href)).default;
const view = await import(pathToFileURL(viewPath).href);
"""
    + _SHELL_HOST
    + r"""
const out = {};
const tick = () => new Promise((r) => setTimeout(r, 0));

// Plain visit.
const c0 = container();
const leave0 = await mountView(view, c0);
out.shown = fake.log.splice(0);
leave0();
out.left = fake.log.splice(0);

// Leave and come back while the first mount's init is still fetching; the
// first mount resolves after the second is on screen.
let open; fake.gate = new Promise((r) => { open = r; });
const a = container();
const pA = mountView(view, a);
await tick();
a.isConnected = false;
fake.gate = null;
const b = container();
const leaveB = await mountView(view, b);
open(); await pA;
out.whileSecondShown = fake.log.splice(0);   // the stale mount must not stop it
leaveB();
out.leftAfterRemount = fake.log.splice(0);   // ...and leaving must

// The second mount is left before the stale first one resolves.
fake.gate = new Promise((r) => { open = r; });
const d = container();
const pD = mountView(view, d);
await tick();
d.isConnected = false;
fake.gate = null;
const e = container();
const leaveE = await mountView(view, e);
leaveE();
out.leftBeforeStaleResolved = fake.log.splice(0);
open(); await pD;
out.staleResolved = fake.log.splice(0);

// Nothing is pinned: the next visit starts and stops cleanly.
const leaveF = await mountView(view, container());
leaveF();
out.nextVisit = fake.log.splice(0);
console.log(JSON.stringify(out));
"""
)


@pytest.mark.parametrize("view", sorted(DELEGATING_VIEWS))
def test_view_cleanup_under_the_shell_mount_policy(view, tmp_path):
    """A fast leave-and-return during a page's init fetch must not leave its
    poll (or log stream) running under the shell's mountView, which skips the
    module cleanup while another mount of the page is live."""
    node = _node()
    module, method = DELEGATING_VIEWS[view]
    (tmp_path / "views").mkdir()
    shutil.copy(VIEWS / f"{view}.js", tmp_path / "views" / f"{view}.js")
    (tmp_path / f"{module}.js").write_text(_FAKE_MODULE % method, encoding="utf-8")
    (tmp_path / "harness.mjs").write_text(_SHELL_VIEW_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [
            node,
            str(tmp_path / "harness.mjs"),
            str(tmp_path / "views" / f"{view}.js"),
            str(tmp_path / f"{module}.js"),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["shown"] == ["init", "content:root"]
    assert out["left"] and set(out["left"]) == {"teardown"}
    assert "teardown" not in out["whileSecondShown"], out["whileSecondShown"]
    assert out["whileSecondShown"].count("content:root") == 1  # only the live mount paints
    assert out["leftAfterRemount"] and set(out["leftAfterRemount"]) == {"teardown"}
    # The stale mount holds the module only until its init resolves, then
    # lets go: the teardown is late (bounded by that fetch) but never lost.
    assert "teardown" not in out["leftBeforeStaleResolved"], out
    assert out["staleResolved"] and set(out["staleResolved"]) == {"teardown"}, out
    assert out["nextVisit"][:2] == ["init", "content:root"]
    assert out["nextVisit"][2:] and set(out["nextVisit"][2:]) == {"teardown"}


_LOGS_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , logsPath] = process.argv;
const sockets = [];
const timers = new Map();
let nextTimer = 1;
globalThis.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose(); }
  send() {}
}
globalThis.WebSocket = FakeWS;
globalThis.window = { location: { protocol: 'http:', host: 'x' } };
const el = (sel) => ({ sel, attrs: {}, innerHTML: '', textContent: '', className: '',
  hasAttribute(k) { return k in this.attrs; }, setAttribute(k, v) { this.attrs[k] = v; } });
let status = null, section = null;
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({}),
  querySelector(sel) {
    if (sel === '[data-aiui-logs]') return section && section.attrs['data-aiui-logs'] ? section : null;
    if (sel === '.aiui-logs-status') return status;
    return null;
  },
  querySelectorAll: () => [],
};
const root = { querySelector: (sel) => (sel === '[data-page="logs"]' ? section : null) };
const mod = (await import(pathToFileURL(logsPath).href)).default;
const mount = () => { section = el('section'); status = el('status'); mod.onContentChange(root); };
const live = () => sockets.filter((s) => s.readyState < 2).length;
const out = {};

mod.destroy(); mod.destroy();          // safe before any render
mount();
sockets[0].open();
out.firstBadge = status.textContent;
mod.destroy();                         // leave the page
out.liveAfterLeave = live();
out.timersAfterLeave = timers.size;    // no 3 s reconnect scheduled

mount();                               // come back: a fresh connection
out.socketsAfterRemount = sockets.length;
sockets[1].open();
out.badgeAfterOpen = status.textContent;

sockets[1].close();                    // a real drop still reconnects
out.timersAfterDrop = [...timers.values()].map((t) => t.ms);
mod.destroy();                         // ...unless the page was left
out.timersAfterDestroy = timers.size;
out.liveAtEnd = live();

// The gateway token (dashboard onboarding, sessionStorage) rides in the
// query string: a WebSocket handshake cannot carry an Authorization header.
out.urlWithoutToken = sockets[0].url;
globalThis.window.sessionStorage = { getItem: (k) => (k === 'aiui_gateway_token' ? 'a b&c' : null) };
mount();
out.urlWithToken = sockets[sockets.length - 1].url;
mod.destroy();
console.log(JSON.stringify(out));
"""


def test_logs_module_closes_its_stream_and_reconnects_on_remount(tmp_path):
    node = _node()
    harness = tmp_path / "harness.mjs"
    harness.write_text(_LOGS_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [node, str(harness), str(PLUGINS / "logs.js")], capture_output=True, text=True, timeout=60
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["firstBadge"] == "● Connected"
    assert out["liveAfterLeave"] == 0
    assert out["timersAfterLeave"] == 0
    assert out["socketsAfterRemount"] == 2
    assert out["badgeAfterOpen"] == "● Connected"
    assert out["timersAfterDrop"] == [3000]
    assert out["timersAfterDestroy"] == 0
    assert out["liveAtEnd"] == 0
    assert "token=" not in out["urlWithoutToken"]
    assert out["urlWithToken"].endswith("&token=a%20b%26c"), out["urlWithToken"]


# ── chat-canvas and the embedded chat ───────────────────────────────

_CANVAS_FAKES = {
    "views/chat.js": """
export async function render(host) {
  globalThis.__log.push('chat:render');
  if (globalThis.__chatGate) await globalThis.__chatGate;  // slow agents/sessions fetch
}
export function cleanup() { globalThis.__log.push('chat:cleanup'); }
""",
    "canvas-preview.js": """
export function mountPreview() { globalThis.__log.push('preview:mount'); }
export function refreshPreview() {}
export function unmountPreview() { globalThis.__log.push('preview:unmount'); }
""",
    "surface-utils.js": "export function registerDefaultSurfaceRenderer() {}\n",
}

_CANVAS_HARNESS = (
    r"""
import { pathToFileURL } from 'node:url';
const [, , viewPath] = process.argv;
const log = (globalThis.__log = []);
globalThis.location = { search: '' };
globalThis.history = { pushState() {} };
globalThis.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } };
let configGate = null;
globalThis.fetch = async () => { if (configGate) await configGate; return { json: async () => ({}) }; };
const node = () => ({ addEventListener() {}, classList: { toggle() {} }, textContent: '', title: '' });
const container = () => ({ isConnected: true, innerHTML: '', querySelector: () => node() });
const view = await import(pathToFileURL(viewPath).href);
"""
    + _SHELL_HOST
    + r"""
const out = {};
const tick = () => new Promise((r) => setTimeout(r, 0));

// Legacy dashboard: plain visit, then leave.
const c0 = container();
await view.render(c0);
out.shown = log.splice(0);
view.cleanup();
out.left = log.splice(0);

// Legacy dashboard: the page selected twice while it loads. The first render
// is superseded and cleaned up late, after the second one is on screen.
let open; globalThis.__chatGate = new Promise((r) => { open = r; });
const c1 = container(), c2 = container();
const p1 = view.render(c1);
await tick();                            // its chat is loading
c1.isConnected = false;
globalThis.__chatGate = null;
await view.render(c2);
open(); await p1;
out.bothRendered = log.splice(0);
view.cleanup();                          // the superseded render
out.lateCleanup = log.splice(0);
view.cleanup();                          // leaving the page
out.leftAfterSuperseded = log.splice(0);

// Left while the preview config loads: no chat socket, no surface socket.
configGate = new Promise((r) => { open = r; });
const c3 = container();
const p3 = view.render(c3);
c3.isConnected = false;
open(); configGate = null; await p3;
view.cleanup();
out.leftWhileLoading = log.splice(0);

// The shell: leave and come back while the first mount is loading.
globalThis.__chatGate = new Promise((r) => { open = r; });
const a = container();
const pA = mountView(view, a);
await tick();
a.isConnected = false;
globalThis.__chatGate = null;
const leaveB = await mountView(view, container());
open(); await pA;
out.shellWhileSecondShown = log.splice(0);
leaveB();
out.shellLeft = log.splice(0);
console.log(JSON.stringify(out));
"""
)


def test_chat_canvas_tears_down_only_its_last_mount(tmp_path):
    """chat-canvas closes the embedded chat's socket and the preview's surface
    socket when left, under both hosts, and a late cleanup of a superseded
    render never closes the sockets of the page on screen."""
    node = _node()
    for rel, text in _CANVAS_FAKES.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    shutil.copy(VIEWS / "chat-canvas.js", tmp_path / "views" / "chat-canvas.js")
    (tmp_path / "harness.mjs").write_text(_CANVAS_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [node, str(tmp_path / "harness.mjs"), str(tmp_path / "views" / "chat-canvas.js")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    teardown = ["chat:cleanup", "preview:unmount"]
    assert out["shown"] == ["preview:mount", "chat:render"]
    assert out["left"] == teardown
    assert sorted(out["bothRendered"]) == sorted(["preview:mount", "chat:render"] * 2)
    assert out["lateCleanup"] == [], out["lateCleanup"]
    assert out["leftAfterSuperseded"] == teardown
    assert out["leftWhileLoading"] == teardown  # nothing was opened, nothing is left open
    assert "chat:cleanup" not in out["shellWhileSecondShown"], out["shellWhileSecondShown"]
    assert out["shellLeft"][:2] == teardown, out["shellLeft"]


_CHAT_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , chatPath] = process.argv;
console.log = console.warn = console.error = () => {};
// Fake timers: nothing runs unless the harness fires it.
const timers = new Map(); let nextTimer = 1;
globalThis.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
const intervals = new Set();
globalThis.setInterval = () => { const id = nextTimer++; intervals.add(id); return id; };
globalThis.clearInterval = (id) => { intervals.delete(id); };
const pending = (ms) => [...timers.values()].filter((t) => t.ms === ms).length;
const fire = (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } };
const sockets = [];
class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  // As in a browser, close() lands later and onclose is read only then.
  close() { if (this.readyState >= 2) return; this.readyState = 2; queueMicrotask(() => this.drop()); }
  drop() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({}); }
  send() {}
}
globalThis.WebSocket = FakeWS;
// A permissive DOM: every element accepts any property, call or child.
const el = () => new Proxy({
  style: {}, dataset: {}, options: [], children: [], value: '', innerHTML: '', textContent: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelectorAll: () => [], querySelector: () => el(), closest: () => null,
  getAttribute: () => null, scrollHeight: 0, isConnected: true,
}, { get(t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return () => el(); },
     set(t, k, v) { t[k] = v; return true; } });
const winListeners = new Map();
globalThis.window = globalThis;
globalThis.location = { protocol: 'http:', host: 'x', search: '', pathname: '/chat' };
globalThis.history = { replaceState() {}, pushState() {} };
globalThis.addEventListener = (t, f) => winListeners.set(f, t);
globalThis.removeEventListener = (t, f) => winListeners.delete(f);
globalThis.document = { head: el(), body: el(), createElement: () => el(), getElementById: () => el(),
  querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => queueMicrotask(r)); };
const chat = await import(pathToFileURL(chatPath).href);
const live = () => sockets.filter((s) => s.readyState < 2).length;
const out = {};

chat.cleanup(); chat.cleanup();                // safe before any render
await chat.render(el());
out.socketsAfterRender = sockets.length;
sockets[0].open();
chat.cleanup();                                // leave the page
await flush();
out.liveAfterLeave = live();
out.reconnectsAfterLeave = pending(3000);
fire(3000); fire(5000);
out.socketsAfterLeave = sockets.length;        // nothing reopened
out.windowListenersAfterLeave = winListeners.size;
out.intervalsAfterLeave = intervals.size;

await chat.render(el());                       // come back: a fresh connection
out.socketsAfterRemount = sockets.length;
sockets[1].open();
sockets[1].drop();                             // the server drops it: it still reconnects
out.reconnectsAfterDrop = pending(3000);
chat.cleanup();                                // leave while that reconnect is pending
out.reconnectsAfterLeavingDuringRetry = pending(3000);
fire(3000);
await flush();
out.socketsAtEnd = sockets.length;
out.liveAtEnd = live();
console.info(JSON.stringify(out));
"""


# views/chat.js is not a WP5 file (BRIEF process rule 2), so its fix is a
# cross-file request rather than part of this package. Until it lands, the
# tests that depend on it are strict xfails, decided by running chat.js itself:
# once its cleanup() stops reconnecting they run as ordinary tests (and a
# strict xfail that starts passing fails, so the marker cannot go stale).
CHAT_JS_REQUEST = (
    "views/chat.js cleanup() closes its socket with onclose still attached, and "
    "onclose reconnects 3 s later (also from a reconnect timer pending at leave). "
    "Outside WP5's ownership: requested from the integrator (cross-file request)."
)


@functools.lru_cache(maxsize=1)
def _chat_harness_result() -> dict:
    node = _node()
    with tempfile.TemporaryDirectory(prefix="aiui-wp5-chat-") as tmp:
        harness = Path(tmp) / "harness.mjs"
        harness.write_text(_CHAT_HARNESS, encoding="utf-8")
        proc = subprocess.run(
            [node, str(harness), str(VIEWS / "chat.js")],
            capture_output=True,
            text=True,
            timeout=60,
        )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _chat_js_reconnects_after_cleanup() -> bool:
    out = _chat_harness_result()
    return out["reconnectsAfterLeave"] > 0 or out["reconnectsAfterLeavingDuringRetry"] > 0


def _expect_chat_js_leak(request) -> None:
    if _chat_js_reconnects_after_cleanup():
        request.applymarker(pytest.mark.xfail(reason=CHAT_JS_REQUEST, strict=True))


def test_chat_cleanup_does_not_reconnect(request):
    """views/chat.js (the /chat page, and embedded by chat-canvas) closed its
    socket in cleanup() with onclose still attached; onclose then reconnected
    3 s after the page was left, and the new socket lived on forever."""
    _expect_chat_js_leak(request)
    out = _chat_harness_result()
    assert out["socketsAfterRender"] == 1
    assert out["liveAfterLeave"] == 0
    assert out["reconnectsAfterLeave"] == 0
    assert out["socketsAfterLeave"] == 1
    assert out["windowListenersAfterLeave"] == 0
    assert out["intervalsAfterLeave"] == 0
    assert out["socketsAfterRemount"] == 2
    assert out["reconnectsAfterDrop"] == 1  # a real drop still reconnects
    assert out["reconnectsAfterLeavingDuringRetry"] == 0
    assert out["socketsAtEnd"] == 2
    assert out["liveAtEnd"] == 0


# ── Job and schedule rows are escaped ───────────────────────────────

_ROWS_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , modPath, kind] = process.argv;
console.debug = console.warn = () => {};
const HOSTILE = "x');window.__pwned=1;('<img src=x onerror=alert(1)>\"";
const job = { id: HOSTILE, name: '<b>n</b>', message: '<img src=x onerror=alert(2)>',
  prompt: '<script>alert(3)</script>', status: 'running', created_at: 1,
  schedule: { kind: 'cron', cron_expr: '<i>* * *</i>' }, enabled: true };
const section = { attrs: {}, innerHTML: '',
  hasAttribute(k) { return k in this.attrs; }, setAttribute(k, v) { this.attrs[k] = v; } };
const root = { querySelector: (sel) => (sel === '[data-page="' + kind + '"]' ? section : null) };
globalThis.window = globalThis;
globalThis.document = { head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ style: {} }),
  querySelector: (sel) => (sel.startsWith('[data-aiui-') ? section : null), querySelectorAll: () => [],
  getElementById: () => null };
globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push(String(url));
  const body = kind === 'cron' ? { schedules: [job], count: 1 } : { jobs: [job], count: 1, stats: {} };
  return { ok: true, json: async () => body };
};
const mod = (await import(pathToFileURL(modPath).href)).default;
if (mod.init) await mod.init();
mod.onContentChange(root);
for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
mod.stop && mod.stop();
console.info(JSON.stringify({ html: section.innerHTML, calls }));
"""


@pytest.mark.parametrize(("module", "page"), [("jobs.js", "jobs"), ("schedules.js", "cron")])
def test_job_rows_escape_api_fields(module, page, tmp_path):
    """Job ids were spliced into onclick="...('${job.id}')" and names, messages
    and prompts into innerHTML; an id or text from the API could run script."""
    node = _node()
    harness = tmp_path / "harness.mjs"
    harness.write_text(_ROWS_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [node, str(harness), str(PLUGINS / module), page],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    html = out["html"]
    assert "data-job-id=" in html, html[:400]
    assert "<img" not in html and "<script" not in html and "<b>" not in html and "<i>" not in html
    assert "__pwned=1;(" not in html.replace("&#39;", "'").split("data-job-id=")[0]
    # Handlers read the id from the escaped data attribute, never from source.
    handlers = re.findall(r'onclick="([^"]*)"', html)
    assert handlers and all("dataset.jobId" in h or "dataset.sessionId" in h for h in handlers), (
        handlers
    )
    assert not [h for h in handlers if "__pwned" in h], handlers


# ── Theme picker in the React shell ─────────────────────────────────

_PICKER_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , pickerPath, shell] = process.argv;
const store = new Map(Object.entries({
  'aiui-theme-preset': 'rose', 'aiui-theme-mode': 'light', 'aiui-theme-radius': 'md',
  'aiui-theme-preference': 'system',
}));
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};
const props = [];
const listeners = {};
const fakeEl = () => ({ innerHTML: '', dataset: {}, value: '', addEventListener() {}, querySelector: () => null,
  querySelectorAll(sel) {
    if (sel !== '.tp-mode-btn') return [];
    return [{ dataset: { mode: 'dark' }, addEventListener(t, fn) { listeners.mode = fn; } }];
  } });
const pickerRoot = fakeEl();
// The element the page is mounted in; the picker draws into its root.
const host = { ...fakeEl(), isConnected: true,
  querySelector: (sel) => (sel === '#theme-picker-root' ? pickerRoot : null) };
globalThis.document = {
  documentElement: {
    getAttribute: (k) => (k === 'data-aiui-shell' && shell === 'app' ? 'react' : null),
    classList: { contains: () => false },
    style: {
      setProperty: (k, v) => props.push(['set', k, v]),
      removeProperty: (k) => props.push(['remove', k]),
    },
  },
  head: { appendChild() {} },
  createElement: () => ({}),
  getElementById: () => null,
};
const events = [];
globalThis.StorageEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
globalThis.CustomEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
globalThis.window = { dispatchEvent: (e) => events.push({ type: e.type, key: e.key, newValue: e.newValue }) };
const ACCENT = { zinc: '#71717a', rose: '#f43f5e' };
let state = { preset: 'zinc', mode: 'dark', radius: 'md' };
const puts = [];
const snapshot = () => ({ ...state, presets: {}, modes: ['dark', 'light'], radii: ['md'],
  variables: { '--db-bg': state.mode === 'dark' ? '#09090b' : '#fafafa',
               '--db-accent': ACCENT[state.preset], '--db-accent-rgb': '244,63,94', '--db-radius': '10px' } });
globalThis.fetch = async (url, opts = {}) => {
  if (opts.method === 'PUT') { const b = JSON.parse(opts.body); puts.push(b); state = { ...state, ...b }; }
  return { json: async () => snapshot() };
};
const picker = await import(pathToFileURL(pickerPath).href);
await picker.render(host);
const afterRender = { props: props.splice(0), events: events.splice(0), puts: puts.splice(0) };
await listeners.mode();                 // the user picks "dark"
await new Promise((r) => setTimeout(r, 0));
const afterMode = { props: props.splice(0), events: events.splice(0), puts: puts.splice(0),
                    preference: store.get('aiui-theme-preference') };
console.log(JSON.stringify({ afterRender, afterMode }));
"""


def _run_picker(tmp_path, shell: str) -> dict:
    node = _node()
    harness = tmp_path / "harness.mjs"
    harness.write_text(_PICKER_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [node, str(harness), str(VIEWS / "theme-picker.js"), shell],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_theme_picker_in_the_shell_sets_seeds_not_db_vars(tmp_path):
    """Inline --db-* on <html> would beat legacy/bridge.css and the user's CSS
    (WP4 request); in the shell a pick becomes theme seeds instead."""
    out = _run_picker(tmp_path, "app")
    render = out["afterRender"]
    set_keys = [p[1] for p in render["props"] if p[0] == "set"]
    assert [b for b in render["puts"]] == [{"preset": "rose"}]  # saved mode is not forced
    assert not [k for k in set_keys if k.startswith("--db-") and k != "--db-accent-rgb"], set_keys
    assert ["set", "--seed-accent", "#f43f5e"] in render["props"]
    assert ["set", "--accent-mix", "4%"] in render["props"]  # themes.COLOR_PRESET_ACCENT_MIX
    assert ["set", "--radius", "10px"] in render["props"]
    assert render["events"] == []  # the shell's mode is left alone
    mode = out["afterMode"]
    assert mode["puts"] == [{"mode": "dark"}]
    assert mode["preference"] == "dark"
    assert {"type": "storage", "key": "aiui-theme-preference", "newValue": "dark"} in mode["events"]
    assert not [p for p in mode["props"] if p[1].startswith("--db-") and p[1] != "--db-accent-rgb"]


def test_theme_picker_accent_mix_matches_the_seed_themes():
    """The picker repeats themes.COLOR_PRESET_ACCENT_MIX (it runs in the browser)."""
    from praisonaiui import themes

    mix = getattr(themes, "COLOR_PRESET_ACCENT_MIX", None)
    if mix is None:
        pytest.skip("themes.py has no seed themes yet (WP0b)")
    m = re.search(r"const COLOR_ACCENT_MIX = '([^']+)'", _read(VIEWS / "theme-picker.js"))
    assert m and m.group(1) == mix


def test_theme_picker_in_the_legacy_dashboard_is_unchanged(tmp_path):
    out = _run_picker(tmp_path, "dashboard")
    render = out["afterRender"]
    assert render["puts"] == [{"preset": "rose"}, {"mode": "light"}]
    assert ["set", "--db-bg", "#fafafa"] in render["props"]
    assert ["set", "--db-accent", "#f43f5e"] in render["props"]
    assert not [p for p in render["props"] if p[1].startswith("--seed-")]
    assert render["events"] == [] and out["afterMode"]["events"] == []
    assert out["afterMode"]["preference"] == "system"


_PICKER_RACE_HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , pickerPath] = process.argv;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = {
  documentElement: { getAttribute: () => null, classList: { contains: () => false },
                     style: { setProperty() {}, removeProperty() {} } },
  head: { appendChild() {} }, createElement: () => ({}), getElementById: () => null,
};
globalThis.window = { dispatchEvent() {} };
// childList observers, delivered as microtasks; disconnect() drops pending ones.
const observers = new Set();
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; this.target = null; }
  observe(target) { this.target = target; observers.add(this); }
  disconnect() { observers.delete(this); this.target = null; }
};
const notify = (target) => {
  for (const o of [...observers]) {
    if (o.target === target) queueMicrotask(() => { if (o.target === target) o.cb([]); });
  }
};
const makeRoot = () => ({ innerHTML: '', querySelectorAll: () => [], querySelector: () => null });
// A page container: assigning innerHTML replaces its children, root included.
const makeHost = () => {
  const host = { isConnected: true, root: null, html: '' };
  Object.defineProperty(host, 'innerHTML', {
    get: () => host.html,
    set: (v) => { host.html = v; host.root = /id="theme-picker-root"/.test(v) ? makeRoot() : null; notify(host); },
  });
  host.querySelector = (sel) => (sel === '#theme-picker-root' ? host.root : null);
  return host;
};
const NOT_FOUND = '<pre>{"error": "Not Found", "path": "/api/theme-picker"}</pre>';
const STATE = { preset: 'indigo', mode: 'dark', radius: 'md', modes: ['dark', 'light'], radii: ['md'],
  presets: { indigo: { accent: '#6366f1' }, rose: { accent: '#f43f5e' } },
  variables: { '--db-accent': '#6366f1' } };
let gate = null;
globalThis.fetch = async () => { if (gate) await gate; return { json: async () => STATE }; };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r)); };
const painted = (h) => Boolean(h.root && h.root.innerHTML.includes('data-preset="rose"'));
const picker = await import(pathToFileURL(pickerPath).href);
const out = {};

// Direct load: the generic viewer's 404 lands while /api/theme is in flight.
let open; gate = new Promise((r) => { open = r; });
const a = makeHost();
const pA = picker.render(a);
await flush();
a.innerHTML = NOT_FOUND;
await flush();
out.rootBackWhileLoading = Boolean(a.root) && !a.html.includes('Not Found');
gate = null; open();
const releaseA = await pA;
out.paintedAfterEarlyOverwrite = painted(a);
out.releaseIsFunction = typeof releaseA === 'function';

// ...or lands after the picker is painted.
a.innerHTML = NOT_FOUND;
await flush();
out.paintedAfterLateOverwrite = painted(a);

// Released (the page was left): the element is the host's again.
if (typeof releaseA === 'function') releaseA();
a.innerHTML = '<p>next page</p>';
await flush();
out.untouchedAfterRelease = a.root === null && a.html === '<p>next page</p>';

// Left while loading: nothing is drawn into the detached element.
gate = new Promise((r) => { open = r; });
const b = makeHost();
const pB = picker.render(b);
await flush();
b.isConnected = false;
gate = null; open(); await pB;
out.detachedNotPainted = Boolean(b.root) && b.root.innerHTML === '';

// A newer mount owns the picker; the older element is left alone.
const c = makeHost();
const d = makeHost();
await picker.render(c);
await picker.render(d);
c.innerHTML = '<p>reused</p>';
await flush();
out.olderMountLeftAlone = c.root === null && painted(d);

// A writer that keeps clearing the element: bounded, no ping-pong.
const e = makeHost();
await picker.render(e);
let restores = 0;
for (let i = 0; i < 12; i++) { e.innerHTML = '<p>clobber</p>'; await flush(); if (e.root) restores++; }
out.restores = restores;
console.log(JSON.stringify(out));
"""


def test_theme_picker_survives_its_container_being_rewritten(tmp_path):
    """On a direct load of /theme-picker the legacy dashboard starts its generic
    data viewer while the view module is importing; that viewer's late
    ``{"error": "Not Found"}`` replaced the container, the picker's root with
    it, and paint() (which looked the root up by id) then drew nothing. The
    picker now draws into the mounted element and re-creates its root."""
    node = _node()
    harness = tmp_path / "harness.mjs"
    harness.write_text(_PICKER_RACE_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [node, str(harness), str(VIEWS / "theme-picker.js")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["rootBackWhileLoading"], out
    assert out["paintedAfterEarlyOverwrite"], out
    assert out["releaseIsFunction"], out
    assert out["paintedAfterLateOverwrite"], out
    assert out["untouchedAfterRelease"], out
    assert out["detachedNotPainted"], out
    assert out["olderMountLeftAlone"], out
    assert out["restores"] == 5, out  # MAX_REPAINTS


# ── Syntax ───────────────────────────────────────────────────────────


def test_theme_picker_has_one_top_level_render():
    src = _read(VIEWS / "theme-picker.js")
    assert len(re.findall(r"^(?:export )?(?:async )?function render\b", src, re.M)) == 1


@pytest.mark.parametrize("path", TOUCHED, ids=lambda p: str(p.relative_to(PLUGINS)))
def test_touched_files_parse_as_es_modules(path):
    node = _node()
    proc = _esm_check(node, _read(path))
    assert proc.returncode == 0, proc.stderr


def test_esm_check_catches_the_theme_picker_bug():
    """The pre-fix theme-picker declared `render` twice. Plain `node --check`
    accepted it; the module check must not, or the gate above proves nothing."""
    node = _node()
    fixed = _read(VIEWS / "theme-picker.js")
    broken = fixed.replace("function paint(", "function render(").replace("paint();", "render();")
    assert broken != fixed
    proc = _esm_check(node, broken)
    assert proc.returncode != 0
    assert "already been declared" in proc.stderr


# ── Leaks: runtime probe (the gate) ─────────────────────────────────

RUNTIME = os.environ.get("RUN_BROWSER_TESTS") == "1"


# Pages that open resources, plus theme-picker (it must load at all).
PROBE_PAGES = [
    "logs",
    "usage",
    "agents",
    "cron",
    "jobs",
    "code-studio",
    "chat-canvas",
    "chat",
    "theme-picker",
]
# Pages whose module refreshes on an interval while the page is shown.
POLLING = {"usage", "agents", "cron", "jobs"}
# Pages that hold sockets open while shown: (URL path, how many). chat-canvas
# holds the embedded chat's socket and the canvas preview's surface socket.
STREAMING = {
    "logs": ("/api/logs/stream", 1),
    "chat": ("/api/chat/ws", 1),
    "chat-canvas": ("/api/chat/ws", 2),
}
NEUTRAL = "feedback"
ROUNDS = 3
# Resources created by these CDN libraries are vendor-owned, not the page's.
VENDOR = ("monaco-editor", "highlight.min.js", "highlight.js")
# The only vendor resources a visit may leave behind, accepted explicitly
# (owner exemption): module-level singletons that a library creates on its
# first load and keeps for the life of the document. They are not per mount
# (removing them would break the next editor), and v0.3.153 has the same.
# Each may appear at most once in the whole session; anything else a vendor
# leaves behind, or a second copy of one of these, fails the probe.
# (axis, library, signature) -> what it is
VENDOR_SINGLETONS = {
    ("iv", "monaco-editor", "cancelAndSet"): "Monaco's shared interval timer",
    ("win", "monaco-editor", "message ::"): "Monaco's setImmediate message listener",
    ("body", "monaco-editor", "DIV.context-view"): "Monaco's context-menu host",
    ("body", "monaco-editor", "DIV.monaco-aria-container"): "Monaco's screen-reader live region",
    ("win", "highlight", "DOMContentLoaded ::"): "highlight.js's auto-highlight hook",
}
_vendor_seen: Counter = Counter()

INSTRUMENT = r"""
(() => {
  const live = { ws: new Map(), es: new Map(), iv: new Map(), win: new Map(), body: new Map() };
  const stack = () => (new Error().stack || '').split('\n').slice(2, 9).join(' | ');
  const W = window.WebSocket;
  window.WebSocket = class extends W {
    constructor(...a) { super(...a); live.ws.set(this, stack());
      this.addEventListener('close', () => live.ws.delete(this)); }
  };
  const E = window.EventSource;
  window.EventSource = class extends E {
    constructor(...a) { super(...a); live.es.set(this, stack());
      const c = this.close.bind(this); this.close = () => { live.es.delete(this); c(); }; }
  };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { const id = si.apply(window, a); live.iv.set(id, stack()); return id; };
  window.clearInterval = function (id) { live.iv.delete(id); return ci.call(window, id); };
  const ael = window.addEventListener, rel = window.removeEventListener;
  const key = (t, f, o) => t + '|' + (typeof o === 'boolean' ? o : !!(o && o.capture));
  window.addEventListener = function (t, f, o) {
    if (f) { let m = live.win.get(f); if (!m) live.win.set(f, m = new Map());
      const k = key(t, f, o); if (!m.has(k)) m.set(k, t + ' :: ' + stack()); }
    return ael.call(window, t, f, o);
  };
  window.removeEventListener = function (t, f, o) {
    const m = f && live.win.get(f); if (m) { m.delete(key(t, f, o)); if (!m.size) live.win.delete(f); }
    return rel.call(window, t, f, o);
  };
  const tag = (n) => { if (n && n.nodeType === 1 && !live.body.has(n)) live.body.set(n, stack()); };
  for (const name of ['appendChild', 'insertBefore']) {
    const orig = Node.prototype[name];
    Node.prototype[name] = function (n, ...r) { if (this === document.body) tag(n); return orig.call(this, n, ...r); };
  }
  for (const name of ['append', 'prepend']) {
    const orig = Element.prototype[name];
    Element.prototype[name] = function (...n) { if (this === document.body) n.forEach(tag); return orig.apply(this, n); };
  }
  window.__leakSockets = () => live.ws.keys();
  window.__leakSnap = () => {
    const desc = (n) => n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '');
    const body = [...document.body.children].map((n) => desc(n) + ' @ ' + (live.body.get(n) || 'static'));
    const win = []; for (const m of live.win.values()) for (const s of m.values()) win.push(s);
    return { ws: [...live.ws.values()], es: [...live.es.values()], iv: [...live.iv.values()], win, body };
  };
})();
"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def dashboard_url():
    """The legacy dashboard (style 'dashboard') served from this checkout."""
    port = _free_port()
    data_dir = tempfile.mkdtemp(prefix="aiui-wp5-")
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            x for x in (str(ROOT / "src"), os.environ.get("PYTHONPATH", "")) if x
        ),
        "AIUI_DATA_DIR": data_dir,
        "AIUI_DISABLE_PLUGIN_AUTOLOAD": "1",
    }
    for var in ("AUTH_ENFORCE", "AIUI_URL_TOKEN", "GATEWAY_AUTH_TOKEN", "AIUI_SHELL"):
        env.pop(var, None)
    code = (
        "import uvicorn\n"
        "from praisonaiui import server as srv\n"
        "srv.set_style('dashboard')\n"
        f"uvicorn.run(srv.create_app(), host='127.0.0.1', port={port}, log_level='warning')\n"
    )
    proc = subprocess.Popen([sys.executable, "-c", code], env=env, cwd=data_dir)
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 60
        while True:
            try:
                urllib.request.urlopen(url + "/api/pages", timeout=2).read()
                break
            except Exception:
                if proc.poll() is not None or time.time() > deadline:
                    pytest.fail("dashboard server did not start")
                time.sleep(0.3)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


@pytest.fixture(scope="module")
def chromium():
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # no browser available
            pytest.skip(f"no Chromium available: {exc}")
        yield browser
        browser.close()


@pytest.fixture(scope="module")
def browser_page(chromium, dashboard_url):
    ctx = chromium.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(INSTRUMENT)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    page.goto(f"{dashboard_url}/{NEUTRAL}", wait_until="load")
    page.wait_for_function(
        "window.aiui && typeof window.aiui.selectPage === 'function'", timeout=20000
    )
    page.wait_for_timeout(1500)
    yield page, errors
    ctx.close()


def _own(entries: list[str]) -> list[str]:
    """Resources not created by an allow-listed vendor library."""
    return [e for e in entries if not any(v in e for v in VENDOR)]


def _vendor(entries: list[str]) -> list[str]:
    return [e for e in entries if any(v in e for v in VENDOR)]


def _vendor_singleton(axis: str, entry: str):
    for key in VENDOR_SINGLETONS:
        k_axis, lib, signature = key
        if k_axis == axis and lib in entry and signature in entry:
            return key
    return None


def _select(page, page_id: str, wait_ms: int, twice: bool = False) -> None:
    if twice:
        # Select the page again while it is still loading: the first render is
        # superseded and cleaned up late, after the second one has started.
        page.evaluate(
            "id => { window.aiui.selectPage(id); return window.aiui.selectPage(id); }", page_id
        )
    else:
        page.evaluate("id => window.aiui.selectPage(id)", page_id)
    page.wait_for_timeout(wait_ms)


@pytest.mark.skipif(not RUNTIME, reason="runtime probe is opt-in (RUN_BROWSER_TESTS=1)")
@pytest.mark.timeout(300)
class TestRuntimeLeakProbe:
    @pytest.mark.parametrize("page_id", PROBE_PAGES)
    def test_leaving_the_page_releases_everything(self, browser_page, page_id, request):
        if page_id in ("chat", "chat-canvas"):
            _expect_chat_js_leak(request)  # both run views/chat.js's socket
        page, errors = browser_page
        errors.clear()
        _select(page, NEUTRAL, 3500)
        base = page.evaluate("__leakSnap()")
        totals = []
        for rnd in range(1, ROUNDS + 1):
            _select(page, page_id, 2500, twice=rnd == 2)
            shown = page.evaluate(
                """() => { const c = document.querySelector('#db-page-content');
                   return { nodes: c ? c.querySelectorAll('*').length : -1,
                            logs: (document.querySelector('.aiui-logs-status') || {}).textContent || null,
                            picker: !!document.querySelector('#theme-picker-root .tp-section, #theme-picker-root *') } }"""
            )
            assert shown["nodes"] > 0, f"{page_id} round {rnd}: page rendered nothing"
            if page_id == "logs":
                assert (
                    "Connected" in (shown["logs"] or "") and "Disconnected" not in shown["logs"]
                ), f"round {rnd}: a remounted logs page must reconnect, got {shown['logs']!r}"
            if page_id in POLLING:
                live_iv = len(_own(page.evaluate("__leakSnap()")["iv"]))
                assert live_iv > len(_own(base["iv"])), (
                    f"{page_id} round {rnd}: the page's refresh poll is not running"
                )
            if page_id in STREAMING:
                # Also after round 2's double select: a superseded render's late
                # cleanup must not close the socket of the page on screen.
                path, want = STREAMING[page_id]
                open_ws = page.evaluate(
                    "p => [...window.__leakSockets()].filter(s => s.readyState <= 1 && s.url.includes(p)).length",
                    path,
                )
                assert open_ws == want, (
                    f"{page_id} round {rnd}: {open_ws} open {path} sockets, want {want}"
                )
            if page_id == "theme-picker":
                assert shown["picker"], (
                    "theme-picker did not render its picker (module failed to load?)"
                )
            # > 3 s, so a 3 s reconnect scheduled by onclose would show up.
            _select(page, NEUTRAL, 3500)
            after = page.evaluate("__leakSnap()")
            leaked = {
                k: sorted((Counter(_own(after[k])) - Counter(_own(base[k]))).elements())
                for k in after
                if len(_own(after[k])) > len(_own(base[k]))
            }
            assert not leaked, (
                f"{page_id} round {rnd} left resources behind:\n{json.dumps(leaked, indent=1)}"
            )
            vendor_left = {
                k: list((Counter(_vendor(after[k])) - Counter(_vendor(base[k]))).elements())
                for k in after
            }
            if rnd == 1:
                for axis, entries in vendor_left.items():
                    for entry in entries:
                        key = _vendor_singleton(axis, entry)
                        assert key, (
                            f"{page_id}: vendor resource left behind, not an accepted singleton: {entry}"
                        )
                        _vendor_seen[key] += 1
                        assert _vendor_seen[key] == 1, (
                            f"{page_id}: second copy of {VENDOR_SINGLETONS[key]}"
                        )
            totals.append({k: len(after[k]) for k in after})
        assert totals[0] == totals[-1], f"{page_id}: live resources grow across visits: {totals}"
        assert not errors, f"{page_id}: page errors: {errors}"


# ── theme-picker on a direct load (runtime) ──────────────────────────

# Delays one same-origin fetch by path, so the race between the dashboard's
# generic data viewer (GET /api/theme-picker) and the picker's own state
# (GET /api/theme) can be forced either way.
_DELAY_FETCH = r"""
([path, ms]) => {
  const f = window.fetch;
  window.fetch = function (u, o) {
    let p = '';
    try { p = new URL(typeof u === 'string' ? u : u.url, location.href).pathname; } catch (e) {}
    if (p === path) return new Promise((r) => setTimeout(r, ms)).then(() => f.call(this, u, o));
    return f.call(this, u, o);
  };
}
"""
DIRECT_LOADS = 5


@pytest.mark.skipif(not RUNTIME, reason="runtime probe is opt-in (RUN_BROWSER_TESTS=1)")
@pytest.mark.timeout(300)
class TestThemePickerDirectLoad:
    """Loading /theme-picker directly (a reload or a shared link) showed the
    generic viewer's ``{"error": "Not Found"}`` instead of the picker on most
    loads: the dashboard starts that viewer while the view module imports, and
    its response replaced the picker's root."""

    @pytest.mark.parametrize(
        "delayed",
        [None, "/api/theme", "/api/theme-picker"],
        ids=["as-is", "viewer-lands-first", "viewer-lands-last"],
    )
    def test_direct_load_shows_the_picker(self, chromium, dashboard_url, delayed):
        loads = DIRECT_LOADS if delayed is None else 2
        seen = []
        for i in range(loads):
            ctx = chromium.new_context(viewport={"width": 1280, "height": 800})
            if delayed:
                ctx.add_init_script(
                    "(" + _DELAY_FETCH.strip() + ")(" + json.dumps([delayed, 1500]) + ")"
                )
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)[:300]))
            try:
                page.goto(f"{dashboard_url}/theme-picker", wait_until="load")
                # Past the delayed response, so a late overwrite would show.
                page.wait_for_timeout(4000 if delayed else 2500)
                got = page.evaluate(
                    """() => { const c = document.querySelector('#db-page-content');
                       return { swatches: document.querySelectorAll('#theme-picker-root .tp-swatch').length,
                                notFound: !!c && c.textContent.includes('Not Found') } }"""
                )
            finally:
                ctx.close()
            seen.append(got)
            assert not errors, f"load {i}: page errors: {errors}"
        assert all(g["swatches"] > 0 and not g["notFound"] for g in seen), seen
