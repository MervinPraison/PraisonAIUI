"""Legacy views escape API data before it reaches innerHTML (ARCHITECTURE R9).

The Knowledge, Guardrails, Traces, Security and Telemetry views render records
that users, agents or uploads control (file names, guardrail descriptions,
violation messages, span names, agent ids). Each view runs here under node with
a stub DOM, its fetches answered with records whose every string field holds
markup. The markup must arrive escaped, in element text and in quoted
attributes, in both the dashboard and the app-shell mode.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "views"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

# Breaks out of a quoted attribute and opens an element if left unescaped.
MARK = "\"'><img data-xss=1>"

# Records per endpoint; every string field holds MARK.
FIXTURES = {
    "/api/knowledge/status": {"total": 1, "files": 1, "backend": MARK, "status": MARK},
    "/api/knowledge": {
        "entries": [
            {
                "id": MARK,
                "text": MARK,
                "created_at": 1,
                "metadata": {"source": MARK, "filename": MARK},
            }
        ]
    },
    "/api/guardrails/status": {"active_guardrails": 1, "total_violations": 1},
    "/api/guardrails": {
        "guardrails": [
            {
                "id": MARK,
                "description": MARK,
                "agent_name": MARK,
                "type": MARK,
                "guardrail": MARK,
                "source": MARK,
            }
        ]
    },
    "/api/guardrails/violations": {
        "violations": [
            {"timestamp": 1, "agent_id": MARK, "guardrail": MARK, "level": MARK, "message": MARK}
        ]
    },
    "/api/traces/status": {"total_traces": 1, "total_spans": 1, "status": "ok"},
    "/api/traces": {
        "traces": [
            {"id": MARK, "agent_id": MARK, "name": MARK, "status": MARK, "duration_ms": MARK}
        ]
    },
    "/api/traces/spans": {
        "spans": [
            {
                "timestamp": 1,
                "agent_id": MARK,
                "name": MARK,
                "kind": MARK,
                "duration_ms": MARK,
                "status": MARK,
            }
        ]
    },
    "/api/security/status": {"audit_entries": 1},
    "/api/security": {
        "config": {},
        "agent_security": [{"name": MARK, "tool_count": MARK}],
    },
    "/api/security/audit": {
        "entries": [
            {
                "timestamp": 1,
                "event_type": MARK,
                "agent_id": MARK,
                "severity": MARK,
                "data": {"k": MARK},
            }
        ]
    },
    "/api/telemetry/status": {},
    "/api/telemetry": {
        "by_agent": {MARK: {"calls": 1, "avg_latency_ms": 1, "total_tokens": 1}}
    },
    "/api/telemetry/metrics": {
        "metrics": [
            {
                "timestamp": 1,
                "agent_id": MARK,
                "type": MARK,
                "model": MARK,
                "latency_ms": MARK,
                "tokens": MARK,
            }
        ]
    },
}

# A stub DOM: every element records the HTML assigned to it.
HARNESS = r"""
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
const [, , viewPath, mode, fixturesJson, pluginsDir] = process.argv;
// Views import '/plugins/...' (the server path); map it to the source folder.
const base = pathToFileURL(pluginsDir + '/').href;
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) {
     return next(s.startsWith('/plugins/') ? ${JSON.stringify(base)} + s.slice(9) : s, c);
   }`));
const fixtures = JSON.parse(fixturesJson);
const written = [];
const el = () => {
  let html = '';
  const node = {
    style: {}, dataset: {}, value: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {},
    remove() {}, focus() {}, click() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => el(), querySelectorAll: () => [],
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); written.push(html); },
  };
  return node;
};
globalThis.window = globalThis;
globalThis.location = { pathname: '/', search: '', hash: '' };
globalThis.addEventListener = () => {};
globalThis.document = {
  documentElement: { getAttribute: (n) => (mode === 'shell' && n === 'data-aiui-shell' ? 'react' : null) },
  head: el(), body: el(),
  createElement: () => el(),
  getElementById: (id) => (id === 'knowledge-view-styles' ? null : el()),
  querySelector: () => el(), querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  const body = fixtures[path] ?? {};
  return { ok: true, status: 200, json: async () => body };
};
const view = await import(pathToFileURL(viewPath).href);
await view.render(el());
await new Promise((r) => setTimeout(r, 50));
console.log(JSON.stringify(written.join('\n')));
"""

VIEW_FILES = ["knowledge.js", "guardrails.js", "traces.js", "security.js", "telemetry.js"]


def _render(tmp_path: Path, view: str, mode: str) -> str:
    script = tmp_path / "harness.mjs"
    script.write_text(HARNESS)
    res = subprocess.run(
        [NODE, str(script), str(VIEWS / view), mode, json.dumps(FIXTURES), str(VIEWS.parent)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


@pytest.mark.parametrize("mode", ["dashboard", "shell"])
@pytest.mark.parametrize("view", VIEW_FILES)
def test_view_escapes_api_data(tmp_path, view, mode):
    html = _render(tmp_path, view, mode)
    assert "&lt;img data-xss=1&gt;" in html, f"{view}: the hostile record was not rendered"
    assert "<img" not in html, f"{view} ({mode}): API data reached innerHTML unescaped"
    # Quotes are escaped too, so a value cannot leave a quoted attribute.
    assert "\"'>" not in html, f"{view} ({mode}): a quote in API data was not escaped"


def test_esc_escapes_quotes(tmp_path):
    script = tmp_path / "esc.mjs"
    script.write_text(
        "import { pathToFileURL } from 'node:url';\n"
        "const h = await import(pathToFileURL(process.argv[2]).href);\n"
        "console.log(JSON.stringify([h.esc(`a\"b'c<d>&`), h.esc(null), h.esc(0)]));\n"
    )
    res = subprocess.run(
        [NODE, str(script), str(VIEWS / "_helpers.js")], capture_output=True, text=True, timeout=30
    )
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == ["a&quot;b&#39;c&lt;d&gt;&amp;", "", "0"]
