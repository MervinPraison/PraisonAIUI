"""Legacy views: shell-only polish leaves the dashboard untouched (ARCHITECTURE R6).

The vanilla views run in both the default ``dashboard`` style and the React app
shell (``style: app``). Shell-only polish (icons instead of emoji, one empty
state, theme-coloured chips) branches on one switch, ``inAppShell()`` in
``plugins/views/_helpers.js``, which reads ``<html data-aiui-shell="react">``
(set only by the app-shell HTML). These tests run the helpers under node with
a stub DOM in both modes:

- dashboard mode must produce exactly the markup ``origin/main`` produced
  (``fixtures/legacy_helpers_dashboard.json`` was generated from it);
- shell mode must paint no emoji and no hard-coded colour.
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
HELPERS = PLUGINS / "views" / "_helpers.js"
FIXTURE = Path(__file__).parent / "fixtures" / "legacy_helpers_dashboard.json"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

# Runs a fixed set of helper calls and prints {case: markup} as JSON.
HARNESS = r"""
import { pathToFileURL } from 'node:url';
const [, , helpersPath, mode] = process.argv;
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
globalThis.document = {
  documentElement: { getAttribute: (n) => (mode === 'shell' && n === 'data-aiui-shell' ? 'react' : null) },
  createElement: () => { let t = ''; return { set textContent(v) { t = v; }, get innerHTML() { return escText(t); } }; },
};
const h = await import(pathToFileURL(helpersPath).href);
const out = {
  helpBanner: h.helpBanner({ title: 'Run Flight Recorder', what: 'What it does.', howToUse: 'Steps.', tip: 'A tip.' }),
  helpBannerCollapsed: h.helpBanner({ title: 'Traces', what: 'w', howToUse: 'h', collapsed: true }),
  emptyFull: h.emptyState({ icon: '📭', title: 'No sessions', body: 'Send a chat message <now>.', actionHtml: '<button type="button">Go</button>' }),
  emptyBare: h.emptyState({ title: 'Select a timeline row' }),
  traceDown: h.traceStatusBadge({ gateway_connected: false }),
  traceOff: h.traceStatusBadge({}),
  traceOn: h.traceStatusBadge({ trace_available: true }),
  costZero: h.formatCost(0),
  costSmall: h.formatCost(0.0042),
  costBig: h.formatCost(12.5),
};
for (const type of ['message', 'tool', 'llm', 'error', 'approval', 'system', 'trace_start', 'unknown']) {
  out['timeline_' + type] = h.timelineRow({ type, id: 'e1', label: 'Row <b>', duration_ms: 1500 });
}
if (h.inAppShell) {
  out.inAppShell = String(h.inAppShell());
  // Every emoji a view passes to emptyState() (approvals.js, run-recorder.js).
  out.emptyIcons = ['📭', '🕳️', '🛫', '✅', '⚠️'].map((icon) => h.emptyState({ icon, title: 't' })).join('|');
}
console.log(JSON.stringify(out));
"""

EMOJI = re.compile(
    "[\U0001f300-\U0001faff☀-➿⬀-⯿\U0001f000-\U0001f2ffℹ⌚-⏿]"
)
HEX = re.compile(r"(?<![\w&])#[0-9a-fA-F]{3,8}\b")
RGB = re.compile(r"\brgba?\(")


def _run(tmp_path: Path, mode: str, helpers: Path = HELPERS) -> dict:
    script = tmp_path / "harness.mjs"
    script.write_text(HARNESS)
    res = subprocess.run(
        [NODE, str(script), str(helpers), mode], capture_output=True, text=True, timeout=30
    )
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_dashboard_mode_markup_is_unchanged(tmp_path):
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    got = _run(tmp_path, "dashboard")
    assert got.pop("inAppShell") == "false"
    assert got.pop("emptyIcons").count("<svg") == 0
    assert got == expected


def test_shell_mode_paints_no_emoji_and_no_hard_coded_colour(tmp_path):
    got = _run(tmp_path, "shell")
    assert got.pop("inAppShell") == "true"
    assert got["helpBanner"] == "" and got["helpBannerCollapsed"] == ""
    assert got["costZero"] == "$0.00"
    for case, markup in got.items():
        assert not EMOJI.search(markup), f"{case}: emoji in shell markup: {markup[:120]}"
        assert not HEX.search(markup), f"{case}: hex colour in shell markup"
        assert not RGB.search(markup), f"{case}: rgb() colour in shell markup"
    # One empty state: icon tile, sentence-case title, escaped body, the action.
    empty = got["emptyFull"]
    assert "<svg" in empty and "<h3" in empty and "No sessions" in empty
    assert "&lt;now&gt;" in empty and '<button type="button">Go</button>' in empty
    icons = got["emptyIcons"].split("|")
    assert all("<svg" in m for m in icons)
    assert len(set(icons)) == 4, "each view emoji maps to its own icon (📭 and 🕳️ share inbox)"


def test_the_shell_switch_lives_in_one_helper():
    """Views branch through inAppShell(); only the helper (and the theme picker,
    which predates it) reads the attribute itself."""
    readers = sorted(
        p.relative_to(PLUGINS).as_posix()
        for p in PLUGINS.rglob("*.js")
        if re.search(r"data-aiui-shell|dataset\.aiuiShell", p.read_text(encoding="utf-8"))
    )
    assert readers == ["dashboard.js", "views/_helpers.js", "views/theme-picker.js"]
