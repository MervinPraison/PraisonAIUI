"""Light / dark mode of the default dashboard style (``plugins/dashboard.js``).

Regressions:

* a light pick was lost on reload: the dashboard always started dark. The
  viewer's choice (``aiui-theme-preference``, the key the app shell and the
  server's bootstrap script share) now decides, then the app's default
  (``site.theme`` in /ui-config.json), then the OS scheme;
* the mode is on ``<html>`` before the dashboard's stylesheet goes in, so
  the first frame is already in the right mode;
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
const [, , dashPath] = process.argv;

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

// Resolution order: stored choice > app default > OS.
const cases = {};
for (const [name, pref, dark, theme] of [
  ['os-light', null, false, undefined],
  ['os-dark', null, true, undefined],
  ['pref-light-os-dark', 'light', true, undefined],
  ['pref-dark-os-light', 'dark', false, undefined],
  ['pref-system-os-dark', 'system', true, undefined],
  ['server-default-os-light', null, false, { preset: 'zinc', darkMode: true, radius: 'md' }],
  ['app-dark-os-light', null, false, { preset: 'blue', darkMode: true, radius: 'md' }],
  ['app-light-os-dark', null, true, { preset: 'zinc', darkMode: false, radius: 'md' }],
  ['app-light-pref-dark', 'dark', false, { preset: 'zinc', darkMode: false, radius: 'md' }],
  ['yaml-system-os-dark', null, true, { preset: 'blue', darkMode: false, mode: 'system' }],
  ['yaml-light-os-dark', null, true, { mode: 'light' }],
]) {
  reset(pref, dark);
  await src.applyThemeFromConfig({ site: theme ? { theme } : {} });
  if (!theme) src.applyColorMode();
  cases[name] = mode();
}
out.cases = cases;

// init(): the mode is on <html> before the dashboard's styles are added, and
// a stored choice or OS change made later is followed.
reset(null, false);
uiConfig = { site: { theme: { preset: 'zinc', darkMode: true, radius: 'md' } } };
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
console.log(JSON.stringify(out));
"""


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
    proc = subprocess.run(
        [NODE, str(tmp / "harness.mjs"), str(copy)],
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
        # The server's fill-in theme is not an app choice: the OS decides.
        ("server-default-os-light", LIGHT),
        ("app-dark-os-light", DARK),
        ("app-light-os-dark", LIGHT),
        # The viewer's choice beats the app default.
        ("app-light-pref-dark", DARK),
        ("yaml-system-os-dark", DARK),
        ("yaml-light-os-dark", LIGHT),
    ],
)
def test_resolution_order(run, case, expected):
    assert run["cases"][case] == expected


def test_mode_is_set_before_the_dashboard_styles(run):
    first, light = run["firstStyles"]
    assert first["attr"] == "light"  # already resolved when DASHBOARD_STYLE goes in
    assert light == {"id": "aiui-dashboard-light", "attr": "light", "light": True}
    assert run["afterInit"] == LIGHT


def test_follows_a_stored_pick_and_the_os(run):
    assert run["afterStoragePick"] == DARK
    # No stored choice, server default theme: the OS turning dark wins.
    assert run["afterOsChange"] == DARK


def test_no_inline_light_variables_remain():
    """The old darkMode=false branch inlined light colours with !important,
    beating the viewer's choice and user CSS."""
    src = DASHBOARD_JS.read_text(encoding="utf-8")
    body = src.split("async function applyThemeFromConfig(cfg) {", 1)[1].split("\n}\n", 1)[0]
    assert "--db-bg" not in body
    assert "document.body.style.background" not in body
