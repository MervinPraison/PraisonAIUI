"""Light / dark mode of the default dashboard style (``plugins/dashboard.js``).

Regressions:

* a light pick was lost on reload: the dashboard always started dark. The
  viewer's choice (``aiui-theme-preference``, the key the app shell and the
  server's bootstrap script share) now decides, then the app's default
  (``site.themeDefault`` in /ui-config.json, else ``site.theme``), then the
  OS scheme;
* ``aiui.set_theme()`` / ``set_theme(dark_mode=True)`` sends exactly the
  theme the server fills in when nothing is set, and the dashboard took it
  for "no choice": a dark app turned light on a light OS. The theme's values
  are now taken as sent; only the server's ``themeDefault`` can say
  ``system``;
* the mode is on ``<html>`` before the dashboard's stylesheet goes in, so
  the first frame is already in a mode (dark until the config answers, so a
  dark app never shows a light frame);
* light mode came from inline ``!important`` variables for a handful of
  colours, so the plugin tier ``--db-p-*`` (log panel, form fields) stayed
  dark. It is now a stylesheet keyed on ``html[data-db-mode="light"]``.

The harness imports a copy of dashboard.js with an extra export list (the
functions are internal) into a small fake DOM.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_JS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "dashboard.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

_HARNESS = r"""
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const [, , dashPath, inputPath] = process.argv;
const input = JSON.parse(readFileSync(inputPath, 'utf8'));

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.id = ''; this.textContent = ''; this.innerHTML = '';
    this.style = { setProperty() {}, removeProperty() {} };
    this.classes = new Set();
    const self = this;
    this.classList = {
      add: (c) => self.classes.add(c), remove: (c) => self.classes.delete(c),
      toggle: (c, on) => { const v = on ?? !self.classes.has(c); if (v) self.classes.add(c); else self.classes.delete(c); return v; },
      contains: (c) => self.classes.has(c),
    };
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c) { return this.appendChild(c); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; }
  remove() {}
}
const html = new El('html');
const head = new El('head');
const body = new El('body');
globalThis.window = globalThis;
globalThis.document = {
  documentElement: html, head, body,
  createElement: (t) => new El(t),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
const target = new EventTarget();
window.addEventListener = (t, f, o) => target.addEventListener(t, f, o);
window.removeEventListener = (t, f, o) => target.removeEventListener(t, f, o);
window.dispatchEvent = (e) => target.dispatchEvent(e);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: '', pathname: '/', hash: '', href: 'http://aiui.test/', origin: 'http://aiui.test' };
globalThis.history = { pushState() {}, replaceState() {} };
let osDark = false;
const mqListeners = [];
globalThis.matchMedia = () => ({
  get matches() { return osDark; },
  addEventListener: (t, f) => mqListeners.push(f), removeEventListener() {},
});
globalThis.EventSource = class { close() {} };
let uiConfig = {};
globalThis.fetch = async (url) => {
  const path = new URL(String(url && url.url ? url.url : url), 'http://aiui.test/').pathname;
  if (path === '/ui-config.json') return { ok: true, status: 200, json: async () => uiConfig };
  return { ok: false, status: 404, json: async () => ({}) };
};

const src = await import(pathToFileURL(dashPath).href);
const mode = () => ({ attr: html.getAttribute('data-db-mode'), dark: html.classes.has('dark') });
const reset = (pref, dark) => {
  store.clear(); if (pref) store.set('aiui-theme-preference', pref);
  osDark = dark;
};
const out = {};

// init() first, as on a fresh page load: the mode is on <html> before the
// dashboard's styles are added, and a stored choice or OS change made later
// is followed.
reset(null, false);
uiConfig = input.initConfig;
const seen = [];
const realAppend = head.appendChild.bind(head);
head.appendChild = (c) => { if (c.tagName === 'STYLE') seen.push({ id: c.id, attr: html.getAttribute('data-db-mode'), text: c.textContent.slice(0, 200) }); return realAppend(c); };
html.attributes = {}; html.classes.clear();
await src.init();
out.firstStyles = seen.slice(0, 2).map((s) => ({ id: s.id, attr: s.attr, light: s.text.includes('data-db-mode="light"') }));
out.afterInit = mode();
store.set('aiui-theme-preference', 'dark');
window.dispatchEvent(Object.assign(new Event('storage'), { key: 'aiui-theme-preference' }));
out.afterStoragePick = mode();
store.delete('aiui-theme-preference');
osDark = true; mqListeners.forEach((f) => f());
out.afterOsChange = mode();

// Resolution order: stored choice > app default > OS.
const cases = {};
for (const [name, pref, dark, site] of input.cases) {
  reset(pref, dark);
  await src.applyThemeFromConfig({ site });
  cases[name] = mode();
}
out.cases = cases;
console.log(JSON.stringify(out));
"""


#: The theme server.py sends when nothing sets one, and also exactly what
#: ``aiui.set_theme()`` with its defaults stores.
FILL_IN = {"preset": "zinc", "darkMode": True, "radius": "md"}

# name, stored choice, OS dark, the `site` part of /ui-config.json
CASES = [
    ["os-light", None, False, {}],
    ["os-dark", None, True, {}],
    ["pref-light-os-dark", "light", True, {}],
    ["pref-dark-os-light", "dark", False, {}],
    ["pref-system-os-dark", "system", True, {}],
    # A server without `themeDefault`: the theme is taken as sent.
    ["set-theme-defaults-os-light", None, False, {"theme": FILL_IN}],
    ["app-dark-os-light", None, False, {"theme": {**FILL_IN, "preset": "blue"}}],
    ["app-light-os-dark", None, True, {"theme": {**FILL_IN, "darkMode": False}}],
    ["app-light-pref-dark", "dark", False, {"theme": {**FILL_IN, "darkMode": False}}],
    ["yaml-system-os-dark", None, True, {"theme": {"preset": "blue", "darkMode": False, "mode": "system"}}],
    ["yaml-light-os-dark", None, True, {"theme": {"mode": "light"}}],
    # The server's own answer wins over the theme's values.
    ["server-system-os-light", None, False, {"themeDefault": "system", "theme": FILL_IN}],
    ["server-system-os-dark", None, True, {"themeDefault": "system", "theme": FILL_IN}],
    ["server-dark-os-light", None, False, {"themeDefault": "dark", "theme": FILL_IN}],
    ["server-light-os-dark", None, True, {"themeDefault": "light", "theme": FILL_IN}],
    ["server-dark-pref-light", "light", False, {"themeDefault": "dark", "theme": FILL_IN}],
    ["server-bogus-os-light", None, False, {"themeDefault": "sepia", "theme": FILL_IN}],
]

#: set_theme() calls whose /ui-config.json the dashboard reads, from a real app
#: (None: the app never calls set_theme()).
LIVE = {
    "live-no-theme-os-light": (None, False),
    "live-no-theme-os-dark": (None, True),
    "live-set-theme-os-light": ({}, False),
    "live-set-theme-dark-os-light": ({"dark_mode": True}, False),
    "live-set-theme-light-os-dark": ({"dark_mode": False}, True),
    # set_theme(dark_mode=None): a preset and radius, the mode left open.
    "live-set-theme-no-mode-os-light": ({"preset": "blue", "dark_mode": None}, False),
    "live-set-theme-no-mode-os-dark": ({"preset": "blue", "dark_mode": None}, True),
}


def _live_site(tmp, theme_kwargs: dict | None) -> dict:
    from starlette.testclient import TestClient

    from praisonaiui import config_store
    from praisonaiui import server as srv

    with pytest.MonkeyPatch.context() as mp:
        data = tmp / f"data-{len(list(tmp.iterdir()))}"
        data.mkdir()
        mp.setenv("AIUI_DATA_DIR", str(data))
        mp.setattr(config_store, "_config_store", None)
        config_store.init_config_store(data / "config.yaml")
        srv.reset_state()
        try:
            srv.set_style("dashboard")
            if theme_kwargs is not None:
                srv.set_theme(**theme_kwargs)
            return TestClient(srv.create_app()).get("/ui-config.json").json()["site"]
        finally:
            srv.reset_state()


@pytest.fixture(scope="module")
def run(tmp_path_factory) -> dict:
    tmp = tmp_path_factory.mktemp("mode")
    copy = tmp / "dashboard.js"
    copy.write_text(
        DASHBOARD_JS.read_text(encoding="utf-8")
        + "\nexport { applyThemeFromConfig, applyColorMode };\n",
        encoding="utf-8",
    )
    (tmp / "harness.mjs").write_text(_HARNESS, encoding="utf-8")
    live_dir = tmp_path_factory.mktemp("live")
    live = [
        [name, None, os_dark, _live_site(live_dir, kwargs)]
        for name, (kwargs, os_dark) in LIVE.items()
    ]
    inputs = {
        "cases": CASES + live,
        # No stored choice, a light OS, an app that chose nothing.
        "initConfig": {"site": {"themeDefault": "system", "theme": FILL_IN}},
    }
    (tmp / "input.json").write_text(json.dumps(inputs), encoding="utf-8")
    proc = subprocess.run(
        [NODE, str(tmp / "harness.mjs"), str(copy), str(tmp / "input.json")],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


LIGHT = {"attr": "light", "dark": False}
DARK = {"attr": "dark", "dark": True}


@pytest.mark.parametrize(
    "case, expected",
    [
        ("os-light", LIGHT),
        ("os-dark", DARK),
        ("pref-light-os-dark", LIGHT),
        ("pref-dark-os-light", DARK),
        ("pref-system-os-dark", DARK),
        # set_theme()'s defaults ask for dark, even though they equal the
        # server's fill-in theme (R7: set_theme keeps its behaviour).
        ("set-theme-defaults-os-light", DARK),
        ("app-dark-os-light", DARK),
        ("app-light-os-dark", LIGHT),
        # The viewer's choice beats the app default.
        ("app-light-pref-dark", DARK),
        ("yaml-system-os-dark", DARK),
        ("yaml-light-os-dark", LIGHT),
        # themeDefault: 'system' (the app chose nothing) follows the OS.
        ("server-system-os-light", LIGHT),
        ("server-system-os-dark", DARK),
        ("server-dark-os-light", DARK),
        ("server-light-os-dark", LIGHT),
        ("server-dark-pref-light", LIGHT),
        # An unknown value is ignored; the theme decides.
        ("server-bogus-os-light", DARK),
        # A real app: set_theme() / set_theme(dark_mode=True) is dark on a
        # light OS, set_theme(dark_mode=False) is light on a dark one.
        # An app that never calls set_theme() follows the OS: the server
        # sends themeDefault 'system' (it used to send only the dark fill-in).
        ("live-no-theme-os-light", LIGHT),
        ("live-no-theme-os-dark", DARK),
        ("live-set-theme-os-light", DARK),
        ("live-set-theme-dark-os-light", DARK),
        ("live-set-theme-light-os-dark", LIGHT),
        ("live-set-theme-no-mode-os-light", LIGHT),
        ("live-set-theme-no-mode-os-dark", DARK),
    ],
)
def test_resolution_order(run, case, expected):
    assert run["cases"][case] == expected


def test_mode_is_set_before_the_dashboard_styles(run):
    first, light = run["firstStyles"]
    # Already resolved when DASHBOARD_STYLE goes in: dark until /ui-config.json
    # answers (the historical default; a dark app shows no light frame).
    assert first["attr"] == "dark"
    assert light == {"id": "aiui-dashboard-light", "attr": "dark", "light": True}
    # The app chose nothing (themeDefault: system) and the OS is light.
    assert run["afterInit"] == LIGHT


def test_follows_a_stored_pick_and_the_os(run):
    assert run["afterStoragePick"] == DARK
    # No stored choice, an app that chose nothing: the OS turning dark wins.
    assert run["afterOsChange"] == DARK


def test_ui_config_reports_the_app_default_mode(tmp_path):
    """/ui-config.json says which mode the app chose, so the dashboard need
    not guess it from the theme's values."""
    assert _live_site(tmp_path, None)["themeDefault"] == "system"
    assert _live_site(tmp_path, None)["theme"]["mode"] == "system"
    assert _live_site(tmp_path, {})["themeDefault"] == "dark"
    light = _live_site(tmp_path, {"dark_mode": False})
    assert light["themeDefault"] == "light"
    assert light["theme"] == {"preset": "zinc", "darkMode": False, "radius": "md", "mode": "light"}
    # set_theme(dark_mode=None) sets the preset and radius only.
    open_mode = _live_site(tmp_path, {"preset": "blue", "radius": "lg", "dark_mode": None})
    assert open_mode["themeDefault"] == "system"
    assert open_mode["theme"] == {"preset": "blue", "radius": "lg", "mode": "system"}


def test_no_value_guessing():
    """The dashboard once read the fill-in theme's exact values as "no
    choice", which also matched set_theme()'s defaults."""
    src = DASHBOARD_JS.read_text(encoding="utf-8")
    assert "_isServerDefaultTheme" not in src


def test_no_inline_light_variables_remain():
    """The old darkMode=false branch inlined light colours with !important,
    beating the viewer's choice and user CSS."""
    src = DASHBOARD_JS.read_text(encoding="utf-8")
    body = src.split("async function applyThemeFromConfig(cfg) {", 1)[1].split("\n}\n", 1)[0]
    assert "--db-bg" not in body
    assert "document.body.style.background" not in body
