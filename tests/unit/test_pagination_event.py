"""Pagination exposes a page-change event to the host (issue #337)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from praisonaiui.ui import pagination

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src/praisonaiui/templates/frontend/plugins/dashboard.js"
)


def test_helper_id_optional():
    assert "id" not in pagination(total=10)
    assert pagination(total=10, id="users")["id"] == "users"


def _render_pagination_src() -> str:
    src = DASHBOARD_JS.read_text()
    m = re.search(r"function renderPagination\(comp\) \{.*?\n\}\n", src, re.S)
    assert m
    return m.group(0)


# Minimal DOM shim so the renderer runs under plain Node.
_HARNESS = r"""
class CustomEvent { constructor(t, o) { this.type = t; this.detail = o.detail; this.bubbles = o.bubbles; } }
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {};
    this.listeners = {}; this.disabled = false; this.textContent = '';
    const cls = new Set(); this.classList = { add: c => cls.add(c), has: c => cls.has(c) }; this.style = {}; }
  set innerHTML(v) { this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  dispatchEvent(e) { (this.listeners[e.type] || []).forEach(f => f(e)); }
  click() { if (!this.disabled) (this.listeners.click || []).forEach(f => f()); }
}
const document = { createElement: t => new El(t) };
__SRC__
const out = {};
function mk(comp) {
  const el = renderPagination(comp); const events = [];
  el.addEventListener('aiui:pagination', e => events.push(e.detail));
  const btn = l => el.children.find(c => c.attrs && c.attrs['aria-label'] === l);
  const active = () => el.children.find(c => c.attrs && c.attrs['aria-current'] === 'page').textContent;
  return { el, events, btn, active };
}
// next / prev / numbered, exactly once each
let a = mk({ total: 30, page: 1, per_page: 10, id: 'a' });
let b = mk({ total: 30, page: 1, per_page: 10, id: 'b' });
a.btn('Previous page').click();            // disabled at bound
a.btn('Next page').click();
a.btn('Page 3').click();
a.btn('Next page').click();                // disabled at bound
a.btn('Page 3').click();                   // same page: no event
a.btn('Previous page').click();
out.a = a.events; out.aActive = a.active(); out.b = b.events; out.bActive = b.active();
out.tag = a.el.tag; out.label = a.el.attrs['aria-label'];
// clamping
out.clampHigh = mk({ total: 25, page: 99, per_page: 10 }).active();
out.clampLow = mk({ total: 0, page: 0, per_page: 0 }).active();
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_pagination_dispatches_page_change(tmp_path):
    script = tmp_path / "h.js"
    script.write_text(_HARNESS.replace("__SRC__", _render_pagination_src()))
    res = subprocess.run(["node", str(script)], capture_output=True, text=True, check=True)
    out = json.loads(res.stdout)
    d = {"per_page": 10, "total": 30}
    assert out["a"] == [
        {"id": "a", "page": 2, **d},
        {"id": "a", "page": 3, **d},
        {"id": "a", "page": 2, **d},
    ]
    assert out["aActive"] == "2"
    assert out["b"] == [] and out["bActive"] == "1"
    assert out["tag"] == "nav" and out["label"] == "Pagination"
    assert out["clampHigh"] == "3"
    assert out["clampLow"] == "1"
