"""Sessions page (plugins/sessions.js) rows: real dates, the session title,
no HTML injection from titles, and a singular count (review r1)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

PLUGINS = Path(__file__).resolve().parents[2] / "src/praisonaiui/templates/frontend/plugins"

_HARNESS = r"""
const out = {};
out.iso = formatDate('2026-11-14T07:30:00Z');
out.epoch = formatDate(1794641797);
out.bad = formatDate('not a date');
out.none = formatDate(null);
out.card = renderSessionCard({ id: 'u-1', title: '<img src=x onerror=alert(1)>', created_at: '2026-11-14T07:30:00Z' });
out.untitled = renderSessionCard({ id: 'u-2' });
out.quoteId = renderSessionCard({ id: "a');alert(1);('" });
console.log(JSON.stringify(out));
"""


def _run(tmp_path: Path) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    src = (PLUGINS / "sessions.js").read_text(encoding="utf-8")
    # Load the module body without its imports (toast/_helpers need a DOM).
    body = "\n".join(l for l in src.splitlines() if not l.startswith("import "))
    body = body.replace("export default {", "const __default = {", 1)
    (tmp_path / "h.mjs").write_text("globalThis.window = globalThis;\n" + body + "\n" + _HARNESS, encoding="utf-8")
    proc = subprocess.run([node, str(tmp_path / "h.mjs")], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_session_rows(tmp_path):
    out = _run(tmp_path)
    assert out["iso"] and "Invalid" not in out["iso"]
    assert out["epoch"] and "Invalid" not in out["epoch"]
    assert out["bad"] == "" and out["none"] == ""
    assert "Invalid Date" not in out["card"]
    assert "<img" not in out["card"] and "&lt;img src=x" in out["card"]
    assert 'title="u-1"' in out["card"]
    assert ">u-2<" in out["untitled"]  # no title: the id
    assert "alert(1);('\")" not in out["quoteId"]
    assert "&quot;a&#39;);alert(1);(&#39;&quot;" in out["quoteId"]


def test_session_count_is_pluralised():
    src = (PLUGINS / "sessions.js").read_text(encoding="utf-8")
    assert "sessions.length === 1 ? 'session' : 'sessions'" in src
