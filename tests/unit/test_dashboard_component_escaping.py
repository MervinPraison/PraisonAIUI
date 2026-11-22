"""Server-driven components of the default dashboard escape their text (R9).

Regression: ``renderAlert``, ``renderCallout``, ``renderMetric`` (and so
``stat_group``), ``renderSpinnerComponent`` and ``renderAvatar`` in
``plugins/dashboard.js`` put component fields into ``innerHTML`` as they
came, so an ``@aiui.page`` that echoed user or agent text into an alert or a
stat ran that text as markup.

The harness imports a copy of dashboard.js that also exports
``renderComponent`` into a small fake DOM and renders each component with a
markup payload.
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

PAYLOAD = '<img src=x onerror="alert(1)">'

_HARNESS = r"""
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const [, , dashPath, inputPath] = process.argv;
const comps = JSON.parse(readFileSync(inputPath, 'utf8'));
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attributes = {};
    this.dataset = {}; this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = ''; this.innerHTML = ''; this.className = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c) { return this.appendChild(c); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; }
  remove() {}
}
globalThis.window = globalThis;
globalThis.document = {
  documentElement: new El('html'), head: new El('head'), body: new El('body'),
  createElement: (t) => new El(t), createTextNode: (t) => ({ textContent: String(t) }),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
window.addEventListener = () => {}; window.removeEventListener = () => {}; window.dispatchEvent = () => true;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '', pathname: '/', hash: '', href: 'http://aiui.test/', origin: 'http://aiui.test' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.EventSource = class { close() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { renderComponent } = await import(pathToFileURL(dashPath).href);
const html = (el) => [el.innerHTML, ...el.children.map(html)].join('');
const out = {};
for (const [name, comp] of Object.entries(comps)) out[name] = html(renderComponent(comp));
console.log(JSON.stringify(out));
"""

COMPONENTS = {
    "alert": {"type": "alert", "title": PAYLOAD, "message": PAYLOAD},
    "callout": {"type": "callout", "title": PAYLOAD, "content": PAYLOAD},
    "metric": {"type": "metric", "label": PAYLOAD, "value": PAYLOAD, "delta": "+" + PAYLOAD},
    "metric_caption": {"type": "metric", "label": PAYLOAD, "value": 1, "caption": PAYLOAD},
    "stat_group": {"type": "stat_group", "stats": [{"label": PAYLOAD, "value": PAYLOAD}]},
    "spinner": {"type": "spinner", "text": PAYLOAD},
    "avatar": {"type": "avatar", "src": '/a.png" onerror="alert(1)', "name": PAYLOAD},
}


@pytest.fixture(scope="module")
def rendered(tmp_path_factory) -> dict:
    tmp = tmp_path_factory.mktemp("escape")
    copy = tmp / "dashboard.js"
    copy.write_text(
        DASHBOARD_JS.read_text(encoding="utf-8") + "\nexport { renderComponent };\n",
        encoding="utf-8",
    )
    (tmp / "harness.mjs").write_text(_HARNESS, encoding="utf-8")
    (tmp / "input.json").write_text(json.dumps(COMPONENTS), encoding="utf-8")
    proc = subprocess.run(
        [NODE, str(tmp / "harness.mjs"), str(copy), str(tmp / "input.json")],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=tmp,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("name", sorted(COMPONENTS))
def test_component_text_is_escaped(rendered, name):
    out = rendered[name]
    assert "<img src=x" not in out
    assert 'onerror="alert' not in out
    assert "&lt;img" in out or "&quot;" in out


def test_text_still_shows(rendered):
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in rendered["alert"]
    assert 'src="/a.png&quot; onerror=&quot;alert(1)"' in rendered["avatar"]
